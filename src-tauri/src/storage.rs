//! Backend de persistência em arquivos (G102): `<app_data_dir>/storage/<namespace>/k_<chave codificada>.kv`.
//!
//! - O WebView só informa `namespace` (validado: `[A-Za-z0-9_-]{1,64}`) e a
//!   chave lógica (texto opaco até 512 bytes). O nome do arquivo é DERIVADO
//!   aqui por uma codificação injetiva que só produz `[a-z0-9_.%^~-]`: não há
//!   separador, `..`, nome reservado do Windows nem colisão em sistemas de
//!   arquivos que ignoram maiúsculas.
//! - Gravação atômica: arquivo temporário na MESMA pasta + `sync_all` + `rename`.
//! - Erros serializáveis `{ code, message }`.
//! - Os comandos são `async`: o I/O roda fora da thread principal.

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

const STORAGE_DIR: &str = "storage";
const FILE_PREFIX: &str = "k_";
const FILE_SUFFIX: &str = ".kv";
const TEMP_MARKER: &str = ".tmp-";
const MAX_NAMESPACE_LEN: usize = 64;
const MAX_KEY_BYTES: usize = 512;
/// Limite de nome de arquivo (a maioria dos FS aceita 255 bytes).
const MAX_FILE_NAME_LEN: usize = 240;
/// 64 MiB por valor.
const MAX_VALUE_BYTES: usize = 64 * 1024 * 1024;
/// Máximo de chaves devolvidas por `storage_file_list`.
const MAX_LIST_ENTRIES: usize = 100_000;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageFileError {
    /// `invalid-input` | `quota-exceeded` | `io` | `unavailable`
    pub code: &'static str,
    pub message: String,
}

impl StorageFileError {
    fn invalid(message: impl Into<String>) -> Self {
        Self { code: "invalid-input", message: message.into() }
    }

    fn io(context: &str, error: &std::io::Error) -> Self {
        // ENOSPC (28) / ERROR_DISK_FULL (112) / EDQUOT (122) → cota.
        let quota = matches!(error.raw_os_error(), Some(28) | Some(112) | Some(122));
        Self {
            code: if quota { "quota-exceeded" } else { "io" },
            message: format!("{context}: {error}"),
        }
    }
}

pub(crate) fn validate_namespace(namespace: &str) -> Result<(), StorageFileError> {
    if namespace.is_empty()
        || namespace.len() > MAX_NAMESPACE_LEN
        || !namespace
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(StorageFileError::invalid(
            "namespace inválido (use [A-Za-z0-9_-], 1..64)",
        ));
    }
    Ok(())
}

/// Codificação injetiva chave → nome de arquivo seguro.
/// `a-z 0-9 _ - . %` passam; `A-Z` vira `^` + minúscula; o resto vira `~hh`
/// por byte UTF-8.
pub(crate) fn encode_key(key: &str) -> Result<String, StorageFileError> {
    if key.is_empty() || key.len() > MAX_KEY_BYTES || key.contains('\0') {
        return Err(StorageFileError::invalid("chave inválida (1..512 bytes, sem NUL)"));
    }

    let mut out = String::with_capacity(FILE_PREFIX.len() + key.len() + FILE_SUFFIX.len());
    out.push_str(FILE_PREFIX);
    for byte in key.bytes() {
        match byte {
            b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-' | b'.' | b'%' => out.push(byte as char),
            b'A'..=b'Z' => {
                out.push('^');
                out.push((byte + 32) as char);
            }
            _ => {
                out.push('~');
                out.push_str(&format!("{byte:02x}"));
            }
        }
    }
    out.push_str(FILE_SUFFIX);

    if out.len() > MAX_FILE_NAME_LEN {
        return Err(StorageFileError::invalid(
            "chave longa demais para o backend de arquivos",
        ));
    }
    Ok(out)
}

pub(crate) fn decode_file_name(name: &str) -> Option<String> {
    let body = name.strip_prefix(FILE_PREFIX)?.strip_suffix(FILE_SUFFIX)?;
    let bytes = body.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-' | b'.' | b'%' => {
                out.push(bytes[index]);
                index += 1;
            }
            b'^' => {
                let next = *bytes.get(index + 1)?;
                if !next.is_ascii_lowercase() {
                    return None;
                }
                out.push(next - 32);
                index += 2;
            }
            b'~' => {
                let hex = body.get(index + 1..index + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            _ => return None,
        }
    }
    let decoded = String::from_utf8(out).ok()?;
    if decoded.is_empty() {
        return None;
    }
    Some(decoded)
}

