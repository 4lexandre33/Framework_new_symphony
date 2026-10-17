use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Manager;

const MAX_CRASH_DUMP_BYTES: usize = 2 * 1024 * 1024;
const MAX_CRASH_ID_LENGTH: usize = 128;
const MAX_NAMESPACE_LENGTH: usize = 64;
const MAX_CALLER_ID_LENGTH: usize = 64;
/// Máximo de relógios por chamador mantidos (G114); o mais antigo sai.
const MAX_CLOCK_CALLERS: usize = 64;
/// Rotação padrão / limites de crash dumps por pasta (G115).
const DEFAULT_MAX_CRASH_DUMPS: u32 = 20;
const MAX_CRASH_DUMPS_LIMIT: u32 = 200;
const CRASH_DUMP_DIR: &str = "crash-dumps";
const CRASH_DUMP_SUFFIX: &str = ".dmp.json";

/// Relógio legado (chamada sem `callerId`): um único baseline global.
static CLOCK_STATE: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
/// G114: baseline monotônico POR CHAMADOR (`callerId`).
static CALLER_CLOCKS: OnceLock<Mutex<CallerClocks>> = OnceLock::new();

/// Baselines monotônicos por chamador, com limite de entradas.
#[derive(Default)]
pub(crate) struct CallerClocks {
    entries: HashMap<String, Instant>,
}

impl CallerClocks {
    /// Devolve ms desde a chamada ANTERIOR deste chamador (0 na primeira) e
    /// atualiza o baseline.
    pub(crate) fn elapsed_ms(&mut self, caller: &str, now: Instant) -> f64 {
        let elapsed = match self.entries.get(caller) {
            Some(previous) => now.saturating_duration_since(*previous).as_secs_f64() * 1000.0,
            None => {
                if self.entries.len() >= MAX_CLOCK_CALLERS {
                    if let Some(oldest) = self
                        .entries
                        .iter()
                        .min_by_key(|(_, at)| **at)
                        .map(|(key, _)| key.clone())
                    {
                        self.entries.remove(&oldest);
                    }
                }
                0.0
            }
        };
        self.entries.insert(caller.to_string(), now);
        elapsed
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

#[tauri::command]
pub async fn security_validate_system_clock(
    _client_timestamp_ms: u64,
    caller_id: Option<String>,
) -> Result<f64, String> {
    let now = Instant::now();

    if let Some(caller) = caller_id {
        validate_token("callerId", &caller, MAX_CALLER_ID_LENGTH)?;
        let clocks = CALLER_CLOCKS.get_or_init(|| Mutex::new(CallerClocks::default()));
        let mut guard = clocks
            .lock()
            .map_err(|_| "Falha ao adquirir o estado do relógio de segurança.".to_string())?;
        return Ok(guard.elapsed_ms(&caller, now));
    }

    let clock_state = CLOCK_STATE.get_or_init(|| Mutex::new(None));
    let mut last_check = clock_state
        .lock()
        .map_err(|_| "Falha ao adquirir o estado do relógio de segurança.".to_string())?;

    let elapsed_ms = match *last_check {
        Some(previous) => now.duration_since(previous).as_secs_f64() * 1000.0,
        None => 0.0,
    };

    *last_check = Some(now);
    Ok(elapsed_ms)
}

/// Resultado REAL da gravação (G115).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrashDumpWriteResult {
    pub written: bool,
    pub path: String,
    /// Dumps antigos removidos pela rotação.
    pub removed: u32,
}

#[tauri::command]
pub async fn security_write_crash_dump(
    app: tauri::AppHandle,
    crash_id: String,
    content: String,
    namespace: Option<String>,
    max_files: Option<u32>,
) -> Result<CrashDumpWriteResult, String> {
    validate_crash_id(&crash_id)?;

    if content.len() > MAX_CRASH_DUMP_BYTES {
        return Err(format!(
            "Crash dump excede o limite de {} bytes.",
            MAX_CRASH_DUMP_BYTES
        ));
    }

    if let Some(ns) = namespace.as_deref() {
        validate_token("namespace", ns, MAX_NAMESPACE_LENGTH)?;
    }

    // A pasta de logs do Tauri já é POR JOGO (deriva do `identifier`, ver
    // scripts/tauri-project-config.mjs); `namespace` separa ainda mais.
    let app_dir = app
        .path()
        .app_log_dir()
        .map_err(|err| format!("Falha ao resolver diretório de logs: {err}"))?;

    let keep = max_files
        .unwrap_or(DEFAULT_MAX_CRASH_DUMPS)
        .clamp(1, MAX_CRASH_DUMPS_LIMIT);

    write_dump_into(
        &crash_dump_dir(&app_dir, namespace.as_deref()),
        &crash_id,
        &content,
        keep,
    )
}

pub(crate) fn crash_dump_dir(app_log_dir: &Path, namespace: Option<&str>) -> PathBuf {
    let base = app_log_dir.join(CRASH_DUMP_DIR);
    match namespace {
        Some(ns) => base.join(ns),
        None => base,
    }
}

/// Grava de forma atômica (tmp + rename) e aplica a rotação.
pub(crate) fn write_dump_into(
    dir: &Path,
    crash_id: &str,
    content: &str,
    keep: u32,
) -> Result<CrashDumpWriteResult, String> {
    fs::create_dir_all(dir).map_err(|err| format!("Falha ao criar diretório de logs: {err}"))?;

    let file_path = dir.join(format!("{crash_id}{CRASH_DUMP_SUFFIX}"));
    let tmp_path = dir.join(format!("{crash_id}{CRASH_DUMP_SUFFIX}.tmp"));

    fs::write(&tmp_path, content).map_err(|err| format!("Falha ao gravar dump de crash: {err}"))?;
    if let Err(err) = fs::rename(&tmp_path, &file_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Falha ao gravar dump de crash: {err}"));
    }

    let removed = rotate_dumps(dir, keep as usize, Some(&file_path));

    Ok(CrashDumpWriteResult {
        written: true,
        path: file_path.to_string_lossy().into_owned(),
        removed,
    })
}

/// Mantém só os `keep` dumps mais recentes (por mtime) da pasta.
pub(crate) fn rotate_dumps(dir: &Path, keep: usize, protect: Option<&Path>) -> u32 {
    let Ok(read) = fs::read_dir(dir) else {
        return 0;
    };
    let mut dumps: Vec<(std::time::SystemTime, PathBuf)> = read
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|name| name.ends_with(CRASH_DUMP_SUFFIX))
                .unwrap_or(false)
        })
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((meta.modified().unwrap_or(std::time::UNIX_EPOCH), entry.path()))
        })
        .collect();

    if dumps.len() <= keep {
        return 0;
    }
    // Mais novos primeiro; o recém-gravado nunca é removido.
    dumps.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    let mut removed = 0;
    let mut kept = 0usize;
    for (_, path) in dumps {
        let is_protected = protect.map(|p| p == path.as_path()).unwrap_or(false);
        if is_protected || kept < keep {
            kept += 1;
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn validate_token(label: &str, value: &str, max_len: usize) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{label} não pode ser vazio."));
    }
    if value.len() > max_len {
        return Err(format!("{label} excede o limite de {max_len} caracteres."));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(format!("{label} contém caracteres inválidos."));
    }
    Ok(())
}

