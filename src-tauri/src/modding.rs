use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModDependencyDto {
    pub mod_id: String,
    pub min_version: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetOverrideDto {
    pub virtual_path: String,
    pub real_path: String,
    pub mod_id: String,
    pub priority: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModManifestDto {
    pub mod_id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub min_engine_version: String,
    pub entry_script: Option<String>,
    pub overrides: Option<Vec<AssetOverrideDto>>,
    pub dependencies: Option<Vec<ModDependencyDto>>,
}

#[tauri::command]
pub async fn modding_scan_local_mods(
    app: tauri::AppHandle,
) -> Result<Vec<ModManifestDto>, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Falha ao resolver app_data_dir: {error}"))?;

    let mods_dir = app_dir.join("mods");

    fs::create_dir_all(&mods_dir)
        .map_err(|error| format!("Falha ao criar diretório de mods {:?}: {error}", mods_dir))?;

    let entries = fs::read_dir(&mods_dir)
        .map_err(|error| format!("Falha ao listar diretório de mods {:?}: {error}", mods_dir))?;

    let mut manifests = Vec::new();

    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                eprintln!("[Rust Modding] Entrada de diretório ignorada: {error}");
                continue;
            }
        };

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                eprintln!(
                    "[Rust Modding] Falha ao identificar tipo de {:?}: {error}",
                    entry.path()
                );
                continue;
            }
        };

        if !file_type.is_dir() {
            continue;
        }

        let manifest_path = entry.path().join("mod.json");
        if !manifest_path.is_file() {
            continue;
        }

        let content = match fs::read_to_string(&manifest_path) {
            Ok(content) => content,
            Err(error) => {
                eprintln!(
                    "[Rust Modding] Falha ao ler {:?}: {error}",
                    manifest_path
                );
                continue;
            }
        };

        match serde_json::from_str::<ModManifestDto>(&content) {
            Ok(manifest) => manifests.push(manifest),
            Err(error) => {
                eprintln!(
                    "[Rust Modding] Manifesto inválido {:?}: {error}",
                    manifest_path
                );
            }
        }
    }

    manifests.sort_by(|first, second| first.mod_id.cmp(&second.mod_id));
    Ok(manifests)
}

#[tauri::command]
pub async fn modding_download_workshop_item(
    item_id: String,
) -> Result<bool, String> {
    let normalized = item_id.trim();

    if normalized.is_empty() {
        return Err("Workshop item_id vazio.".to_string());
    }

    normalized
        .parse::<u64>()
        .map_err(|_| format!("Workshop item_id inválido: {normalized}"))?;

    println!(
        "[Rust Modding] Solicitação de download de item da Oficina da Steam: {}",
        normalized
    );

    Ok(true)
}

#[tauri::command]
pub async fn modding_publish_workshop_item(
    local_folder_path: String,
    title: String,
    description: String,
) -> Result<String, String> {
    let normalized_title = title.trim();
    if normalized_title.is_empty() {
        return Err("Título do mod é obrigatório.".to_string());
    }

    let folder = PathBuf::from(local_folder_path.trim());
    validate_mod_directory(&folder)?;

    let canonical_folder = folder
        .canonicalize()
        .map_err(|error| format!("Falha ao normalizar pasta do mod {:?}: {error}", folder))?;

    println!(
        "[Rust Modding] Solicitação de publicação na Oficina da Steam: {} | Pasta: {:?} | Descrição: {} bytes",
        normalized_title,
        canonical_folder,
        description.len()
    );

    let identity = format!(
        "{}|{}",
        normalized_title,
        canonical_folder.to_string_lossy()
    );

    Ok(format!("ugc_published_{}", item_id_hash(&identity)))
}

fn validate_mod_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Pasta do mod não existe: {:?}", path));
    }

    if !path.is_dir() {
        return Err(format!("Caminho do mod não é diretório: {:?}", path));
    }

    let manifest_path = path.join("mod.json");
    if !manifest_path.is_file() {
        return Err(format!("mod.json não encontrado em {:?}", path));
    }

    Ok(())
}

fn item_id_hash(value: &str) -> u64 {
    let mut hash = 5381u64;

    for byte in value.bytes() {
        hash = ((hash << 5).wrapping_add(hash)).wrapping_add(byte as u64);
    }

    hash
}
