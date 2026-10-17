//! Adapter Steam OFFLINE: compilado quando a feature `steam` está desligada.
//!
//! Mantém exatamente os mesmos nomes de comandos Tauri do adapter real
//! (`steam.rs`) para que o WebView degrade de forma honesta: consultas
//! retornam "não inicializado" e operações retornam erro serializável.
//! Nenhum dado é fabricado.

use crate::steam_support::{LobbySearchDto, SteamEventDto};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::State;

const OFFLINE_MESSAGE: &str = "Steam indisponível: build sem a feature `steam`";

pub struct SteamState;

impl SteamState {
    pub fn initialize() -> Self {
        eprintln!("[Steamworks] {OFFLINE_MESSAGE}. Aplicação seguirá em modo offline.");
        Self
    }

    #[allow(dead_code)]
    pub fn is_initialized(&self) -> bool {
        false
    }

    pub fn shutdown(&self) {}
}

fn offline<T>() -> Result<T, String> {
    Err(OFFLINE_MESSAGE.to_string())
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamRuntimeStatusDto {
    pub initialized: bool,
    pub callback_thread_running: bool,
    pub initialization_error: Option<String>,
    pub stats_ready: bool,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamLobbyDto {
    pub lobby_id: String,
    pub owner_steam_id: String,
    pub member_count: u32,
    pub max_members: u32,
    pub metadata: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamP2PBatchDto {
    pub packets: Vec<serde_json::Value>,
    pub dropped_oversized: u32,
}

#[tauri::command]
pub fn steam_runtime_status(_state: State<'_, SteamState>) -> SteamRuntimeStatusDto {
    SteamRuntimeStatusDto {
        initialized: false,
        callback_thread_running: false,
        initialization_error: Some(OFFLINE_MESSAGE.to_string()),
        stats_ready: false,
    }
}

#[tauri::command]
pub fn steam_is_initialized(_state: State<'_, SteamState>) -> bool {
    false
}

#[tauri::command]
pub fn steam_poll_events(_max_events: u32) -> Result<Vec<SteamEventDto>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub fn steam_get_user() -> Result<serde_json::Value, String> {
    offline()
}

#[tauri::command]
pub fn steam_unlock_achievement(_achievement_id: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_set_stat(_stat_name: String, _value: i32) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_set_stat_float(_stat_name: String, _value: f64) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_get_stat(_stat_name: String, _kind: String) -> Result<f64, String> {
    offline()
}

#[tauri::command]
pub fn steam_store_stats() -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_create_lobby(_lobby_type: String, _max_members: u32) -> Result<SteamLobbyDto, String> {
    offline()
}

#[tauri::command]
pub fn steam_join_lobby(_lobby_id: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_leave_lobby(_lobby_id: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_set_lobby_data(_lobby_id: String, _key: String, _value: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_get_lobby_data(_lobby_id: String, _key: String) -> Result<Option<String>, String> {
    offline()
}

#[tauri::command]
pub fn steam_request_lobby_list(_search: Option<LobbySearchDto>) -> Result<Vec<SteamLobbyDto>, String> {
    offline()
}

#[tauri::command]
pub fn steam_get_lobby_details(_lobby_id: String) -> Result<SteamLobbyDto, String> {
    offline()
}

#[tauri::command]
pub fn steam_get_lobby_members(_lobby_id: String) -> Result<Vec<String>, String> {
    offline()
}

#[tauri::command]
pub fn steam_invite_to_lobby(_lobby_id: String, _invitee_steam_id: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_activate_invite_dialog(_lobby_id: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_set_lobby_joinable(_lobby_id: String, _joinable: bool) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_send_p2p_packet(
    _target_steam_id: String,
    _data: Vec<u8>,
    _send_type: String,
    _channel: i32,
) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_read_p2p_packet(_channel: i32) -> Result<Option<serde_json::Value>, String> {
    offline()
}

#[tauri::command]
pub fn steam_read_p2p_packets(
    _max_packets: u32,
    _max_total_bytes: u32,
) -> Result<SteamP2PBatchDto, String> {
    offline()
}

#[tauri::command]
pub fn steam_accept_p2p_session(_remote_steam_id: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_close_p2p_session(_remote_steam_id: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_get_p2p_session_state(
    _remote_steam_id: String,
) -> Result<Option<serde_json::Value>, String> {
    offline()
}

#[tauri::command]
pub fn steam_cloud_status() -> Result<serde_json::Value, String> {
    offline()
}

#[tauri::command]
pub fn steam_cloud_list_files() -> Result<Vec<serde_json::Value>, String> {
    offline()
}

#[tauri::command]
pub fn steam_cloud_write_file(_file_name: String, _data: Vec<u8>) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_cloud_read_file(_file_name: String) -> Result<Option<Vec<u8>>, String> {
    offline()
}

#[tauri::command]
pub fn steam_cloud_delete_file(_file_name: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_overlay_is_enabled() -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_activate_overlay(_dialog: String) -> Result<bool, String> {
    offline()
}

#[tauri::command]
pub fn steam_workshop_download_item(
    _published_file_id: String,
    _high_priority: bool,
) -> Result<bool, String> {
    offline()
}