/// Pasta do namespace, criada se preciso; recusa symlink/fuga da base.
pub(crate) fn namespace_dir(base: &Path, namespace: &str) -> Result<PathBuf, StorageFileError> {
    validate_namespace(namespace)?;
    let root = base.join(STORAGE_DIR);
    let dir = root.join(namespace);
    fs::create_dir_all(&dir)
        .map_err(|error| StorageFileError::io("Falha ao criar a pasta de storage", &error))?;

    let meta = fs::symlink_metadata(&dir)
        .map_err(|error| StorageFileError::io("Falha ao inspecionar a pasta de storage", &error))?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(StorageFileError::invalid("pasta de storage não é um diretório comum"));
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|error| StorageFileError::io("Falha ao canonicalizar a base", &error))?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|error| StorageFileError::io("Falha ao canonicalizar a pasta", &error))?;
    if !canonical_dir.starts_with(&canonical_root) {
        return Err(StorageFileError::invalid("pasta de storage fora da base"));
    }
    Ok(canonical_dir)
}

fn regular_file_or_missing(path: &Path) -> Result<bool, StorageFileError> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() || !meta.is_file() {
                return Err(StorageFileError::invalid("entrada de storage não é arquivo comum"));
            }
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(StorageFileError::io("Falha ao inspecionar arquivo", &error)),
    }
}

pub(crate) fn read_value(dir: &Path, key: &str) -> Result<Option<String>, StorageFileError> {
    let path = dir.join(encode_key(key)?);
    if !regular_file_or_missing(&path)? {
        return Ok(None);
    }
    let meta = fs::metadata(&path)
        .map_err(|error| StorageFileError::io("Falha ao ler metadados", &error))?;
    if meta.len() as usize > MAX_VALUE_BYTES {
        return Err(StorageFileError::invalid("valor armazenado excede o limite"));
    }
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(StorageFileError::io("Falha ao ler valor", &error)),
    }
}

pub(crate) fn write_value(dir: &Path, key: &str, value: &str) -> Result<(), StorageFileError> {
    if value.len() > MAX_VALUE_BYTES {
        return Err(StorageFileError::invalid("valor excede 64 MiB"));
    }
    let name = encode_key(key)?;
    let target = dir.join(&name);
    regular_file_or_missing(&target)?;

    let unique = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp = dir.join(format!("{name}{TEMP_MARKER}{}-{unique}", std::process::id()));

    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| StorageFileError::io("Falha ao criar temporário", &error))?;
        file.write_all(value.as_bytes())
            .map_err(|error| StorageFileError::io("Falha ao gravar temporário", &error))?;
        file.sync_all()
            .map_err(|error| StorageFileError::io("Falha ao sincronizar temporário", &error))?;
        drop(file);
        fs::rename(&temp, &target)
            .map_err(|error| StorageFileError::io("Falha ao substituir arquivo", &error))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub(crate) fn delete_value(dir: &Path, key: &str) -> Result<bool, StorageFileError> {
    let path = dir.join(encode_key(key)?);
    if !regular_file_or_missing(&path)? {
        return Ok(false);
    }
    match fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(StorageFileError::io("Falha ao remover valor", &error)),
    }
}

pub(crate) fn list_keys(dir: &Path) -> Result<Vec<String>, StorageFileError> {
    let entries = fs::read_dir(dir)
        .map_err(|error| StorageFileError::io("Falha ao listar storage", &error))?;
    let mut keys = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.contains(TEMP_MARKER) {
            continue;
        }
        if let Some(key) = decode_file_name(name) {
            keys.push(key);
            if keys.len() >= MAX_LIST_ENTRIES {
                break;
            }
        }
    }
    keys.sort();
    Ok(keys)
}

fn resolve_dir(app: &tauri::AppHandle, namespace: &str) -> Result<PathBuf, StorageFileError> {
    validate_namespace(namespace)?;
    let base = app.path().app_data_dir().map_err(|error| StorageFileError {
        code: "unavailable",
        message: format!("Falha ao resolver app_data_dir: {error}"),
    })?;
    namespace_dir(&base, namespace)
}

#[tauri::command]
pub async fn storage_file_read(
    app: tauri::AppHandle,
    namespace: String,
    key: String,
) -> Result<Option<String>, StorageFileError> {
    let dir = resolve_dir(&app, &namespace)?;
    read_value(&dir, &key)
}

#[tauri::command]
pub async fn storage_file_write(
    app: tauri::AppHandle,
    namespace: String,
    key: String,
    value: String,
) -> Result<bool, StorageFileError> {
    let dir = resolve_dir(&app, &namespace)?;
    write_value(&dir, &key, &value)?;
    Ok(true)
}

