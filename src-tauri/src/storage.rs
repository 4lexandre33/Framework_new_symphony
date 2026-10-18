//! Backend de persistência em arquivos (G102): `<app_data_dir>/storage/<namespace>/k_<chave codificada>.kv`.
//!
//! - O WebView só informa `namespace` (validado: `[A-Za-z0-9_-]{1,64}`) e a
//!   chave lógica (texto opaco até 8 KiB). O nome do arquivo é DERIVADO
//!   aqui por uma codificação injetiva que só produz `[a-z0-9_.%^~-]`: não há
//!   separador, `..`, nome reservado do Windows nem colisão em sistemas de
//!   arquivos que ignoram maiúsculas.
//! - Chave cujo nome codificado passaria de 240 bytes (ex.: slot de 256
//!   caracteres não-ASCII depois do `encodeURIComponent` do TS) vira
//!   `h_<sha256 hex da chave>.kv`, determinístico; a chave original fica no
//!   cabeçalho do próprio arquivo (`kvkey1:<len>:<chave>\n<valor>`), então
//!   `list` devolve a chave exata (round-trip) e `read` confere que o
//!   cabeçalho é da chave pedida.
//! - Gravação atômica: arquivo temporário na MESMA pasta + `sync_all` + `rename`.
//!   Temporários órfãos (`*.tmp-<pid>-<n>` de um processo que caiu no meio
//!   da gravação) são apagados no primeiro acesso ao namespace e a cada
//!   `list`: os de outro pid ou com mais de 10 min (nunca um temporário em
//!   uso por este processo).
//! - Erros serializáveis `{ code, message }`.
//! - Os comandos são `async`: o I/O roda fora da thread principal.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::Manager;

const STORAGE_DIR: &str = "storage";
const FILE_PREFIX: &str = "k_";
/// Nome por hash (chave longa): `h_<64 hex>.kv`.
const HASHED_PREFIX: &str = "h_";
/// Cabeçalho dos arquivos `h_`: `kvkey1:<len bytes da chave>:<chave>\n`.
const HASHED_HEADER_MAGIC: &str = "kvkey1:";
const FILE_SUFFIX: &str = ".kv";
const TEMP_MARKER: &str = ".tmp-";
const MAX_NAMESPACE_LEN: usize = 64;
const MAX_KEY_BYTES: usize = 8 * 1024;
/// Limite de nome de arquivo (a maioria dos FS aceita 255 bytes).
const MAX_FILE_NAME_LEN: usize = 240;
/// 64 MiB por valor.
const MAX_VALUE_BYTES: usize = 64 * 1024 * 1024;
/// Máximo de chaves devolvidas por `storage_file_list`.
const MAX_LIST_ENTRIES: usize = 100_000;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
/// Temporário deste processo mais velho que isto também é órfão.
const ORPHAN_TEMP_AGE: Duration = Duration::from_secs(10 * 60);
/// Namespaces já limpos nesta execução (limpeza "de startup").
static CLEANED_DIRS: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

/// Pid dono de um temporário `<nome>.kv.tmp-<pid>-<n>`; `None` se não é
/// temporário (um arquivo de chave sempre termina em `.kv`, mesmo que a
/// chave contenha `.tmp-`).
fn temp_owner_pid(name: &str) -> Option<&str> {
    if !(name.starts_with(FILE_PREFIX) || name.starts_with(HASHED_PREFIX)) {
        return None;
    }
    let marker = format!("{FILE_SUFFIX}{TEMP_MARKER}");
    let index = name.rfind(&marker)?;
    let (pid, counter) = name[index + marker.len()..].split_once('-')?;
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    (digits(pid) && digits(counter)).then_some(pid)
}

/// `true` se o temporário não pode estar em uso por uma gravação deste processo.
fn is_orphan_temp(name: &str, modified: Option<SystemTime>) -> bool {
    let Some(owner) = temp_owner_pid(name) else { return false };
    if owner != std::process::id().to_string() {
        return true;
    }
    modified
        .and_then(|time| SystemTime::now().duration_since(time).ok())
        .map(|age| age >= ORPHAN_TEMP_AGE)
        .unwrap_or(false)
}