fn validate_crash_id(crash_id: &str) -> Result<(), String> {
    if crash_id.is_empty() {
        return Err("crash_id não pode ser vazio.".to_string());
    }

    if crash_id.len() > MAX_CRASH_ID_LENGTH {
        return Err(format!(
            "crash_id excede o limite de {} caracteres.",
            MAX_CRASH_ID_LENGTH
        ));
    }

    if !crash_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err("crash_id contém caracteres inválidos.".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "projeto1-security-test-{tag}-{}-{:?}",
            std::process::id(),
            Instant::now()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn caller_clocks_are_independent_and_bounded() {
        let mut clocks = CallerClocks::default();
        let t0 = Instant::now();
        assert_eq!(clocks.elapsed_ms("a", t0), 0.0);
        assert_eq!(clocks.elapsed_ms("b", t0 + Duration::from_millis(500)), 0.0);
        let a = clocks.elapsed_ms("a", t0 + Duration::from_millis(1000));
        assert!((a - 1000.0).abs() < 0.001, "{a}");
        let b = clocks.elapsed_ms("b", t0 + Duration::from_millis(1000));
        assert!((b - 500.0).abs() < 0.001, "{b}");
        for i in 0..(MAX_CLOCK_CALLERS * 2) {
            clocks.elapsed_ms(&format!("c{i}"), t0 + Duration::from_millis(2000 + i as u64));
        }
        assert!(clocks.len() <= MAX_CLOCK_CALLERS);
    }

    #[test]
    fn rejects_bad_tokens() {
        assert!(validate_token("namespace", "", 8).is_err());
        assert!(validate_token("namespace", "../x", 8).is_err());
        assert!(validate_token("namespace", "aaaaaaaaa", 8).is_err());
        assert!(validate_token("namespace", "meu-jogo_1", 16).is_ok());
        assert!(validate_crash_id("crash_1/../../x").is_err());
    }

    #[test]
    fn writes_real_file_and_rotates() {
        let root = temp_dir("rotate");
        let dir = crash_dump_dir(&root, Some("jogo"));
        for i in 0..5 {
            let res = write_dump_into(&dir, &format!("crash_{i}"), "{}", 3).expect("write");
            assert!(res.written);
            assert!(Path::new(&res.path).exists());
            std::thread::sleep(Duration::from_millis(15));
        }
        let count = fs::read_dir(&dir)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(CRASH_DUMP_SUFFIX)
            })
            .count();
        assert_eq!(count, 3);
        assert!(dir.join("crash_4.dmp.json").exists());
        assert!(!dir.join("crash_0.dmp.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_failure_is_reported() {
        let root = temp_dir("fail");
        fs::create_dir_all(&root).unwrap();
        let blocker = root.join("file-not-dir");
        fs::write(&blocker, "x").unwrap();
        assert!(write_dump_into(&blocker.join("sub"), "crash_1", "{}", 3).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
