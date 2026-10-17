use crate::steam_support::{
    classify_incoming_packet, clamp_count, validate_lobby_search, validate_stat_f32,
    LobbyComparison, LobbySearchDto, P2PBatchBudget, PacketDisposition, SteamEventDto,
    SteamEventQueue, MAX_LOBBY_SEARCH_RESULTS, MAX_PENDING_STEAM_EVENTS,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::CString;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::State;

const STEAM_CALLBACK_INTERVAL: Duration = Duration::from_millis(16);
const STEAM_ASYNC_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_STEAM_IDENTIFIER_LEN: usize = 128;
const MAX_LOBBY_METADATA_KEY_LEN: usize = 255;
const MAX_LOBBY_METADATA_VALUE_LEN: usize = 8 * 1024;
const MAX_CLOUD_FILE_NAME_LEN: usize = 240;
const MAX_P2P_CHANNEL: i32 = 255;
const MAX_P2P_UNRELIABLE_BYTES: usize = 1_200;
const MAX_P2P_RELIABLE_BYTES: usize = 1024 * 1024;

pub struct SteamState {
    client: Mutex<Option<steamworks::Client>>,
    callback_stop: Arc<AtomicBool>,
    callback_thread: Mutex<Option<JoinHandle<()>>>,
    initialization_error: Mutex<Option<String>>,
    events: Arc<Mutex<SteamEventQueue>>,
    stats_ready: Arc<AtomicBool>,
    callback_handles: Mutex<Vec<steamworks::CallbackHandle>>,
}

fn push_event(queue: &Arc<Mutex<SteamEventQueue>>, event: SteamEventDto) {
    if let Ok(mut guard) = queue.lock() {
        guard.push(event);
    }
}

fn chat_change_label(change: &steamworks::ChatMemberStateChange) -> &'static str {
    match change {
        steamworks::ChatMemberStateChange::Entered => "entered",
        steamworks::ChatMemberStateChange::Left => "left",
        steamworks::ChatMemberStateChange::Disconnected => "disconnected",
        steamworks::ChatMemberStateChange::Kicked => "kicked",
        steamworks::ChatMemberStateChange::Banned => "banned",
    }
}

/// Registra os callbacks Steam que alimentam a fila de eventos drenada pelo
/// WebView (`steam_poll_events`). Os handlers rodam na thread do callback pump
/// e apenas enfileiram dados (nenhuma chamada bloqueante).
fn register_event_callbacks(
    client: &steamworks::Client,
    events: &Arc<Mutex<SteamEventQueue>>,
    stats_ready: &Arc<AtomicBool>,
) -> Vec<steamworks::CallbackHandle> {
    let mut handles = Vec::new();
    let local_steam_id = client.user().steam_id().raw();

    let queue = Arc::clone(events);
    handles.push(client.register_callback(move |value: steamworks::P2PSessionRequest| {
        push_event(
            &queue,
            SteamEventDto::P2pSessionRequest {
                remote_steam_id: value.remote.raw().to_string(),
            },
        );
    }));

    let queue = Arc::clone(events);
    handles.push(client.register_callback(move |value: steamworks::P2PSessionConnectFail| {
        push_event(
            &queue,
            SteamEventDto::P2pSessionConnectFail {
                remote_steam_id: value.remote.raw().to_string(),
                error: value.error,
            },
        );
    }));

    let queue = Arc::clone(events);
    handles.push(client.register_callback(move |value: steamworks::LobbyChatUpdate| {
        push_event(
            &queue,
            SteamEventDto::LobbyChatUpdate {
                lobby_id: value.lobby.raw().to_string(),
                user_steam_id: value.user_changed.raw().to_string(),
                making_change_steam_id: value.making_change.raw().to_string(),
                change: chat_change_label(&value.member_state_change).to_string(),
            },
        );
    }));

    let queue = Arc::clone(events);
    handles.push(client.register_callback(move |value: steamworks::LobbyDataUpdate| {
        push_event(
            &queue,
            SteamEventDto::LobbyDataUpdate {
                lobby_id: value.lobby.raw().to_string(),
                member_steam_id: value.member.raw().to_string(),
                success: value.success,
            },
        );
    }));

    let queue = Arc::clone(events);
    handles.push(client.register_callback(move |value: steamworks::GameLobbyJoinRequested| {
        push_event(
            &queue,
            SteamEventDto::LobbyJoinRequested {
                lobby_id: value.lobby_steam_id.raw().to_string(),
                friend_steam_id: value.friend_steam_id.raw().to_string(),
            },
        );
    }));

    let queue = Arc::clone(events);
    let ready = Arc::clone(stats_ready);
    handles.push(client.register_callback(move |value: steamworks::UserStatsReceived| {
        let success = value.result.is_ok();
        if value.steam_id.raw() == local_steam_id && success {
            ready.store(true, Ordering::Release);
        }
        push_event(
            &queue,
            SteamEventDto::UserStatsReceived {
                steam_id: value.steam_id.raw().to_string(),
                success,
                error: value.result.err().map(|error| format!("{error:?}")),
            },
        );
    }));

    let queue = Arc::clone(events);
    handles.push(client.register_callback(
        move |value: steamworks::MicroTxnAuthorizationResponse| {
            push_event(
                &queue,
                SteamEventDto::MicroTxnAuthorization {
                    app_id: value.app_id.0,
                    order_id: value.order_id.to_string(),
                    authorized: value.authorized,
                },
            );
        },
    ));

    let queue = Arc::clone(events);
    handles.push(client.register_callback(move |value: steamworks::DownloadItemResult| {
        push_event(
            &queue,
            SteamEventDto::WorkshopDownloadResult {
                published_file_id: value.published_file_id.0.to_string(),
                success: value.error.is_none(),
                error: value.error.map(|error| format!("{error:?}")),
            },
        );
    }));

    let queue = Arc::clone(events);
    handles.push(client.register_callback(move |_: steamworks::SteamServersConnected| {
        push_event(&queue, SteamEventDto::SteamServersConnected);
    }));

    let queue = Arc::clone(events);
    handles.push(client.register_callback(move |_: steamworks::SteamServersDisconnected| {
        push_event(&queue, SteamEventDto::SteamServersDisconnected);
    }));

    handles
}

