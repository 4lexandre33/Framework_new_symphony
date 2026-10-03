use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

pub struct SteamState {
    pub client: Mutex<Option<steamworks::Client>>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamUserDto {
    pub steam_id: String,
    pub persona_name: String,
    pub is_overlay_enabled: bool,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamLobbyDto {
    pub lobby_id: String,
    pub owner_steam_id: String,
    pub member_count: u32,
    pub max_members: u32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamP2PPacketDto {
    pub source_steam_id: String,
    pub channel: i32,
    pub data: Vec<u8>,
    pub bytes_received: usize,
}

#[tauri::command]
pub fn steam_is_initialized(state: State<'_, SteamState>) -> bool {
    let guard = state.client.lock().unwrap();
    let is_init = guard.is_some();
    println!("[Steamworks Command] steam_is_initialized -> {}", is_init);
    is_init
}

#[tauri::command]
pub fn steam_get_user(state: State<'_, SteamState>) -> Result<SteamUserDto, String> {
    let guard = state.client.lock().unwrap();
    let client = guard.as_ref().ok_or_else(|| "Steam não inicializada".to_string())?;

    let user = client.user();
    let friends = client.friends();

    let user_dto = SteamUserDto {
        steam_id: user.steam_id().raw().to_string(),
        persona_name: friends.name(),
        is_overlay_enabled: true,
    };

    println!(
        "[Steamworks Command] steam_get_user -> {} (ID: {})",
        user_dto.persona_name, user_dto.steam_id
    );

    Ok(user_dto)
}

#[tauri::command]
pub fn steam_unlock_achievement(
    achievement_id: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let guard = state.client.lock().unwrap();
    let client = guard.as_ref().ok_or_else(|| "Steam não inicializada".to_string())?;

    let stats = client.user_stats();
    let achievement = stats.achievement(&achievement_id);

    match achievement.set() {
        Ok(_) => {
            let _ = stats.store_stats();
            println!(
                "[Steamworks Command] ✅ Conquista '{}' desbloqueada e salva na Steam!",
                achievement_id
            );
            Ok(true)
        }
        Err(e) => {
            eprintln!(
                "[Steamworks Command] ❌ Erro ao liberar conquista '{}': {:?}",
                achievement_id, e
            );
            Err(format!("Falha ao liberar conquista: {:?}", e))
        }
    }
}

#[tauri::command]
pub fn steam_set_stat(
    stat_name: String,
    value: i32,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let guard = state.client.lock().unwrap();
    let client = guard.as_ref().ok_or_else(|| "Steam não inicializada".to_string())?;

    let stats = client.user_stats();
    match stats.set_stat_i32(&stat_name, value) {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Falha ao atualizar estatística: {:?}", e)),
    }
}

#[tauri::command]
pub fn steam_store_stats(state: State<'_, SteamState>) -> Result<bool, String> {
    let guard = state.client.lock().unwrap();
    let client = guard.as_ref().ok_or_else(|| "Steam não inicializada".to_string())?;

    match client.user_stats().store_stats() {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Falha ao salvar estatísticas na Steam: {:?}", e)),
    }
}

#[tauri::command]
pub fn steam_create_lobby(
    lobby_type: String,
    max_members: u32,
    state: State<'_, SteamState>,
) -> Result<SteamLobbyDto, String> {
    let guard = state.client.lock().unwrap();
    let client = guard.as_ref().ok_or_else(|| "Steam não inicializada".to_string())?;

    let user = client.user();
    let steam_id = user.steam_id();

    println!(
        "[Steamworks P2P] Criando lobby ({}, max: {}) para host {}",
        lobby_type, max_members, steam_id.raw()
    );

    let mock_lobby_id = format!(
        "lobby_{}_{}",
        steam_id.raw(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    );

    Ok(SteamLobbyDto {
        lobby_id: mock_lobby_id,
        owner_steam_id: steam_id.raw().to_string(),
        member_count: 1,
        max_members,
    })
}

#[tauri::command]
pub fn steam_send_p2p_packet(
    target_steam_id: String,
    data: Vec<u8>,
    send_type: String,
    channel: i32,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let guard = state.client.lock().unwrap();
    let client = guard.as_ref().ok_or_else(|| "Steam não inicializada".to_string())?;

    let networking = client.networking();

    // Correção: Uso da enumeração correta steamworks::SendType da biblioteca
    let p2p_type = match send_type.as_str() {
        "reliable" => steamworks::SendType::Reliable,
        "reliableWithBuffering" => steamworks::SendType::ReliableWithBuffering,
        "unreliableNoDelay" => steamworks::SendType::UnreliableNoDelay,
        _ => steamworks::SendType::Unreliable,
    };

    let parsed_id = target_steam_id
        .parse::<u64>()
        .map_err(|e| format!("SteamID inválido: {}", e))?;
    let remote_id = steamworks::SteamId::from_raw(parsed_id);

    let success = networking.send_p2p_packet(remote_id, p2p_type, &data);
    println!(
        "[Steamworks P2P] Pacote de {} bytes enviado para {} (Canal: {}, Sucesso: {})",
        data.len(),
        target_steam_id,
        channel,
        success
    );

    Ok(success)
}

#[tauri::command]
pub fn steam_read_p2p_packet(
    channel: i32,
    state: State<'_, SteamState>,
) -> Result<Option<SteamP2PPacketDto>, String> {
    let guard = state.client.lock().unwrap();
    let client = guard.as_ref().ok_or_else(|| "Steam não inicializada".to_string())?;

    let networking = client.networking();

    if let Some(packet_size) = networking.is_p2p_packet_available() {
        let mut buffer = vec![0u8; packet_size];

        if let Some((remote_id, bytes_read)) = networking.read_p2p_packet(&mut buffer) {
            return Ok(Some(SteamP2PPacketDto {
                source_steam_id: remote_id.raw().to_string(),
                channel,
                bytes_received: bytes_read,
                data: buffer[..bytes_read].to_vec(),
            }));
        }
    }

    Ok(None)
}