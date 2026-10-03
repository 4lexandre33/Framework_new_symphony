use std::fs;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Manager;

const MAX_CRASH_DUMP_BYTES: usize = 2 * 1024 * 1024;
const MAX_CRASH_ID_LENGTH: usize = 128;

static CLOCK_STATE: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

#[tauri::command]
pub async fn security_validate_system_clock(
    _client_timestamp_ms: u64,
) -> Result<f64, String> {
    let clock_state = CLOCK_STATE.get_or_init(|| Mutex::new(None));
    let mut last_check = clock_state
        .lock()
        .map_err(|_| "Falha ao adquirir o estado do relógio de segurança.".to_string())?;

    let now = Instant::now();

    let elapsed_ms = match *last_check {
        Some(previous) => now.duration_since(previous).as_secs_f64() * 1000.0,
        None => 0.0,
    };

    *last_check = Some(now);
    Ok(elapsed_ms)
}

#[tauri::command]
pub async fn security_write_crash_dump(
    app: tauri::AppHandle,
    crash_id: String,
    content: String,
) -> Result<bool, String> {
    validate_crash_id(&crash_id)?;

    if content.len() > MAX_CRASH_DUMP_BYTES {
        return Err(format!(
            "Crash dump excede o limite de {} bytes.",
            MAX_CRASH_DUMP_BYTES
        ));
    }

    let app_dir = app
        .path()
        .app_log_dir()
        .map_err(|err| format!("Falha ao resolver diretório de logs: {err}"))?;

    fs::create_dir_all(&app_dir)
        .map_err(|err| format!("Falha ao criar diretório de logs: {err}"))?;

    let file_path = app_dir.join(format!("{crash_id}.dmp.json"));

    fs::write(&file_path, content)
        .map_err(|err| format!("Falha ao gravar dump de crash: {err}"))?;

    Ok(true)
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