impl SteamState {
    pub fn initialize() -> Self {
        let callback_stop = Arc::new(AtomicBool::new(false));
        let events = Arc::new(Mutex::new(SteamEventQueue::new(MAX_PENDING_STEAM_EVENTS)));
        let stats_ready = Arc::new(AtomicBool::new(false));

        match steamworks::Client::init() {
            Ok((client, single_client)) => {
                let callback_handles = register_event_callbacks(&client, &events, &stats_ready);
                // Stats/conquistas só são confiáveis depois de UserStatsReceived (G112).
                client.user_stats().request_current_stats();
                let thread_stop = Arc::clone(&callback_stop);
                let callback_thread = thread::Builder::new()
                    .name("steamworks-callback-pump".to_string())
                    .spawn(move || {
                        while !thread_stop.load(Ordering::Acquire) {
                            single_client.run_callbacks();
                            thread::sleep(STEAM_CALLBACK_INTERVAL);
                        }

                        // Flush one final callback frame before SingleClient is dropped.
                        single_client.run_callbacks();
                    });

                match callback_thread {
                    Ok(handle) => {
                        println!(
                            "[Steamworks] Inicializado com sucesso; callback pump ativo."
                        );

                        Self {
                            client: Mutex::new(Some(client)),
                            callback_stop,
                            callback_thread: Mutex::new(Some(handle)),
                            initialization_error: Mutex::new(None),
                            events,
                            stats_ready,
                            callback_handles: Mutex::new(callback_handles),
                        }
                    }
                    Err(error) => {
                        let message = format!(
                            "Steam inicializou, mas o callback pump não pôde ser criado: {error}"
                        );
                        eprintln!("[Steamworks] {message}");

                        // `single_client` was moved into the spawn closure. If spawning
                        // fails, std drops that closure immediately, which drops SingleClient.
                        // We still own `client` here, so dropping it completes the failed-init
                        // cleanup without attempting to use a moved value.
                        for handle in &callback_handles {
                            handle.disconnect();
                        }
                        drop(callback_handles);
                        drop(client);

                        Self {
                            client: Mutex::new(None),
                            callback_stop,
                            callback_thread: Mutex::new(None),
                            initialization_error: Mutex::new(Some(message)),
                            events,
                            stats_ready,
                            callback_handles: Mutex::new(Vec::new()),
                        }
                    }
                }
            }
            Err(error) => {
                let message = format!("Steam indisponível: {error:?}");
                eprintln!("[Steamworks] {message}. Aplicação seguirá em modo offline.");

                Self {
                    client: Mutex::new(None),
                    callback_stop,
                    callback_thread: Mutex::new(None),
                    initialization_error: Mutex::new(Some(message)),
                    events,
                    stats_ready,
                    callback_handles: Mutex::new(Vec::new()),
                }
            }
        }
    }

    pub fn is_initialized(&self) -> bool {
        self.client
            .lock()
            .map(|client| client.is_some())
            .unwrap_or(false)
    }

    pub fn callback_thread_running(&self) -> bool {
        self.callback_thread
            .lock()
            .map(|slot| slot.as_ref().is_some_and(|handle| !handle.is_finished()))
            .unwrap_or(false)
    }

    pub fn initialization_error(&self) -> Option<String> {
        self.initialization_error
            .lock()
            .ok()
            .and_then(|value| value.clone())
    }

    pub fn stats_ready(&self) -> bool {
        self.stats_ready.load(Ordering::Acquire)
    }

    pub fn drain_events(&self, max_events: u32) -> Vec<SteamEventDto> {
        self.events
            .lock()
            .map(|mut queue| queue.drain(max_events))
            .unwrap_or_default()
    }

    pub(crate) fn client(&self) -> Result<steamworks::Client, String> {
        let guard = self
            .client
            .lock()
            .map_err(|_| "Mutex da Steam foi envenenada".to_string())?;

        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| {
                self.initialization_error()
                    .unwrap_or_else(|| "Steam não inicializada".to_string())
            })
    }

    pub fn shutdown(&self) {
        self.callback_stop.store(true, Ordering::Release);

        if let Ok(mut handles) = self.callback_handles.lock() {
            for handle in handles.drain(..) {
                handle.disconnect();
            }
        }

        let callback_handle = self
            .callback_thread
            .lock()
            .ok()
            .and_then(|mut slot| slot.take());

        if let Some(handle) = callback_handle {
            if let Err(error) = handle.join() {
                eprintln!("[Steamworks] Callback pump terminou com panic: {error:?}");
            }
        }

        if let Ok(mut client) = self.client.lock() {
            client.take();
        }

        println!("[Steamworks] Runtime encerrado com shutdown idempotente.");
    }
}