/// Apaga temporários órfãos da pasta; devolve quantos removeu.
pub(crate) fn clean_orphan_temps(dir: &Path) -> usize {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let modified = entry.metadata().ok().and_then(|meta| meta.modified().ok());
        if is_orphan_temp(name, modified) && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

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

fn validate_key(key: &str) -> Result<(), StorageFileError> {
    if key.is_empty() || key.len() > MAX_KEY_BYTES || key.contains('\0') {
        return Err(StorageFileError::invalid("chave inválida (1..8192 bytes, sem NUL)"));
    }
    Ok(())
}

/// Codificação injetiva chave → nome de arquivo seguro.
/// `a-z 0-9 _ - . %` passam; `A-Z` vira `^` + minúscula; o resto vira `~hh`
/// por byte UTF-8. Erro se o nome passaria de 240 bytes (veja `file_name_for`).
pub(crate) fn encode_key(key: &str) -> Result<String, StorageFileError> {
    validate_key(key)?;

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

fn hashed_file_name(key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    let mut out = String::with_capacity(HASHED_PREFIX.len() + 64 + FILE_SUFFIX.len());
    out.push_str(HASHED_PREFIX);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out.push_str(FILE_SUFFIX);
    out
}

/// Nome do arquivo de uma chave: codificação reversível se couber, senão hash.
/// `true` = nome por hash (o arquivo carrega a chave no cabeçalho).
pub(crate) fn file_name_for(key: &str) -> Result<(String, bool), StorageFileError> {
    validate_key(key)?;
    match encode_key(key) {
        Ok(name) => Ok((name, false)),
        Err(_) => Ok((hashed_file_name(key), true)),
    }
}

fn hashed_header(key: &str) -> String {
    format!("{HASHED_HEADER_MAGIC}{}:{key}\n", key.len())
}

/// Separa `kvkey1:<len>:<chave>\n<resto>`; `None` se malformado.
fn split_hashed_header(bytes: &[u8]) -> Option<(String, usize)> {
    let rest = bytes.strip_prefix(HASHED_HEADER_MAGIC.as_bytes())?;
    let colon = rest.iter().take(6).position(|b| *b == b':')?;
    let len: usize = std::str::from_utf8(&rest[..colon]).ok()?.parse().ok()?;
    if len == 0 || len > MAX_KEY_BYTES {
        return None;
    }
    let key_start = HASHED_HEADER_MAGIC.len() + colon + 1;
    let key_end = key_start.checked_add(len)?;
    if bytes.len() <= key_end || bytes[key_end] != b'\n' {
        return None;
    }
    let key = String::from_utf8(bytes[key_start..key_end].to_vec()).ok()?;
    Some((key, key_end + 1))
}

/// Chave guardada no cabeçalho de um arquivo `h_` (lê só o começo do arquivo).
fn read_hashed_key(path: &Path, name: &str) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let limit = HASHED_HEADER_MAGIC.len() + 6 + MAX_KEY_BYTES + 1;
    let mut head = Vec::with_capacity(256);
    (&mut file).take(limit as u64).read_to_end(&mut head).ok()?;
    let (key, _) = split_hashed_header(&head)?;
    // O nome precisa ser o hash da chave do cabeçalho (arquivo íntegro/nosso).
    (hashed_file_name(&key) == name).then_some(key)
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
    let (name, hashed) = file_name_for(key)?;
    let path = dir.join(name);
    if !regular_file_or_missing(&path)? {
        return Ok(None);
    }
    let meta = fs::metadata(&path)
        .map_err(|error| StorageFileError::io("Falha ao ler metadados", &error))?;
    let header_allowance = if hashed { hashed_header(key).len() } else { 0 };
    if meta.len() as usize > MAX_VALUE_BYTES + header_allowance {
        return Err(StorageFileError::invalid("valor armazenado excede o limite"));
    }
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(StorageFileError::io("Falha ao ler valor", &error)),
    };
    if !hashed {
        return Ok(Some(text));
    }
    match split_hashed_header(text.as_bytes()) {
        Some((stored_key, offset)) if stored_key == key => Ok(Some(text[offset..].to_string())),
        _ => Err(StorageFileError {
            code: "io",
            message: "arquivo de chave longa com cabeçalho inválido".to_string(),
        }),
    }
}

