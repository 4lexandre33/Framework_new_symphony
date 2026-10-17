//! Modding nativo: mods locais em `<app_data_dir>/mods/<modId>/mod.json`,
//! itens instalados do Steam Workshop (UGC), leitura segura de arquivos de
//! mod, publicação no Workshop e persistência dos mods ativos.
//!
//! Regras de validação do manifesto são IDÊNTICAS às do TypeScript
//! (`ModManifestValidator.ts`) e testadas contra o mesmo fixture
//! (`src-tauri/fixtures/mod-manifests.json`).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

const MAX_MOD_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_MOD_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TEXT_LEN: usize = 8 * 1024;
const MAX_NAME_LEN: usize = 128;
const MAX_MOD_ID_LEN: usize = 128;
const MAX_RELATIVE_PATH_LEN: usize = 1024;
const MAX_OVERRIDES: usize = 256;
const MAX_DEPENDENCIES: usize = 64;
const MAX_WORKSHOP_ID_LEN: usize = 20;
const MAX_TITLE_LEN: usize = 128;
const MAX_ENABLED_MODS: usize = 512;
const MAX_INSTALLED_MODS: usize = 1024;
const ENABLED_FILE: &str = "enabled-mods.json";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModDependencyDto {
    pub mod_id: String,
    pub min_version: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetOverrideDto {
    pub virtual_path: String,
    pub real_path: String,
    pub mod_id: String,
    pub priority: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModManifestDto {
    pub mod_id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub min_engine_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_script: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overrides: Option<Vec<AssetOverrideDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<Vec<ModDependencyDto>>,
}

/// Mod encontrado em disco (válido ou não: inválidos trazem `error`, para
/// que não "sumam sem aviso" — G118).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModDto {
    pub manifest: Option<ModManifestDto>,
    /// Pasta canônica do mod (para `convertFileSrc`).
    pub root_path: String,
    pub folder_name: String,
    /// "local" | "workshop"
    pub source: String,
    pub workshop_item_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopItemStateDto {
    pub item_id: String,
    pub subscribed: bool,
    pub installed: bool,
    pub downloading: bool,
    pub download_pending: bool,
    pub needs_update: bool,
    pub bytes_downloaded: u64,
    pub bytes_total: u64,
}

// ── validação pura (espelhada em TS) ────────────────────────────────────────

fn is_mod_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_MOD_ID_LEN
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

/// `MAJOR.MINOR.PATCH` com pré-release opcional (`-[0-9A-Za-z.-]+`).
pub fn is_semver(value: &str) -> bool {
    let (core, pre) = match value.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (value, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || part.len() > 9 || !part.bytes().all(|b| b.is_ascii_digit()))
    {
        return false;
    }
    match pre {
        None => true,
        Some(pre) => {
            !pre.is_empty()
                && pre.len() <= 64
                && pre
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        }
    }
}

/// Normaliza um caminho relativo de mod: `\` → `/`, remove `.` e segmentos
/// vazios; rejeita absoluto, drive, `..`, NUL e excesso de tamanho.
pub fn normalize_relative_path(value: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > MAX_RELATIVE_PATH_LEN || value.contains('\0') {
        return Err("caminho inválido".to_string());
    }
    let unified = value.replace('\\', "/");
    if unified.starts_with('/') || unified.as_bytes().get(1) == Some(&b':') {
        return Err("caminho precisa ser relativo".to_string());
    }
    let mut segments = Vec::new();
    for segment in unified.split('/') {
        match segment {
            "" | "." => continue,
            ".." => return Err("caminho contém '..'".to_string()),
            other => segments.push(other),
        }
    }
    if segments.is_empty() {
        return Err("caminho vazio".to_string());
    }
    Ok(segments.join("/"))
}

/// Valida um caminho relativo de mod (normalização + defesa por componentes).
pub fn validate_relative_mod_path(value: &str, label: &str) -> Result<String, String> {
    let normalized = normalize_relative_path(value).map_err(|e| format!("{label}: {e}"))?;
    if Path::new(&normalized)
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
    {
        return Err(format!("{label}: caminho inválido"));
    }
    Ok(normalized)
}

fn validate_text(value: &str, label: &str, max_len: usize, allow_empty: bool) -> Result<(), String> {
    if value.len() > max_len || value.contains('\0') || (!allow_empty && value.trim().is_empty()) {
        return Err(format!("{label} inválido"));
    }
    Ok(())
}

/// Valida o manifesto (regras únicas TS/Rust).
pub fn validate_manifest(manifest: &ModManifestDto) -> Result<(), String> {
    if !is_mod_id(&manifest.mod_id) {
        return Err("modId inválido".to_string());
    }
    validate_text(&manifest.name, "name", MAX_NAME_LEN, false)?;
    if !is_semver(&manifest.version) {
        return Err("version precisa ser semver".to_string());
    }
    validate_text(&manifest.author, "author", MAX_TEXT_LEN, true)?;
    validate_text(&manifest.description, "description", MAX_TEXT_LEN, true)?;
    if !manifest.min_engine_version.is_empty() && !is_semver(&manifest.min_engine_version) {
        return Err("minEngineVersion precisa ser semver ou vazio".to_string());
    }

    if let Some(entry) = manifest.entry_script.as_deref() {
        let normalized = validate_relative_mod_path(entry, "entryScript")?;
        if !(normalized.ends_with(".js") || normalized.ends_with(".mjs")) {
            return Err("entryScript precisa ser .js/.mjs".to_string());
        }
    }

    let overrides = manifest.overrides.as_deref().unwrap_or(&[]);
    if overrides.len() > MAX_OVERRIDES {
        return Err(format!("no máximo {MAX_OVERRIDES} overrides"));
    }
    for entry in overrides {
        validate_relative_mod_path(&entry.virtual_path, "override.virtualPath")?;
        validate_relative_mod_path(&entry.real_path, "override.realPath")?;
        if entry.mod_id != manifest.mod_id {
            return Err("override.modId precisa ser o modId do manifesto".to_string());
        }
        if !entry.priority.is_finite() {
            return Err("override.priority precisa ser finito".to_string());
        }
    }

    let dependencies = manifest.dependencies.as_deref().unwrap_or(&[]);
    if dependencies.len() > MAX_DEPENDENCIES {
        return Err(format!("no máximo {MAX_DEPENDENCIES} dependências"));
    }
    let mut seen = std::collections::HashSet::new();
    for dependency in dependencies {
        if !is_mod_id(&dependency.mod_id) || dependency.mod_id == manifest.mod_id {
            return Err("dependency.modId inválido".to_string());
        }
        if !seen.insert(dependency.mod_id.as_str()) {
            return Err("dependência duplicada".to_string());
        }
        if !is_semver(&dependency.min_version) {
            return Err("dependency.minVersion precisa ser semver".to_string());
        }
    }

    Ok(())
}

/// Lê e valida `mod.json` de uma pasta (sem seguir para fora dela).
fn read_manifest(folder: &Path) -> Result<ModManifestDto, String> {
    let manifest_path = folder.join("mod.json");
    let metadata = fs::symlink_metadata(&manifest_path).map_err(|_| "mod.json ausente".to_string())?;
    if !metadata.is_file() {
        return Err("mod.json não é arquivo regular".to_string());
    }
    if metadata.len() > MAX_MOD_MANIFEST_BYTES {
        return Err("mod.json excede 1 MiB".to_string());
    }
    let content = fs::read_to_string(&manifest_path).map_err(|e| format!("falha ao ler mod.json: {e}"))?;
    let manifest: ModManifestDto =
        serde_json::from_str(&content).map_err(|e| format!("mod.json inválido: {e}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

/// Resolve `relative` dentro de `root` (ambos canônicos) e garante que o
/// destino continua dentro de `root` (symlinks incluídos).
pub fn resolve_inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = validate_relative_mod_path(relative, "arquivo")?;
    let candidate = root.join(normalized);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "arquivo do mod não encontrado".to_string())?;
    if !canonical.starts_with(root) {
        return Err("caminho escapa da pasta do mod".to_string());
    }
    Ok(canonical)
}

fn mods_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Falha ao resolver app_data_dir: {error}"))?
        .join("mods");
    fs::create_dir_all(&dir).map_err(|error| format!("Falha ao criar diretório de mods: {error}"))?;
    dir.canonicalize()
        .map_err(|error| format!("Falha ao normalizar diretório de mods: {error}"))
}

fn scan_folder(root: &Path, source: &str, workshop_item_id: Option<String>) -> InstalledModDto {
    let folder_name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    match read_manifest(root) {
        Ok(manifest) => InstalledModDto {
            manifest: Some(manifest),
            root_path: root.to_string_lossy().into_owned(),
            folder_name,
            source: source.to_string(),
            workshop_item_id,
            error: None,
        },
        Err(error) => InstalledModDto {
            manifest: None,
            root_path: root.to_string_lossy().into_owned(),
            folder_name,
            source: source.to_string(),
            workshop_item_id,
            error: Some(error),
        },
    }
}

fn scan_local(mods_root: &Path) -> Vec<InstalledModDto> {
    let mut result = Vec::new();
    let Ok(entries) = fs::read_dir(mods_root) else {
        return result;
    };
    for entry in entries.flatten().take(MAX_INSTALLED_MODS) {
        // Não segue symlinks de diretório no discovery.
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_dir() {
            continue;
        }
        let Ok(canonical) = entry.path().canonicalize() else { continue };
        if !canonical.starts_with(mods_root) {
            continue;
        }
        result.push(scan_folder(&canonical, "local", None));
    }
    result
}

#[cfg(feature = "steam")]
fn scan_workshop(state: &crate::steam::SteamState) -> Vec<InstalledModDto> {
    let Ok(client) = state.client() else {
        return Vec::new();
    };
    let ugc = client.ugc();
    let mut result = Vec::new();
    for item in ugc.subscribed_items().into_iter().take(MAX_INSTALLED_MODS) {
        let Some(info) = ugc.item_install_info(item) else { continue };
        let Ok(folder) = PathBuf::from(&info.folder).canonicalize() else { continue };
        if !folder.is_dir() {
            continue;
        }
        result.push(scan_folder(&folder, "workshop", Some(item.0.to_string())));
    }
    result
}

#[cfg(not(feature = "steam"))]
fn scan_workshop(_state: &crate::steam::SteamState) -> Vec<InstalledModDto> {
    Vec::new()
}

fn list_all(app: &tauri::AppHandle) -> Result<Vec<InstalledModDto>, String> {
    let root = mods_dir(app)?;
    let mut mods = scan_local(&root);
    let state = app.state::<crate::steam::SteamState>();
    mods.extend(scan_workshop(&state));
    mods.sort_by(|a, b| a.root_path.cmp(&b.root_path));
    Ok(mods)
}

// ── comandos ───────────────────────────────────────────────────────────────

/// Manifestos VÁLIDOS dos mods locais (compatibilidade).
#[tauri::command]
pub async fn modding_scan_local_mods(app: tauri::AppHandle) -> Result<Vec<ModManifestDto>, String> {
    let root = mods_dir(&app)?;
    let mut manifests: Vec<ModManifestDto> = scan_local(&root)
        .into_iter()
        .filter_map(|entry| {
            if let Some(error) = &entry.error {
                eprintln!("[Rust Modding] Mod ignorado {:?}: {error}", entry.root_path);
            }
            entry.manifest
        })
        .collect();
    manifests.sort_by(|first, second| first.mod_id.cmp(&second.mod_id));
    Ok(manifests)
}

/// Todos os mods instalados (locais + Workshop), válidos e inválidos (G117/G118).
#[tauri::command]
pub async fn modding_list_installed_mods(app: tauri::AppHandle) -> Result<Vec<InstalledModDto>, String> {
    list_all(&app)
}

/// Lê um arquivo de um mod instalado (path-safe; até 32 MiB) como bytes crus.
#[tauri::command]
pub async fn modding_read_mod_file(
    app: tauri::AppHandle,
    mod_id: String,
    relative_path: String,
) -> Result<tauri::ipc::Response, String> {
    if !is_mod_id(&mod_id) {
        return Err("modId inválido".to_string());
    }
    let installed = list_all(&app)?;
    let entry = installed
        .into_iter()
        .find(|entry| entry.manifest.as_ref().is_some_and(|m| m.mod_id == mod_id))
        .ok_or_else(|| format!("Mod não instalado: {mod_id}"))?;
    let root = PathBuf::from(&entry.root_path);
    let target = resolve_inside(&root, &relative_path)?;
    let metadata = fs::metadata(&target).map_err(|e| format!("Falha ao ler arquivo: {e}"))?;
    if !metadata.is_file() || metadata.len() > MAX_MOD_FILE_BYTES {
        return Err("Arquivo de mod inválido ou maior que 32 MiB".to_string());
    }
    let bytes = fs::read(&target).map_err(|e| format!("Falha ao ler arquivo: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

pub fn validate_enabled_list(ids: &[String]) -> Result<(), String> {
    if ids.len() > MAX_ENABLED_MODS || ids.iter().any(|id| !is_mod_id(id)) {
        return Err("Lista de mods ativos inválida".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn modding_load_enabled_mods(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let path = mods_dir(&app)?.join(ENABLED_FILE);
    let Ok(content) = fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };
    let ids: Vec<String> = serde_json::from_str(&content).unwrap_or_default();
    Ok(ids.into_iter().filter(|id| is_mod_id(id)).take(MAX_ENABLED_MODS).collect())
}

#[tauri::command]
pub async fn modding_save_enabled_mods(app: tauri::AppHandle, mod_ids: Vec<String>) -> Result<bool, String> {
    validate_enabled_list(&mod_ids)?;
    let path = mods_dir(&app)?.join(ENABLED_FILE);
    let content = serde_json::to_string(&mod_ids).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, content).map_err(|e| format!("Falha ao salvar mods ativos: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("Falha ao salvar mods ativos: {e}"))?;
    Ok(true)
}

fn validate_workshop_item_id(item_id: &str) -> Result<u64, String> {
    let normalized = item_id.trim();
    if normalized.is_empty()
        || normalized.len() > MAX_WORKSHOP_ID_LEN
        || !normalized.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("Workshop item_id inválido.".to_string());
    }
    normalized
        .parse::<u64>()
        .map_err(|_| "Workshop item_id fora do intervalo suportado.".to_string())
}

/// Pasta de publicação: precisa estar DENTRO de `<app_data_dir>/mods`
/// (aceita o modId/nome da pasta ou um caminho que resolva para lá).
pub fn resolve_publish_folder(mods_root: &Path, requested: &str) -> Result<PathBuf, String> {
    let trimmed = requested.trim();
    if trimmed.is_empty() || trimmed.len() > 4096 || trimmed.contains('\0') {
        return Err("Pasta de publicação inválida".to_string());
    }
    let candidate = if is_mod_id(trimmed) {
        mods_root.join(trimmed)
    } else {
        PathBuf::from(trimmed)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "Pasta de publicação não existe".to_string())?;
    if !canonical.starts_with(mods_root) || canonical == mods_root || !canonical.is_dir() {
        return Err("A pasta publicada precisa estar dentro do diretório de mods do jogo".to_string());
    }
    read_manifest(&canonical)?;
    Ok(canonical)
}

#[cfg(feature = "steam")]
mod workshop {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    const PUBLISH_TIMEOUT: Duration = Duration::from_secs(600);
    const SUBSCRIBE_TIMEOUT: Duration = Duration::from_secs(30);

    pub fn item_state(state: &crate::steam::SteamState, item: u64) -> Result<WorkshopItemStateDto, String> {
        let client = state.client()?;
        let ugc = client.ugc();
        let id = steamworks::PublishedFileId(item);
        let flags = ugc.item_state(id);
        let (downloaded, total) = ugc.item_download_info(id).unwrap_or((0, 0));
        Ok(WorkshopItemStateDto {
            item_id: item.to_string(),
            subscribed: flags.contains(steamworks::ItemState::SUBSCRIBED),
            installed: flags.contains(steamworks::ItemState::INSTALLED),
            downloading: flags.contains(steamworks::ItemState::DOWNLOADING),
            download_pending: flags.contains(steamworks::ItemState::DOWNLOAD_PENDING),
            needs_update: flags.contains(steamworks::ItemState::NEEDS_UPDATE),
            bytes_downloaded: downloaded,
            bytes_total: total,
        })
    }

    pub fn subscribe_blocking(client: steamworks::Client, item: u64) -> Result<bool, String> {
        let (sender, receiver) = mpsc::sync_channel::<Result<(), String>>(1);
        client
            .ugc()
            .subscribe_item(steamworks::PublishedFileId(item), move |result| {
                let _ = sender.send(result.map_err(|e| format!("SubscribeItem falhou: {e:?}")));
            });
        receiver
            .recv_timeout(SUBSCRIBE_TIMEOUT)
            .map_err(|e| format!("Timeout aguardando SubscribeItem: {e}"))??;
        Ok(true)
    }

    pub fn publish_blocking(
        client: steamworks::Client,
        folder: PathBuf,
        title: String,
        description: String,
    ) -> Result<String, String> {
        let app_id = client.utils().app_id();
        let (sender, receiver) = mpsc::sync_channel::<Result<(steamworks::PublishedFileId, bool), String>>(1);
        client
            .ugc()
            .create_item(app_id, steamworks::FileType::Community, move |result| {
                let _ = sender.send(result.map_err(|e| format!("CreateItem falhou: {e:?}")));
            });
        let (file_id, _needs_agreement) = receiver
            .recv_timeout(PUBLISH_TIMEOUT)
            .map_err(|e| format!("Timeout aguardando CreateItem: {e}"))??;

        let mut update = client
            .ugc()
            .start_item_update(app_id, file_id)
            .title(&title)
            .description(&description)
            .content_path(&folder);
        let preview = folder.join("preview.png");
        if preview.is_file() {
            update = update.preview_path(&preview);
        }

        let (sender, receiver) = mpsc::sync_channel::<Result<(steamworks::PublishedFileId, bool), String>>(1);
        let _watch = update.submit(None, move |result| {
            let _ = sender.send(result.map_err(|e| format!("SubmitItemUpdate falhou: {e:?}")));
        });
        let (published, needs_agreement) = receiver
            .recv_timeout(PUBLISH_TIMEOUT)
            .map_err(|e| format!("Timeout aguardando SubmitItemUpdate: {e}"))??;
        if needs_agreement {
            eprintln!("[Rust Modding] Usuário precisa aceitar o acordo legal do Workshop.");
        }
        Ok(published.0.to_string())
    }
}

#[cfg(feature = "steam")]
#[tauri::command]
pub async fn modding_download_workshop_item(
    app: tauri::AppHandle,
    item_id: String,
) -> Result<bool, String> {
    let item = validate_workshop_item_id(&item_id)?;
    let state = app.state::<crate::steam::SteamState>();
    let client = state.client()?;
    let current = workshop::item_state(&state, item)?;
    if !current.subscribed {
        let worker_client = client.clone();
        tauri::async_runtime::spawn_blocking(move || workshop::subscribe_blocking(worker_client, item))
            .await
            .map_err(|e| format!("Worker SubscribeItem falhou: {e}"))??;
    }
    Ok(client.ugc().download_item(steamworks::PublishedFileId(item), true))
}

#[cfg(not(feature = "steam"))]
#[tauri::command]
pub async fn modding_download_workshop_item(item_id: String) -> Result<bool, String> {
    validate_workshop_item_id(&item_id)?;
    Err("Steam Workshop indisponível: build sem a feature `steam`".to_string())
}

#[cfg(feature = "steam")]
#[tauri::command]
pub async fn modding_workshop_item_state(
    app: tauri::AppHandle,
    item_id: String,
) -> Result<WorkshopItemStateDto, String> {
    let item = validate_workshop_item_id(&item_id)?;
    let state = app.state::<crate::steam::SteamState>();
    workshop::item_state(&state, item)
}

#[cfg(not(feature = "steam"))]
#[tauri::command]
pub async fn modding_workshop_item_state(item_id: String) -> Result<WorkshopItemStateDto, String> {
    validate_workshop_item_id(&item_id)?;
    Err("Steam Workshop indisponível: build sem a feature `steam`".to_string())
}

fn validate_publish_text(title: &str, description: &str) -> Result<(), String> {
    validate_text(title.trim(), "title", MAX_TITLE_LEN, false)?;
    validate_text(description, "description", MAX_TEXT_LEN, true)?;
    Ok(())
}

#[cfg(feature = "steam")]
#[tauri::command]
pub async fn modding_publish_workshop_item(
    app: tauri::AppHandle,
    local_folder_path: String,
    title: String,
    description: String,
) -> Result<String, String> {
    validate_publish_text(&title, &description)?;
    let root = mods_dir(&app)?;
    let folder = resolve_publish_folder(&root, &local_folder_path)?;
    let client = app.state::<crate::steam::SteamState>().client()?;
    let title = title.trim().to_string();
    tauri::async_runtime::spawn_blocking(move || workshop::publish_blocking(client, folder, title, description))
        .await
        .map_err(|e| format!("Worker de publicação falhou: {e}"))?
}

#[cfg(not(feature = "steam"))]
#[tauri::command]
pub async fn modding_publish_workshop_item(
    app: tauri::AppHandle,
    local_folder_path: String,
    title: String,
    description: String,
) -> Result<String, String> {
    validate_publish_text(&title, &description)?;
    let root = mods_dir(&app)?;
    resolve_publish_folder(&root, &local_folder_path)?;
    Err("Steam Workshop indisponível: build sem a feature `steam`".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct FixtureCase {
        name: String,
        valid: bool,
        manifest: serde_json::Value,
    }

    #[test]
    fn manifest_rules_match_shared_fixture() {
        let cases: Vec<FixtureCase> =
            serde_json::from_str(include_str!("../fixtures/mod-manifests.json")).unwrap();
        assert!(cases.len() >= 10);
        for case in cases {
            let parsed = serde_json::from_value::<ModManifestDto>(case.manifest.clone());
            let ok = match parsed {
                Ok(manifest) => validate_manifest(&manifest).is_ok(),
                Err(_) => false,
            };
            assert_eq!(ok, case.valid, "fixture '{}'", case.name);
        }
    }

    #[test]
    fn relative_path_normalization() {
        assert_eq!(normalize_relative_path("./a//b\\c.png").unwrap(), "a/b/c.png");
        assert!(normalize_relative_path("../x").is_err());
        assert!(normalize_relative_path("a/../../x").is_err());
        assert!(normalize_relative_path("/etc/passwd").is_err());
        assert!(normalize_relative_path("C:/x").is_err());
        assert!(normalize_relative_path("a\0b").is_err());
        assert!(normalize_relative_path("./").is_err());
    }

    #[test]
    fn semver_rules() {
        assert!(is_semver("1.0.0"));
        assert!(is_semver("10.20.30-beta.1"));
        assert!(!is_semver("1.0"));
        assert!(!is_semver("v1.0.0"));
        assert!(!is_semver("1.0.0-"));
    }

    #[test]
    fn resolve_inside_blocks_escape() {
        let base = std::env::temp_dir().join(format!("modding-test-{}", std::process::id()));
        let root = base.join("mods").join("m");
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("assets").join("a.txt"), b"ok").unwrap();
        fs::write(base.join("secret.txt"), b"no").unwrap();
        let root = root.canonicalize().unwrap();
        assert!(resolve_inside(&root, "assets/a.txt").is_ok());
        assert!(resolve_inside(&root, "../../secret.txt").is_err());
        assert!(resolve_inside(&root, "missing.txt").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(base.join("secret.txt"), root.join("link.txt")).unwrap();
            assert!(resolve_inside(&root, "link.txt").is_err());
        }
        let mods_root = base.join("mods").canonicalize().unwrap();
        fs::write(root.join("mod.json"), r#"{"modId":"m","name":"M","version":"1.0.0","author":"","description":"","minEngineVersion":""}"#).unwrap();
        assert!(resolve_publish_folder(&mods_root, "m").is_ok());
        assert!(resolve_publish_folder(&mods_root, base.to_str().unwrap()).is_err());
        assert!(resolve_publish_folder(&mods_root, mods_root.to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn enabled_list_validation() {
        assert!(validate_enabled_list(&["a".into(), "b.c".into()]).is_ok());
        assert!(validate_enabled_list(&["../x".into()]).is_err());
    }
}