impl Drop for SteamState {
    fn drop(&mut self) {
        self.callback_stop.store(true, Ordering::Release);

        if let Ok(thread_slot) = self.callback_thread.get_mut() {
            if let Some(handle) = thread_slot.take() {
                let _ = handle.join();
            }
        }

        if let Ok(client) = self.client.get_mut() {
            client.take();
        }
    }
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
    pub metadata: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamP2PBatchDto {
    pub packets: Vec<SteamP2PPacketDto>,
    pub dropped_oversized: u32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamP2PPacketDto {
    pub source_steam_id: String,
    pub channel: i32,
    pub data: Vec<u8>,
    pub bytes_received: usize,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamP2PSessionStateDto {
    pub is_connection_active: bool,
    pub is_connecting: bool,
    pub last_error: u8,
    pub using_relay: bool,
    pub bytes_queued_for_send: i32,
    pub packets_queued_for_send: i32,
    pub remote_steam_id: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamCloudStatusDto {
    pub account_enabled: bool,
    pub app_enabled: bool,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SteamCloudFileDto {
    pub name: String,
    pub size: u64,
    pub timestamp: i64,
    pub persisted: bool,
}
/// Stats/conquistas só podem ser lidas/alteradas depois de UserStatsReceived.
/// O erro é explícito (o WebView reenfileira e tenta de novo no evento
/// `statsReady`), em vez de falhar silenciosamente (G112).
fn ensure_stats_ready(state: &SteamState) -> Result<(), String> {
    if state.stats_ready() {
        Ok(())
    } else {
        Err("STATS_NOT_READY: stats da Steam ainda não foram recebidas".to_string())
    }
}


fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_STEAM_IDENTIFIER_LEN || value.contains('\0') {
        return Err(format!("{label} inválido"));
    }

    Ok(())
}

fn parse_steam_id(value: &str, label: &str) -> Result<u64, String> {
    validate_identifier(value, label)?;

    value
        .parse::<u64>()
        .map_err(|_| format!("{label} inválido: esperado SteamID64 decimal"))
}

fn parse_lobby_type(value: &str) -> Result<steamworks::LobbyType, String> {
    match value {
        "private" => Ok(steamworks::LobbyType::Private),
        "friendsOnly" => Ok(steamworks::LobbyType::FriendsOnly),
        "public" => Ok(steamworks::LobbyType::Public),
        "invisible" => Ok(steamworks::LobbyType::Invisible),
        _ => Err(format!("Tipo de lobby inválido: {value}")),
    }
}

fn validate_channel(channel: i32) -> Result<(), String> {
    if !(0..=MAX_P2P_CHANNEL).contains(&channel) {
        return Err(format!(
            "Canal P2P inválido: {channel}; esperado 0..={MAX_P2P_CHANNEL}"
        ));
    }

    Ok(())
}

fn parse_send_type(value: &str) -> Result<steamworks::sys::EP2PSend, String> {
    match value {
        "unreliable" => Ok(steamworks::sys::EP2PSend::k_EP2PSendUnreliable),
        "unreliableNoDelay" => {
            Ok(steamworks::sys::EP2PSend::k_EP2PSendUnreliableNoDelay)
        }
        "reliable" => Ok(steamworks::sys::EP2PSend::k_EP2PSendReliable),
        "reliableWithBuffering" => {
            Ok(steamworks::sys::EP2PSend::k_EP2PSendReliableWithBuffering)
        }
        _ => Err(format!("Modo de envio P2P inválido: {value}")),
    }
}

fn validate_packet_size(send_type: &str, length: usize) -> Result<(), String> {
    let limit = match send_type {
        "unreliable" | "unreliableNoDelay" => MAX_P2P_UNRELIABLE_BYTES,
        "reliable" | "reliableWithBuffering" => MAX_P2P_RELIABLE_BYTES,
        _ => return Err(format!("Modo de envio P2P inválido: {send_type}")),
    };

    if length > limit {
        return Err(format!(
            "Pacote P2P de {length} bytes excede o limite de {limit} bytes para {send_type}"
        ));
    }

    Ok(())
}

fn validate_lobby_metadata(key: &str, value: Option<&str>) -> Result<(), String> {
    if key.is_empty()
        || key.len() > MAX_LOBBY_METADATA_KEY_LEN
        || key.contains('\0')
    {
        return Err("Chave de metadata de lobby inválida".to_string());
    }

    if let Some(value) = value {
        if value.len() > MAX_LOBBY_METADATA_VALUE_LEN || value.contains('\0') {
            return Err("Valor de metadata de lobby inválido".to_string());
        }
    }

    Ok(())
}

fn validate_cloud_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty()
        || file_name.len() > MAX_CLOUD_FILE_NAME_LEN
        || file_name.contains('\0')
        || file_name.starts_with('/')
        || file_name.starts_with('\\')
        || file_name
            .split(['/', '\\'])
            .any(|segment| segment == "..")
    {
        return Err("Nome de arquivo Steam Cloud inválido".to_string());
    }

    Ok(())
}

const MAX_LOBBY_METADATA_ENTRIES: u32 = 64;

fn lobby_details(
    client: &steamworks::Client,
    lobby_id: steamworks::LobbyId,
) -> SteamLobbyDto {
    let matchmaking = client.matchmaking();
    let mut metadata = BTreeMap::new();
    let count = matchmaking
        .lobby_data_count(lobby_id)
        .min(MAX_LOBBY_METADATA_ENTRIES);

    for index in 0..count {
        if let Some((key, value)) = matchmaking.lobby_data_by_index(lobby_id, index) {
            metadata.insert(key, value);
        }
    }

    SteamLobbyDto {
        lobby_id: lobby_id.raw().to_string(),
        owner_steam_id: matchmaking.lobby_owner(lobby_id).raw().to_string(),
        member_count: matchmaking.lobby_member_count(lobby_id) as u32,
        max_members: matchmaking.lobby_member_limit(lobby_id).unwrap_or(0) as u32,
        metadata,
    }
}

fn matchmaking_interface() -> Result<*mut steamworks::sys::ISteamMatchmaking, String> {
    let matchmaking = unsafe { steamworks::sys::SteamAPI_SteamMatchmaking_v009() };

    if matchmaking.is_null() {
        Err("Interface ISteamMatchmaking indisponível".to_string())
    } else {
        Ok(matchmaking)
    }
}

fn lobby_comparison(value: Option<&LobbyComparison>) -> steamworks::sys::ELobbyComparison {
    use steamworks::sys::ELobbyComparison as C;
    match value.unwrap_or(&LobbyComparison::Equal) {
        LobbyComparison::Equal => C::k_ELobbyComparisonEqual,
        LobbyComparison::NotEqual => C::k_ELobbyComparisonNotEqual,
        LobbyComparison::GreaterThan => C::k_ELobbyComparisonGreaterThan,
        LobbyComparison::GreaterThanOrEqual => C::k_ELobbyComparisonEqualToOrGreaterThan,
        LobbyComparison::LessThan => C::k_ELobbyComparisonLessThan,
        LobbyComparison::LessThanOrEqual => C::k_ELobbyComparisonEqualToOrLessThan,
    }
}

/// Aplica os filtros com strings terminadas em NUL (os helpers do crate
/// passam `&str` sem terminador para a API C).
fn apply_lobby_search_filters(search: &LobbySearchDto) -> Result<(), String> {
    use steamworks::sys::ELobbyDistanceFilter as D;
    let matchmaking = matchmaking_interface()?;

    for filter in search.string_filters.iter().flatten() {
        let key = CString::new(filter.key.as_str()).map_err(|_| "Chave inválida".to_string())?;
        let value =
            CString::new(filter.value.as_str()).map_err(|_| "Valor inválido".to_string())?;
        unsafe {
            steamworks::sys::SteamAPI_ISteamMatchmaking_AddRequestLobbyListStringFilter(
                matchmaking,
                key.as_ptr(),
                value.as_ptr(),
                lobby_comparison(filter.comparison.as_ref()),
            );
        }
    }

    for filter in search.number_filters.iter().flatten() {
        let key = CString::new(filter.key.as_str()).map_err(|_| "Chave inválida".to_string())?;
        unsafe {
            steamworks::sys::SteamAPI_ISteamMatchmaking_AddRequestLobbyListNumericalFilter(
                matchmaking,
                key.as_ptr(),
                filter.value,
                lobby_comparison(filter.comparison.as_ref()),
            );
        }
    }

    if let Some(slots) = search.slots_available {
        unsafe {
            steamworks::sys::SteamAPI_ISteamMatchmaking_AddRequestLobbyListFilterSlotsAvailable(
                matchmaking,
                slots as i32,
            );
        }
    }

    if let Some(distance) = search.distance.as_deref() {
        let distance = match distance {
            "close" => D::k_ELobbyDistanceFilterClose,
            "far" => D::k_ELobbyDistanceFilterFar,
            "worldwide" => D::k_ELobbyDistanceFilterWorldwide,
            _ => D::k_ELobbyDistanceFilterDefault,
        };
        unsafe {
            steamworks::sys::SteamAPI_ISteamMatchmaking_AddRequestLobbyListDistanceFilter(
                matchmaking,
                distance,
            );
        }
    }

    let max_results = search.max_results.unwrap_or(MAX_LOBBY_SEARCH_RESULTS);
    unsafe {
        steamworks::sys::SteamAPI_ISteamMatchmaking_AddRequestLobbyListResultCountFilter(
            matchmaking,
            max_results as i32,
        );
    }

    Ok(())
}

fn networking_interface() -> Result<*mut steamworks::sys::ISteamNetworking, String> {
    let networking = unsafe { steamworks::sys::SteamAPI_SteamNetworking_v006() };

    if networking.is_null() {
        Err("Interface ISteamNetworking indisponível".to_string())
    } else {
        Ok(networking)
    }
}

fn overlay_enabled() -> bool {
    unsafe {
        let utils = steamworks::sys::SteamAPI_SteamUtils_v010();
        !utils.is_null() && steamworks::sys::SteamAPI_ISteamUtils_IsOverlayEnabled(utils)
    }
}

#[tauri::command]
pub fn steam_runtime_status(state: State<'_, SteamState>) -> SteamRuntimeStatusDto {
    SteamRuntimeStatusDto {
        initialized: state.is_initialized(),
        callback_thread_running: state.callback_thread_running(),
        initialization_error: state.initialization_error(),
        stats_ready: state.stats_ready(),
    }
}

#[tauri::command]
pub fn steam_is_initialized(state: State<'_, SteamState>) -> bool {
    state.is_initialized()
}

#[tauri::command]
pub fn steam_get_user(state: State<'_, SteamState>) -> Result<SteamUserDto, String> {
    let client = state.client()?;
    let user = client.user();
    let friends = client.friends();

    Ok(SteamUserDto {
        steam_id: user.steam_id().raw().to_string(),
        persona_name: friends.name(),
        is_overlay_enabled: overlay_enabled(),
    })
}

#[tauri::command]
pub fn steam_unlock_achievement(
    achievement_id: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    validate_identifier(&achievement_id, "Achievement ID")?;
    let client = state.client()?;
    ensure_stats_ready(&state)?;
    let stats = client.user_stats();

    stats
        .achievement(&achievement_id)
        .set()
        .map_err(|error| format!("Falha ao liberar conquista: {error:?}"))?;

    stats
        .store_stats()
        .map_err(|error| format!("Conquista alterada, mas StoreStats falhou: {error:?}"))?;

    Ok(true)
}

#[tauri::command]
pub fn steam_set_stat(
    stat_name: String,
    value: i32,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    validate_identifier(&stat_name, "Stat name")?;
    let client = state.client()?;
    ensure_stats_ready(&state)?;

    client
        .user_stats()
        .set_stat_i32(&stat_name, value)
        .map_err(|error| format!("Falha ao atualizar estatística: {error:?}"))?;

    Ok(true)
}

/// Estatística FLOAT (G112). Exige que as stats tenham chegado da Steam.
#[tauri::command]
pub fn steam_set_stat_float(
    stat_name: String,
    value: f64,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    validate_identifier(&stat_name, "Stat name")?;
    let value = validate_stat_f32(value)?;
    let client = state.client()?;
    ensure_stats_ready(&state)?;

    client
        .user_stats()
        .set_stat_f32(&stat_name, value)
        .map_err(|error| format!("Falha ao atualizar estatística float: {error:?}"))?;

    Ok(true)
}

/// Lê uma estatística (`kind` = "int" | "float").
#[tauri::command]
pub fn steam_get_stat(
    stat_name: String,
    kind: String,
    state: State<'_, SteamState>,
) -> Result<f64, String> {
    validate_identifier(&stat_name, "Stat name")?;
    let client = state.client()?;
    ensure_stats_ready(&state)?;

    let stats = client.user_stats();
    match kind.as_str() {
        "int" => stats
            .get_stat_i32(&stat_name)
            .map(f64::from)
            .map_err(|_| format!("Estatística int inexistente: {stat_name}")),
        "float" => stats
            .get_stat_f32(&stat_name)
            .map(f64::from)
            .map_err(|_| format!("Estatística float inexistente: {stat_name}")),
        _ => Err(format!("Tipo de estatística inválido: {kind}")),
    }
}

/// Drena a fila limitada de eventos nativos (P2P, lobby, stats, microtxn, UGC).
#[tauri::command]
pub fn steam_poll_events(
    max_events: u32,
    state: State<'_, SteamState>,
) -> Result<Vec<SteamEventDto>, String> {
    if !state.is_initialized() {
        return Ok(Vec::new());
    }

    Ok(state.drain_events(clamp_count(max_events, crate::steam_support::MAX_EVENTS_PER_POLL)))
}

#[tauri::command]
pub async fn steam_request_lobby_list(
    search: Option<LobbySearchDto>,
    state: State<'_, SteamState>,
) -> Result<Vec<SteamLobbyDto>, String> {
    let search = search.unwrap_or_default();
    validate_lobby_search(&search)?;
    let client = state.client()?;
    let client_for_worker = client.clone();

    let lobby_ids = tauri::async_runtime::spawn_blocking(move || {
        apply_lobby_search_filters(&search)?;
        let (sender, receiver) = mpsc::sync_channel::<Result<Vec<u64>, String>>(1);

        client_for_worker.matchmaking().request_lobby_list(move |result| {
            let mapped = result
                .map(|lobbies| lobbies.into_iter().map(|lobby| lobby.raw()).collect())
                .map_err(|error| format!("RequestLobbyList falhou: {error:?}"));
            let _ = sender.send(mapped);
        });

        receiver
            .recv_timeout(STEAM_ASYNC_TIMEOUT)
            .map_err(|error| format!("Timeout aguardando RequestLobbyList: {error}"))?
    })
    .await
    .map_err(|error| format!("Worker RequestLobbyList falhou: {error}"))??;

    Ok(lobby_ids
        .into_iter()
        .take(MAX_LOBBY_SEARCH_RESULTS as usize)
        .map(|lobby| lobby_details(&client, steamworks::LobbyId::from_raw(lobby)))
        .collect())
}

#[tauri::command]
pub fn steam_get_lobby_details(
    lobby_id: String,
    state: State<'_, SteamState>,
) -> Result<SteamLobbyDto, String> {
    let lobby_id = parse_steam_id(&lobby_id, "Lobby ID")?;
    let client = state.client()?;
    Ok(lobby_details(&client, steamworks::LobbyId::from_raw(lobby_id)))
}

#[tauri::command]
pub fn steam_get_lobby_members(
    lobby_id: String,
    state: State<'_, SteamState>,
) -> Result<Vec<String>, String> {
    let lobby_id = parse_steam_id(&lobby_id, "Lobby ID")?;
    let client = state.client()?;

    Ok(client
        .matchmaking()
        .lobby_members(steamworks::LobbyId::from_raw(lobby_id))
        .into_iter()
        .map(|member| member.raw().to_string())
        .collect())
}

#[tauri::command]
pub fn steam_invite_to_lobby(
    lobby_id: String,
    invitee_steam_id: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let lobby_id = parse_steam_id(&lobby_id, "Lobby ID")?;
    let invitee = parse_steam_id(&invitee_steam_id, "Invitee SteamID")?;
    let _client = state.client()?;
    let matchmaking = matchmaking_interface()?;

    Ok(unsafe {
        steamworks::sys::SteamAPI_ISteamMatchmaking_InviteUserToLobby(matchmaking, lobby_id, invitee)
    })
}

#[tauri::command]
pub fn steam_activate_invite_dialog(
    lobby_id: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let lobby_id = parse_steam_id(&lobby_id, "Lobby ID")?;
    let client = state.client()?;
    client
        .friends()
        .activate_invite_dialog(steamworks::LobbyId::from_raw(lobby_id));
    Ok(true)
}

#[tauri::command]
pub fn steam_set_lobby_joinable(
    lobby_id: String,
    joinable: bool,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let lobby_id = parse_steam_id(&lobby_id, "Lobby ID")?;
    let client = state.client()?;
    Ok(client
        .matchmaking()
        .set_lobby_joinable(steamworks::LobbyId::from_raw(lobby_id), joinable))
}

#[tauri::command]
pub fn steam_store_stats(state: State<'_, SteamState>) -> Result<bool, String> {
    let client = state.client()?;

    client
        .user_stats()
        .store_stats()
        .map_err(|error| format!("Falha ao salvar estatísticas na Steam: {error:?}"))?;

    Ok(true)
}

#[tauri::command]
pub async fn steam_create_lobby(
    lobby_type: String,
    max_members: u32,
    state: State<'_, SteamState>,
) -> Result<SteamLobbyDto, String> {
    if !(1..=250).contains(&max_members) {
        return Err("maxMembers precisa estar entre 1 e 250".to_string());
    }

    let lobby_type = parse_lobby_type(&lobby_type)?;
    let client = state.client()?;
    let client_for_worker = client.clone();

    let lobby_id = tauri::async_runtime::spawn_blocking(move || {
        let (sender, receiver) = mpsc::sync_channel::<Result<u64, String>>(1);
        let matchmaking = client_for_worker.matchmaking();

        matchmaking.create_lobby(lobby_type, max_members, move |result| {
            let mapped = result
                .map(|lobby| lobby.raw())
                .map_err(|error| format!("CreateLobby falhou: {error:?}"));
            let _ = sender.send(mapped);
        });

        receiver
            .recv_timeout(STEAM_ASYNC_TIMEOUT)
            .map_err(|error| format!("Timeout aguardando callback CreateLobby: {error}"))?
    })
    .await
    .map_err(|error| format!("Worker CreateLobby falhou: {error}"))??;

    Ok(lobby_details(
        &client,
        steamworks::LobbyId::from_raw(lobby_id),
    ))
}

#[tauri::command]
pub async fn steam_join_lobby(
    lobby_id: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let lobby_id = parse_steam_id(&lobby_id, "Lobby ID")?;
    let client = state.client()?;

    tauri::async_runtime::spawn_blocking(move || {
        let (sender, receiver) = mpsc::sync_channel::<Result<bool, String>>(1);
        let matchmaking = client.matchmaking();

        matchmaking.join_lobby(steamworks::LobbyId::from_raw(lobby_id), move |result| {
            let mapped = result
                .map(|_| true)
                .map_err(|_| "Steam recusou a entrada no lobby".to_string());
            let _ = sender.send(mapped);
        });

        receiver
            .recv_timeout(STEAM_ASYNC_TIMEOUT)
            .map_err(|error| format!("Timeout aguardando callback JoinLobby: {error}"))?
    })
    .await
    .map_err(|error| format!("Worker JoinLobby falhou: {error}"))?
}

#[tauri::command]
pub fn steam_leave_lobby(
    lobby_id: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let lobby_id = parse_steam_id(&lobby_id, "Lobby ID")?;
    let client = state.client()?;

    client
        .matchmaking()
        .leave_lobby(steamworks::LobbyId::from_raw(lobby_id));

    Ok(true)
}

#[tauri::command]
pub fn steam_set_lobby_data(
    lobby_id: String,
    key: String,
    value: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let lobby_id = parse_steam_id(&lobby_id, "Lobby ID")?;
    validate_lobby_metadata(&key, Some(&value))?;
    let client = state.client()?;

    Ok(client.matchmaking().set_lobby_data(
        steamworks::LobbyId::from_raw(lobby_id),
        &key,
        &value,
    ))
}

#[tauri::command]
pub fn steam_get_lobby_data(
    lobby_id: String,
    key: String,
    state: State<'_, SteamState>,
) -> Result<Option<String>, String> {
    let lobby_id = parse_steam_id(&lobby_id, "Lobby ID")?;
    validate_lobby_metadata(&key, None)?;
    let client = state.client()?;

    Ok(client
        .matchmaking()
        .lobby_data(steamworks::LobbyId::from_raw(lobby_id), &key)
        .map(str::to_owned))
}

#[tauri::command]
pub fn steam_send_p2p_packet(
    target_steam_id: String,
    data: Vec<u8>,
    send_type: String,
    channel: i32,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let target_steam_id = parse_steam_id(&target_steam_id, "Target SteamID")?;
    validate_channel(channel)?;
    validate_packet_size(&send_type, data.len())?;
    let send_type = parse_send_type(&send_type)?;
    let _client = state.client()?;
    let networking = networking_interface()?;

    let sent = unsafe {
        steamworks::sys::SteamAPI_ISteamNetworking_SendP2PPacket(
            networking,
            target_steam_id,
            data.as_ptr().cast(),
            data.len() as u32,
            send_type,
            channel,
        )
    };

    Ok(sent)
}

#[tauri::command]
pub fn steam_read_p2p_packet(
    channel: i32,
    state: State<'_, SteamState>,
) -> Result<Option<SteamP2PPacketDto>, String> {
    validate_channel(channel)?;
    let _client = state.client()?;
    let networking = networking_interface()?;

    let mut packet_size = 0_u32;
    let available = unsafe {
        steamworks::sys::SteamAPI_ISteamNetworking_IsP2PPacketAvailable(
            networking,
            &mut packet_size,
            channel,
        )
    };

    if !available {
        return Ok(None);
    }

    if classify_incoming_packet(packet_size as usize) == PacketDisposition::Discard {
        // Consome o pacote para não travar o canal para sempre (G111).
        discard_p2p_packet(networking, channel);
        return Err(format!(
            "Pacote recebido excede limite de segurança ({packet_size} bytes) e foi descartado"
        ));
    }

    Ok(read_one_p2p_packet(networking, packet_size, channel))
}

fn discard_p2p_packet(networking: *mut steamworks::sys::ISteamNetworking, channel: i32) {
    let mut scratch = [0_u8; 64];
    let mut bytes_read = 0_u32;
    let mut remote_id = 0_u64;

    unsafe {
        steamworks::sys::SteamAPI_ISteamNetworking_ReadP2PPacket(
            networking,
            scratch.as_mut_ptr().cast(),
            scratch.len() as u32,
            &mut bytes_read,
            (&mut remote_id as *mut u64).cast(),
            channel,
        );
    }
}

fn read_one_p2p_packet(
    networking: *mut steamworks::sys::ISteamNetworking,
    packet_size: u32,
    channel: i32,
) -> Option<SteamP2PPacketDto> {
    let mut data = vec![0_u8; packet_size as usize];
    let mut bytes_read = 0_u32;
    let mut remote_id = 0_u64;

    let read = unsafe {
        steamworks::sys::SteamAPI_ISteamNetworking_ReadP2PPacket(
            networking,
            data.as_mut_ptr().cast(),
            packet_size,
            &mut bytes_read,
            (&mut remote_id as *mut u64).cast(),
            channel,
        )
    };

    if !read {
        return None;
    }

    data.truncate(bytes_read as usize);

    Some(SteamP2PPacketDto {
        source_steam_id: remote_id.to_string(),
        channel,
        bytes_received: bytes_read as usize,
        data,
    })
}

/// Drena pacotes de TODOS os canais 0..=255 numa única chamada IPC (G104),
/// limitada por quantidade e bytes; pacotes acima do limite são descartados
/// sem travar o canal (G111).
#[tauri::command]
pub fn steam_read_p2p_packets(
    max_packets: u32,
    max_total_bytes: u32,
    state: State<'_, SteamState>,
) -> Result<SteamP2PBatchDto, String> {
    let _client = state.client()?;
    let networking = networking_interface()?;
    let mut budget = P2PBatchBudget::new(max_packets, max_total_bytes);
    let mut packets = Vec::new();
    let mut dropped_oversized = 0_u32;

    'channels: for channel in 0..=MAX_P2P_CHANNEL {
        loop {
            if budget.exhausted() {
                break 'channels;
            }

            let mut packet_size = 0_u32;
            let available = unsafe {
                steamworks::sys::SteamAPI_ISteamNetworking_IsP2PPacketAvailable(
                    networking,
                    &mut packet_size,
                    channel,
                )
            };

            if !available {
                break;
            }

            if classify_incoming_packet(packet_size as usize) == PacketDisposition::Discard {
                discard_p2p_packet(networking, channel);
                dropped_oversized = dropped_oversized.saturating_add(1);
                continue;
            }

            if !budget.can_take(packet_size as usize) {
                break 'channels;
            }

            match read_one_p2p_packet(networking, packet_size, channel) {
                Some(packet) => {
                    budget.take(packet.data.len());
                    packets.push(packet);
                }
                None => break,
            }
        }
    }

    Ok(SteamP2PBatchDto {
        packets,
        dropped_oversized,
    })
}

#[tauri::command]
pub fn steam_accept_p2p_session(
    remote_steam_id: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let remote_steam_id = parse_steam_id(&remote_steam_id, "Remote SteamID")?;
    let client = state.client()?;

    client
        .networking()
        .accept_p2p_session(steamworks::SteamId::from_raw(remote_steam_id));

    Ok(true)
}

#[tauri::command]
pub fn steam_close_p2p_session(
    remote_steam_id: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let remote_steam_id = parse_steam_id(&remote_steam_id, "Remote SteamID")?;
    let client = state.client()?;

    client
        .networking()
        .close_p2p_session(steamworks::SteamId::from_raw(remote_steam_id));

    Ok(true)
}

#[tauri::command]
pub fn steam_get_p2p_session_state(
    remote_steam_id: String,
    state: State<'_, SteamState>,
) -> Result<Option<SteamP2PSessionStateDto>, String> {
    let remote_steam_id = parse_steam_id(&remote_steam_id, "Remote SteamID")?;
    let _client = state.client()?;
    let networking = networking_interface()?;
    let mut session_state: steamworks::sys::P2PSessionState_t = unsafe { std::mem::zeroed() };

    let found = unsafe {
        steamworks::sys::SteamAPI_ISteamNetworking_GetP2PSessionState(
            networking,
            remote_steam_id,
            &mut session_state,
        )
    };

    if !found {
        return Ok(None);
    }

    Ok(Some(SteamP2PSessionStateDto {
        is_connection_active: session_state.m_bConnectionActive != 0,
        is_connecting: session_state.m_bConnecting != 0,
        last_error: session_state.m_eP2PSessionError,
        using_relay: session_state.m_bUsingRelay != 0,
        bytes_queued_for_send: session_state.m_nBytesQueuedForSend,
        packets_queued_for_send: session_state.m_nPacketsQueuedForSend,
        remote_steam_id: remote_steam_id.to_string(),
    }))
}

#[tauri::command]
pub fn steam_cloud_status(
    state: State<'_, SteamState>,
) -> Result<SteamCloudStatusDto, String> {
    let client = state.client()?;
    let storage = client.remote_storage();

    Ok(SteamCloudStatusDto {
        account_enabled: storage.is_cloud_enabled_for_account(),
        app_enabled: storage.is_cloud_enabled_for_app(),
    })
}

#[tauri::command]
pub fn steam_cloud_list_files(
    state: State<'_, SteamState>,
) -> Result<Vec<SteamCloudFileDto>, String> {
    let client = state.client()?;
    let storage = client.remote_storage();

    Ok(storage
        .files()
        .into_iter()
        .map(|info| {
            let file = storage.file(&info.name);
            SteamCloudFileDto {
                name: info.name,
                size: info.size,
                timestamp: file.timestamp(),
                persisted: file.is_persisted(),
            }
        })
        .collect())
}

#[tauri::command]
pub fn steam_cloud_write_file(
    file_name: String,
    data: Vec<u8>,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    validate_cloud_file_name(&file_name)?;
    let client = state.client()?;
    let file = client.remote_storage().file(&file_name);
    let mut writer = file.write();

    writer
        .write_all(&data)
        .map_err(|error| format!("Falha ao gravar Steam Cloud '{file_name}': {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Falha ao finalizar Steam Cloud '{file_name}': {error}"))?;

    Ok(true)
}

#[tauri::command]
pub fn steam_cloud_read_file(
    file_name: String,
    state: State<'_, SteamState>,
) -> Result<Option<Vec<u8>>, String> {
    validate_cloud_file_name(&file_name)?;
    let client = state.client()?;
    let storage = client.remote_storage();
    let file = storage.file(&file_name);

    if !file.exists() {
        return Ok(None);
    }

    let mut reader = file.read();
    let mut data = Vec::new();
    reader
        .read_to_end(&mut data)
        .map_err(|error| format!("Falha ao ler Steam Cloud '{file_name}': {error}"))?;

    Ok(Some(data))
}

#[tauri::command]
pub fn steam_cloud_delete_file(
    file_name: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    validate_cloud_file_name(&file_name)?;
    let client = state.client()?;

    Ok(client.remote_storage().file(&file_name).delete())
}

#[tauri::command]
pub fn steam_overlay_is_enabled(state: State<'_, SteamState>) -> Result<bool, String> {
    let _client = state.client()?;
    Ok(overlay_enabled())
}

#[tauri::command]
pub fn steam_activate_overlay(
    dialog: String,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    const ALLOWED_DIALOGS: &[&str] = &[
        "Friends",
        "Community",
        "Players",
        "Settings",
        "OfficialGameGroup",
        "Stats",
        "Achievements",
    ];

    if !ALLOWED_DIALOGS.contains(&dialog.as_str()) {
        return Err(format!("Dialog da Steam Overlay não permitido: {dialog}"));
    }

    let _client = state.client()?;
    let dialog = CString::new(dialog).map_err(|_| "Dialog inválido".to_string())?;

    unsafe {
        let friends = steamworks::sys::SteamAPI_SteamFriends_v017();
        if friends.is_null() {
            return Err("Interface ISteamFriends indisponível".to_string());
        }
        steamworks::sys::SteamAPI_ISteamFriends_ActivateGameOverlay(friends, dialog.as_ptr());
    }

    Ok(true)
}

#[tauri::command]
pub fn steam_workshop_download_item(
    published_file_id: String,
    high_priority: bool,
    state: State<'_, SteamState>,
) -> Result<bool, String> {
    let published_file_id = parse_steam_id(&published_file_id, "PublishedFileId")?;
    let client = state.client()?;

    Ok(client.ugc().download_item(
        steamworks::PublishedFileId::from(published_file_id),
        high_priority,
    ))
}