pub(crate) fn write_value(dir: &Path, key: &str, value: &str) -> Result<(), StorageFileError> {
    if value.len() > MAX_VALUE_BYTES {
        return Err(StorageFileError::invalid("valor excede 64 MiB"));
    }
    let (name, hashed) = file_name_for(key)?;
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
        if hashed {
            file.write_all(hashed_header(key).as_bytes())
                .map_err(|error| StorageFileError::io("Falha ao gravar temporário", &error))?;
        }
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
    let path = dir.join(file_name_for(key)?.0);
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
    clean_orphan_temps(dir);
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
        if temp_owner_pid(name).is_some() {
            continue;
        }
        let key = if name.starts_with(HASHED_PREFIX) {
            read_hashed_key(&entry.path(), name)
        } else {
            decode_file_name(name)
        };
        if let Some(key) = key {
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
    let dir = namespace_dir(&base, namespace)?;
    let first_use = CLEANED_DIRS
        .lock()
        .map(|mut cleaned| cleaned.get_or_insert_with(HashSet::new).insert(dir.clone()))
        .unwrap_or(false);
    if first_use {
        clean_orphan_temps(&dir);
    }
    Ok(dir)
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
        assert!(file_name_for(&"x".repeat(MAX_KEY_BYTES + 1)).is_err());
        assert!(file_name_for("").is_err());
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
    fn long_keys_use_a_deterministic_hashed_name_and_round_trip_through_list() {
        let base = temp_base("longkeys");
        let dir = namespace_dir(&base, "saves").unwrap();
        // Slot de 256 caracteres não-ASCII depois do encodeURIComponent do TS
        // (9 bytes por caractere) + prefixos internos.
        let slot: String = std::iter::repeat("%E2%98%83").take(256).collect();
        let long_key = format!("ns:meu-jogo:local_db_save_#bak1:{slot}");
        let short_key = "local_db_save_curto";
        let (name, hashed) = file_name_for(&long_key).unwrap();
        assert!(hashed);
        assert!(name.len() <= MAX_FILE_NAME_LEN && name.starts_with(HASHED_PREFIX));
        assert_eq!(file_name_for(&long_key).unwrap().0, name); // determinístico
        assert!(!file_name_for(short_key).unwrap().1); // chave curta: formato antigo

        write_value(&dir, &long_key, "{\"v\":1}").unwrap();
        write_value(&dir, &long_key, "{\"v\":2}").unwrap();
        write_value(&dir, short_key, "c").unwrap();
        assert_eq!(read_value(&dir, &long_key).unwrap().as_deref(), Some("{\"v\":2}"));
        let mut expected = vec![long_key.clone(), short_key.to_string()];
        expected.sort();
        assert_eq!(list_keys(&dir).unwrap(), expected);

        // Valor com quebras de linha/cabeçalho falso continua intacto.
        let tricky = "kvkey1:3:abc\nresto\n";
        write_value(&dir, &long_key, tricky).unwrap();
        assert_eq!(read_value(&dir, &long_key).unwrap().as_deref(), Some(tricky));

        // Arquivo h_ adulterado (cabeçalho de outra chave) não entra na lista
        // e a leitura falha em vez de devolver o valor errado.
        fs::write(dir.join(&name), format!("{}x", hashed_header("outra"))).unwrap();
        assert_eq!(list_keys(&dir).unwrap(), vec![short_key.to_string()]);
        assert_eq!(read_value(&dir, &long_key).unwrap_err().code, "io");

        assert!(delete_value(&dir, &long_key).unwrap());
        assert_eq!(read_value(&dir, &long_key).unwrap(), None);
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

    #[test]
    fn orphan_temp_files_are_cleaned_but_live_ones_are_kept() {
        let base = temp_base("orphans");
        let dir = namespace_dir(&base, "saves").unwrap();
        let other_pid = std::process::id().wrapping_add(1);
        let orphan = format!("k_a.kv{TEMP_MARKER}{other_pid}-7");
        let live = format!("k_b.kv{TEMP_MARKER}{}-8", std::process::id());
        fs::write(dir.join(&orphan), "meio gravado").unwrap();
        fs::write(dir.join(&live), "gravando agora").unwrap();
        fs::write(dir.join("README.txt"), "x").unwrap();
        write_value(&dir, "a", "1").unwrap();

        assert_eq!(list_keys(&dir).unwrap(), vec!["a".to_string()]);
        assert!(!dir.join(&orphan).exists()); // outro processo: órfão
        assert!(dir.join(&live).exists()); // deste processo e recente: em uso
        assert!(dir.join("README.txt").exists()); // arquivo alheio não é tocado

        // Deste processo mas velho: órfão também.
        let old = SystemTime::now() - ORPHAN_TEMP_AGE - Duration::from_secs(1);
        assert!(is_orphan_temp(&live, Some(old)));
        assert!(!is_orphan_temp(&live, Some(SystemTime::now())));
        assert!(!is_orphan_temp("k_a.kv", None));
        // Chave cujo nome contém `.tmp-` não é temporário (termina em `.kv`).
        write_value(&dir, "x.kv.tmp-1-2", "chave legítima").unwrap();
        assert!(list_keys(&dir).unwrap().contains(&"x.kv.tmp-1-2".to_string()));
        assert_eq!(read_value(&dir, "x.kv.tmp-1-2").unwrap().as_deref(), Some("chave legítima"));
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