#[tauri::command]
pub async fn storage_file_delete(
    app: tauri::AppHandle,
    namespace: String,
    key: String,
) -> Result<bool, StorageFileError> {
    let dir = resolve_dir(&app, &namespace)?;
    delete_value(&dir, &key)
}

#[tauri::command]
pub async fn storage_file_list(
    app: tauri::AppHandle,
    namespace: String,
) -> Result<Vec<String>, StorageFileError> {
    let dir = resolve_dir(&app, &namespace)?;
    list_keys(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "projeto1-storage-test-{tag}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn encoding_is_safe_and_reversible() {
        for key in [
            "local_db_save_slot1",
            "ns:Meu%20Jogo:local_db_save_#index",
            "local_db_save_A#bak1:B",
            "../../etc/passwd",
            "CON",
            "ção/\\:*?\"<>|",
        ] {
            let name = encode_key(key).unwrap();
            assert!(name.starts_with(FILE_PREFIX) && name.ends_with(FILE_SUFFIX));
            assert!(name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_-.%^~".contains(&b)));
            assert!(!name.contains('/') && !name.contains('\\'));
            assert_eq!(decode_file_name(&name).as_deref(), Some(key));
        }
        // Maiúsculas não colidem com minúsculas (FS case-insensitive).
        assert_ne!(encode_key("A").unwrap().to_lowercase(), encode_key("a").unwrap().to_lowercase());
    }

    #[test]
    fn rejects_invalid_input() {
        assert!(encode_key("").is_err());
        assert!(encode_key("a\0b").is_err());
        assert!(encode_key(&"x".repeat(600)).is_err());
        assert!(encode_key(&"#".repeat(100)).is_err()); // nome codificado longo demais
        for ns in ["", "../x", "a/b", "a b", &"n".repeat(65)] {
            assert_eq!(validate_namespace(ns).unwrap_err().code, "invalid-input");
        }
        assert!(decode_file_name("k_~zz.kv").is_none());
        assert!(decode_file_name("other.txt").is_none());
    }

    #[test]
    fn write_read_list_delete_roundtrip() {
        let base = temp_base("roundtrip");
        let dir = namespace_dir(&base, "saves").unwrap();
        assert_eq!(read_value(&dir, "k1").unwrap(), None);
        write_value(&dir, "k1", "{\"a\":1}").unwrap();
        write_value(&dir, "ns:X:k#2", "dois").unwrap();
        write_value(&dir, "k1", "{\"a\":2}").unwrap(); // sobrescreve atomicamente
        assert_eq!(read_value(&dir, "k1").unwrap().as_deref(), Some("{\"a\":2}"));
        assert_eq!(list_keys(&dir).unwrap(), vec!["k1".to_string(), "ns:X:k#2".to_string()]);
        // Nenhum temporário sobra.
        let leftovers = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(TEMP_MARKER))
            .count();
        assert_eq!(leftovers, 0);
        assert!(delete_value(&dir, "k1").unwrap());
        assert!(!delete_value(&dir, "k1").unwrap());
        assert_eq!(list_keys(&dir).unwrap(), vec!["ns:X:k#2".to_string()]);
        // Namespaces isolados.
        let other = namespace_dir(&base, "outro").unwrap();
        assert!(list_keys(&other).unwrap().is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn list_ignores_temp_and_foreign_files() {
        let base = temp_base("foreign");
        let dir = namespace_dir(&base, "saves").unwrap();
        fs::write(dir.join("k_a.kv.tmp-1-2"), "x").unwrap();
        fs::write(dir.join("README.txt"), "x").unwrap();
        write_value(&dir, "a", "1").unwrap();
        assert_eq!(list_keys(&dir).unwrap(), vec!["a".to_string()]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_entries() {
        let base = temp_base("symlink");
        let dir = namespace_dir(&base, "saves").unwrap();
        let outside = base.join("outside.txt");
        fs::write(&outside, "segredo").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join(encode_key("evil").unwrap())).unwrap();
        assert_eq!(read_value(&dir, "evil").unwrap_err().code, "invalid-input");
        assert_eq!(write_value(&dir, "evil", "x").unwrap_err().code, "invalid-input");
        assert_eq!(fs::read_to_string(&outside).unwrap(), "segredo");
        // Namespace que é symlink para fora da base.
        let target = base.join("elsewhere");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(base.join(STORAGE_DIR)).unwrap();
        std::os::unix::fs::symlink(&target, base.join(STORAGE_DIR).join("linked")).unwrap();
        assert!(namespace_dir(&base, "linked").is_err());
        fs::remove_dir_all(&base).unwrap();
    }
}
