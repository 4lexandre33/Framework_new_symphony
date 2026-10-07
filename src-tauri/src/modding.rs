use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

const MAX_MOD_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_IDENTIFIER_LEN: usize = 128;
const MAX_TEXT_LEN: usize = 8 * 1024;
const MAX_LOCAL_PATH_LEN: usize = 4096;
const MAX_WORKSHOP_ID_LEN: usize = 20;
const MAX_TITLE_LEN: usize = 128;

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

        // Não segue symlink de diretório no discovery de mods.
        if !file_type.is_dir() {
            continue;
        }

        let manifest_path = entry.path().join("mod.json");
        if !manifest_path.is_file() {
            continue;
        }

        let metadata = match fs::metadata(&manifest_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                eprintln!(
                    "[Rust Modding] Falha ao ler metadata de {:?}: {error}",
                    manifest_path
                );
                continue;
            }
        };

        if metadata.len() > MAX_MOD_MANIFEST_BYTES {
            eprintln!(
                "[Rust Modding] Manifesto ignorado por exceder {} bytes: {:?}",
                MAX_MOD_MANIFEST_BYTES,
                manifest_path
            );
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
            Ok(manifest) => {
                if let Err(error) = validate_manifest(&manifest) {
                    eprintln!(
                        "[Rust Modding] Manifesto rejeitado {:?}: {error}",
                        manifest_path
                    );
                    continue;
                }

                manifests.push(manifest);
            }
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
    validate_workshop_item_id(&item_id)?;

    Err(
        "Bridge legado modding_download_workshop_item desabilitado: use o adapter Steamworks real."
            .to_string(),
    )
}

#[tauri::command]
pub async fn modding_publish_workshop_item(
    local_folder_path: String,
    title: String,
    description: String,
) -> Result<String, String> {
    validate_publish_request(
        &local_folder_path,
        &title,
        &description,
    )?;

    let folder = PathBuf::from(local_folder_path.trim());
    let canonical_folder = validate_mod_directory(&folder)?;

    Err(format!(
        "Publicação Workshop nativa ainda não configurada para a pasta segura {:?}.",
        canonical_folder
    ))
}

fn validate_manifest(
    manifest: &ModManifestDto,
) -> Result<(), String> {
    validate_identifier(&manifest.mod_id, "mod_id")?;
    validate_text(&manifest.name, "name", MAX_TEXT_LEN)?;
    validate_text(&manifest.version, "version", MAX_IDENTIFIER_LEN)?;
    validate_text(&manifest.author, "author", MAX_TEXT_LEN)?;
    validate_text(&manifest.description, "description", MAX_TEXT_LEN)?;
    validate_text(
        &manifest.min_engine_version,
        "min_engine_version",
        MAX_IDENTIFIER_LEN,
    )?;

    if let Some(entry_script) = manifest.entry_script.as_deref() {
        validate_relative_mod_path(entry_script, "entry_script")?;
    }

    for override_entry in manifest.overrides.as_deref().unwrap_or(&[]) {
        validate_text(
            &override_entry.virtual_path,
            "override.virtual_path",
            MAX_TEXT_LEN,
        )?;
        validate_relative_mod_path(
            &override_entry.real_path,
            "override.real_path",
        )?;
        validate_identifier(
            &override_entry.mod_id,
            "override.mod_id",
        )?;

        if override_entry.mod_id != manifest.mod_id {
            return Err(
                "override.mod_id precisa corresponder ao mod_id do manifesto."
                    .to_string(),
            );
        }

        if !override_entry.priority.is_finite() {
            return Err(
                "override.priority precisa ser finito."
                    .to_string(),
            );
        }
    }

    for dependency in manifest.dependencies.as_deref().unwrap_or(&[]) {
        validate_identifier(
            &dependency.mod_id,
            "dependency.mod_id",
        )?;
        validate_text(
            &dependency.min_version,
            "dependency.min_version",
            MAX_IDENTIFIER_LEN,
        )?;
    }

    Ok(())
}

fn validate_publish_request(
    local_folder_path: &str,
    title: &str,
    description: &str,
) -> Result<(), String> {
    let normalized_path = local_folder_path.trim();
    if normalized_path.is_empty()
        || normalized_path.len() > MAX_LOCAL_PATH_LEN
        || normalized_path.contains('\0')
    {
        return Err(
            "local_folder_path inválido."
                .to_string(),
        );
    }

    validate_text(
        title.trim(),
        "title",
        MAX_TITLE_LEN,
    )?;

    if description.len() > MAX_TEXT_LEN
        || description.contains('\0')
    {
        return Err(
            "description inválida."
                .to_string(),
        );
    }

    Ok(())
}

fn validate_workshop_item_id(
    item_id: &str,
) -> Result<u64, String> {
    let normalized = item_id.trim();

    if normalized.is_empty()
        || normalized.len() > MAX_WORKSHOP_ID_LEN
        || !normalized.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(
            "Workshop item_id inválido."
                .to_string(),
        );
    }

    normalized
        .parse::<u64>()
        .map_err(|_| "Workshop item_id fora do intervalo suportado.".to_string())
}

fn validate_identifier(
    value: &str,
    label: &str,
) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_LEN
        || value.contains('\0')
    {
        return Err(
            format!("{label} inválido."),
        );
    }

    Ok(())
}

fn validate_text(
    value: &str,
    label: &str,
    max_len: usize,
) -> Result<(), String> {
    if value.is_empty()
        || value.len() > max_len
        || value.contains('\0')
    {
        return Err(
            format!("{label} inválido."),
        );
    }

    Ok(())
}

fn validate_relative_mod_path(
    value: &str,
    label: &str,
) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_LOCAL_PATH_LEN
        || value.contains('\0')
    {
        return Err(
            format!("{label} inválido."),
        );
    }

    let path = Path::new(value);

    if path.is_absolute() {
        return Err(
            format!("{label} precisa ser relativo ao diretório do mod."),
        );
    }

    if path
        .components()
        .any(|component| matches!(
            component,
            Component::ParentDir
                | Component::RootDir
                | Component::Prefix(_)
        ))
    {
        return Err(
            format!("{label} contém traversal de diretório."),
        );
    }

    Ok(())
}

fn validate_mod_directory(
    path: &Path,
) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(
            format!("Pasta do mod não existe: {:?}", path),
        );
    }

    if !path.is_dir() {
        return Err(
            format!("Caminho do mod não é diretório: {:?}", path),
        );
    }

    let canonical = path
        .canonicalize()
        .map_err(|error| {
            format!(
                "Falha ao normalizar pasta do mod {:?}: {error}",
                path
            )
        })?;

    let manifest_path = canonical.join("mod.json");

    if !manifest_path.is_file() {
        return Err(
            format!("mod.json não encontrado em {:?}", canonical),
        );
    }

    let metadata = fs::metadata(&manifest_path)
        .map_err(|error| {
            format!(
                "Falha ao ler metadata de {:?}: {error}",
                manifest_path
            )
        })?;

    if metadata.len() > MAX_MOD_MANIFEST_BYTES {
        return Err(
            format!(
                "mod.json excede o limite de {} bytes.",
                MAX_MOD_MANIFEST_BYTES
            ),
        );
    }

    Ok(canonical)
}
