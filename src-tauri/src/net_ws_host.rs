//! G8: host WebSocket NATIVO do `game.net`.
//!
//! O Rust é só o "fio": aceita conexões WebSocket (sem TLS) em
//! `127.0.0.1` (padrão) ou `0.0.0.0` (LAN, opt-in), dá a cada uma um id
//! `ws_<n>` e entrega/envia frames binários. O protocolo de sessão (HELLO/
//! WELCOME, PING/PONG, fragmentos, snapshots) roda no TypeScript do host,
//! exatamente como nos outros transportes; os clientes usam o
//! `WebSocketTransport` comum (`ws://ip:porta`).
//!
//! - Limites: `maxClients` (1..250) conexões, mensagem ≤ 1 MiB + folga,
//!   handshake WS em 5 s, fila de saída por par ≤ 2 MiB (backpressure: o
//!   envio devolve `false`), fila de eventos de entrada ≤ 16 MiB (estouro
//!   desconecta o par com `overflow` — o WebSocket é confiável, nada é
//!   descartado em silêncio).
//! - Eventos são DRENADOS pelo TS (`net_ws_host_poll`, binário), no pump da
//!   rede: nenhuma chamada do Rust para o WebView.
//! - Erros serializáveis `{ code, message }`.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{Bytes, Message};

pub const MAX_CLIENTS_LIMIT: u32 = 250;
/// Igual a `MAX_NETWORK_PACKET_BYTES` do TS (1 MiB) + folga de cabeçalho.
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024 + 64;
/// Igual a `NETWORK_BACKPRESSURE_HIGH_WATER_BYTES` do TS.
pub const PEER_SEND_HIGH_WATER_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_QUEUED_EVENT_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_QUEUED_EVENTS: usize = 65_536;
/// Máximo devolvido por um `poll` (o resto fica para o próximo).
pub const MAX_POLL_BYTES: usize = 4 * 1024 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const PEER_CHANNEL_CAPACITY: usize = 1024;

pub const EVENT_CONNECTED: u8 = 1;
pub const EVENT_DISCONNECTED: u8 = 2;
pub const EVENT_MESSAGE: u8 = 3;

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetHostError {
    /// `invalid-input` | `already-running` | `not-running` | `bind-failed` | `unavailable`
    pub code: &'static str,
    pub message: String,
}

impl NetHostError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WsHostInfoDto {
    pub running: bool,
    pub port: u16,
    pub bind: String,
    pub max_clients: u32,
    pub peers: u32,
    /// IP de LAN provável desta máquina (só com `bind = "lan"`), para o jogo
    /// mostrar `ws://<ip>:<porta>` aos jogadores. Nenhum pacote é enviado.
    pub lan_address: Option<String>,
}

/// Descobre o IP local da interface de saída padrão sem enviar pacotes
/// (UDP `connect` só escolhe a rota).
fn probable_lan_address() -> Option<String> {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(10, 255, 255, 255), 9)).ok()?;
    let ip = socket.local_addr().ok()?.ip();
    if ip.is_unspecified() || ip.is_loopback() {
        return None;
    }
    Some(ip.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostEvent {
    Connected(String),
    Disconnected(String, String),
    Message(String, Vec<u8>),
}

impl HostEvent {
    fn byte_len(&self) -> usize {
        match self {
            HostEvent::Connected(id) => id.len() + 6,
            HostEvent::Disconnected(id, reason) => id.len() + reason.len() + 6,
            HostEvent::Message(id, data) => id.len() + data.len() + 6,
        }
    }
}

/// `[tipo u8][len id u8][id][len u32 BE][corpo]` por evento.
pub fn encode_events(events: &[HostEvent]) -> Vec<u8> {
    let total: usize = events.iter().map(HostEvent::byte_len).sum();
    let mut out = Vec::with_capacity(total);
    for event in events {
        let (kind, id, body): (u8, &str, &[u8]) = match event {
            HostEvent::Connected(id) => (EVENT_CONNECTED, id, &[]),
            HostEvent::Disconnected(id, reason) => (EVENT_DISCONNECTED, id, reason.as_bytes()),
            HostEvent::Message(id, data) => (EVENT_MESSAGE, id, data.as_slice()),
        };
        out.push(kind);
        out.push(id.len() as u8);
        out.extend_from_slice(id.as_bytes());
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        out.extend_from_slice(body);
    }
    out
}

pub fn validate_bind(bind: &str) -> Result<IpAddr, NetHostError> {
    match bind {
        "loopback" => Ok(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        "lan" => Ok(IpAddr::V4(Ipv4Addr::UNSPECIFIED)),
        _ => Err(NetHostError::new("invalid-input", "bind precisa ser 'loopback' ou 'lan'")),
    }
}

pub fn validate_max_clients(max_clients: u32) -> Result<usize, NetHostError> {
    if max_clients == 0 || max_clients > MAX_CLIENTS_LIMIT {
        return Err(NetHostError::new("invalid-input", "maxClients precisa estar em 1..250"));
    }
    Ok(max_clients as usize)
}

pub fn validate_peer_id(peer_id: &str) -> Result<(), NetHostError> {
    let valid = peer_id
        .strip_prefix("ws_")
        .map(|digits| !digits.is_empty() && digits.len() <= 20 && digits.bytes().all(|b| b.is_ascii_digit()))
        .unwrap_or(false);
    if !valid {
        return Err(NetHostError::new("invalid-input", "peerId inválido"));
    }
    Ok(())
}

struct PeerHandle {
    tx: mpsc::Sender<Message>,
    queued_bytes: Arc<AtomicUsize>,
    close: watch::Sender<Option<String>>,
}

#[derive(Default)]
struct EventQueue {
    events: VecDeque<HostEvent>,
    bytes: usize,
}

struct Shared {
    peers: Mutex<HashMap<String, PeerHandle>>,
    events: Mutex<EventQueue>,
    /// Conexões aceitas + handshakes em curso (reserva vaga antes do WS).
    slots: AtomicUsize,
    max_clients: usize,
    next_id: AtomicU64,
}

impl Shared {
    /// Enfileira um evento; `false` se a fila estourou (o chamador fecha o par).
    fn push(&self, event: HostEvent) -> bool {
        let Ok(mut queue) = self.events.lock() else { return false };
        let size = event.byte_len();
        let is_message = matches!(event, HostEvent::Message(..));
        if is_message
            && (queue.bytes + size > MAX_QUEUED_EVENT_BYTES || queue.events.len() >= MAX_QUEUED_EVENTS)
        {
            return false;
        }
        queue.bytes += size;
        queue.events.push_back(event);
        true
    }

    fn drain(&self, max_bytes: usize) -> Vec<HostEvent> {
        let Ok(mut queue) = self.events.lock() else { return Vec::new() };
        let mut out = Vec::new();
        let mut taken = 0;
        while let Some(front) = queue.events.front() {
            let size = front.byte_len();
            if !out.is_empty() && taken + size > max_bytes {
                break;
            }
            taken += size;
            queue.bytes = queue.bytes.saturating_sub(size);
            if let Some(event) = queue.events.pop_front() {
                out.push(event);
            }
        }
        out
    }

    fn close_peer(&self, peer_id: &str, reason: &str) -> bool {
        let Ok(peers) = self.peers.lock() else { return false };
        match peers.get(peer_id) {
            Some(peer) => {
                let _ = peer.close.send(Some(reason.to_string()));
                true
            }
            None => false,
        }
    }
}

/// Servidor em execução (independente do Tauri, testável com tokio puro).
pub struct WsHost {
    shared: Arc<Shared>,
    shutdown: watch::Sender<bool>,
    port: u16,
    bind: String,
    lan_address: Option<String>,
}

impl WsHost {
    /// Precisa rodar dentro de um runtime tokio (comandos async do Tauri).
    pub async fn start(port: u16, bind: &str, max_clients: u32) -> Result<WsHost, NetHostError> {
        let ip = validate_bind(bind)?;
        let max_clients = validate_max_clients(max_clients)?;
        let listener = TcpListener::bind(SocketAddr::new(ip, port))
            .await
            .map_err(|error| NetHostError::new("bind-failed", format!("Falha ao abrir a porta {port}: {error}")))?;
        let actual_port = listener
            .local_addr()
            .map_err(|error| NetHostError::new("bind-failed", error.to_string()))?
            .port();

        let shared = Arc::new(Shared {
            peers: Mutex::new(HashMap::new()),
            events: Mutex::new(EventQueue::default()),
            slots: AtomicUsize::new(0),
            max_clients,
            next_id: AtomicU64::new(1),
        });
        let (shutdown, shutdown_rx) = watch::channel(false);
        tokio::spawn(accept_loop(listener, Arc::clone(&shared), shutdown_rx));

        let lan_address = if bind == "lan" { probable_lan_address() } else { None };
        Ok(WsHost { shared, shutdown, port: actual_port, bind: bind.to_string(), lan_address })
    }

    pub fn info(&self) -> WsHostInfoDto {
        WsHostInfoDto {
            running: true,
            port: self.port,
            bind: self.bind.clone(),
            max_clients: self.shared.max_clients as u32,
            peers: self.shared.peers.lock().map(|p| p.len() as u32).unwrap_or(0),
            lan_address: self.lan_address.clone(),
        }
    }

    pub fn poll(&self, max_bytes: usize) -> Vec<HostEvent> {
        self.shared.drain(max_bytes)
    }

    /// `false` = par desconhecido ou fila de saída cheia (backpressure).
    pub fn send(&self, peer_id: &str, data: &[u8]) -> bool {
        if data.is_empty() || data.len() > MAX_MESSAGE_BYTES {
            return false;
        }
        let Ok(peers) = self.shared.peers.lock() else { return false };
        let Some(peer) = peers.get(peer_id) else { return false };
        send_to(peer, data)
    }

    /// Envia a todos; `true` se ao menos um aceitou.
    pub fn broadcast(&self, data: &[u8]) -> bool {
        if data.is_empty() || data.len() > MAX_MESSAGE_BYTES {
            return false;
        }
        let Ok(peers) = self.shared.peers.lock() else { return false };
        let mut any = false;
        for peer in peers.values() {
            any |= send_to(peer, data);
        }
        any
    }

    pub fn close_peer(&self, peer_id: &str) -> bool {
        self.shared.close_peer(peer_id, "host_closed")
    }

    pub fn stop(&self) {
        let _ = self.shutdown.send(true);
        if let Ok(peers) = self.shared.peers.lock() {
            for peer in peers.values() {
                let _ = peer.close.send(Some("host_stopped".to_string()));
            }
        }
    }
}

impl Drop for WsHost {
    fn drop(&mut self) {
        self.stop();
    }
}

fn send_to(peer: &PeerHandle, data: &[u8]) -> bool {
    let queued = peer.queued_bytes.load(Ordering::Acquire);
    if queued + data.len() > PEER_SEND_HIGH_WATER_BYTES {
        return false;
    }
    peer.queued_bytes.fetch_add(data.len(), Ordering::AcqRel);
    match peer.tx.try_send(Message::Binary(Bytes::copy_from_slice(data))) {
        Ok(()) => true,
        Err(_) => {
            peer.queued_bytes.fetch_sub(data.len(), Ordering::AcqRel);
            false
        }
    }
}

struct SlotGuard(Arc<Shared>);

impl Drop for SlotGuard {
    fn drop(&mut self) {
        self.0.slots.fetch_sub(1, Ordering::AcqRel);
    }
}

async fn accept_loop(listener: TcpListener, shared: Arc<Shared>, mut shutdown: watch::Receiver<bool>) {
    loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    break;
                }
            }
            accepted = listener.accept() => {
                let Ok((stream, _addr)) = accepted else { continue };
                // Reserva a vaga ANTES do handshake (limite real de conexões).
                let reserved = shared.slots.fetch_add(1, Ordering::AcqRel);
                if reserved >= shared.max_clients {
                    shared.slots.fetch_sub(1, Ordering::AcqRel);
                    drop(stream);
                    continue;
                }
                let guard = SlotGuard(Arc::clone(&shared));
                tokio::spawn(handle_connection(stream, Arc::clone(&shared), shutdown.clone(), guard));
            }
        }
    }
}

async fn handle_connection(
    stream: TcpStream,
    shared: Arc<Shared>,
    mut shutdown: watch::Receiver<bool>,
    _slot: SlotGuard,
) {
    let _ = stream.set_nodelay(true);
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES));
    let socket = match tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        tokio_tungstenite::accept_async_with_config(stream, Some(config)),
    )
    .await
    {
        Ok(Ok(socket)) => socket,
        _ => return,
    };
    if *shutdown.borrow() {
        return;
    }

    let peer_id = format!("ws_{}", shared.next_id.fetch_add(1, Ordering::Relaxed));
    let (tx, mut rx) = mpsc::channel::<Message>(PEER_CHANNEL_CAPACITY);
    let queued_bytes = Arc::new(AtomicUsize::new(0));
    let (close_tx, mut close_rx) = watch::channel::<Option<String>>(None);

    if let Ok(mut peers) = shared.peers.lock() {
        peers.insert(
            peer_id.clone(),
            PeerHandle { tx, queued_bytes: Arc::clone(&queued_bytes), close: close_tx },
        );
    } else {
        return;
    }
    shared.push(HostEvent::Connected(peer_id.clone()));

    let (mut sink, mut source) = socket.split();
    let reason: String = loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    break "host_stopped".to_string();
                }
            }
            changed = close_rx.changed() => {
                let requested = close_rx.borrow().clone();
                if changed.is_err() {
                    break "host_closed".to_string();
                }
                if let Some(reason) = requested {
                    break reason;
                }
            }
            outgoing = rx.recv() => {
                let Some(message) = outgoing else { break "host_closed".to_string() };
                let size = match &message { Message::Binary(data) => data.len(), _ => 0 };
                let sent = sink.send(message).await;
                queued_bytes.fetch_sub(size, Ordering::AcqRel);
                if sent.is_err() {
                    break "erro_conexao".to_string();
                }
            }
            incoming = source.next() => {
                match incoming {
                    Some(Ok(Message::Binary(data))) => {
                        if data.is_empty() {
                            continue;
                        }
                        if !shared.push(HostEvent::Message(peer_id.clone(), data.to_vec())) {
                            break "overflow".to_string();
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break "conexao_fechada".to_string(),
                    Some(Ok(_)) => {} // texto/ping/pong: o protocolo é binário
                    Some(Err(_)) => break "erro_conexao".to_string(),
                }
            }
        }
    };

    if let Ok(mut peers) = shared.peers.lock() {
        peers.remove(&peer_id);
    }
    let _ = sink.send(Message::Close(None)).await;
    let _ = sink.close().await;
    shared.push(HostEvent::Disconnected(peer_id, reason));
}

/// Estado gerenciado pelo Tauri: no máximo UM host por app.
#[derive(Default)]
pub struct WsHostState {
    host: Mutex<Option<WsHost>>,
}

impl WsHostState {
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.host.lock() {
            if let Some(host) = guard.take() {
                host.stop();
            }
        }
    }
}

fn lock_state(state: &WsHostState) -> Result<std::sync::MutexGuard<'_, Option<WsHost>>, NetHostError> {
    state.host.lock().map_err(|_| NetHostError::new("unavailable", "estado do host envenenado"))
}

#[tauri::command]
pub async fn net_ws_host_start(
    port: u16,
    bind: String,
    max_clients: u32,
    state: tauri::State<'_, WsHostState>,
) -> Result<WsHostInfoDto, NetHostError> {
    validate_bind(&bind)?;
    validate_max_clients(max_clients)?;
    if lock_state(&state)?.is_some() {
        return Err(NetHostError::new("already-running", "o host WebSocket já está rodando"));
    }
    let host = WsHost::start(port, &bind, max_clients).await?;
    let info = host.info();
    let mut guard = lock_state(&state)?;
    if guard.is_some() {
        host.stop();
        return Err(NetHostError::new("already-running", "o host WebSocket já está rodando"));
    }
    *guard = Some(host);
    Ok(info)
}

#[tauri::command]
pub fn net_ws_host_stop(state: tauri::State<'_, WsHostState>) -> Result<bool, NetHostError> {
    let host = lock_state(&state)?.take();
    match host {
        Some(host) => {
            host.stop();
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
pub fn net_ws_host_status(state: tauri::State<'_, WsHostState>) -> Result<Option<WsHostInfoDto>, NetHostError> {
    Ok(lock_state(&state)?.as_ref().map(WsHost::info))
}

/// Drena eventos em binário (veja `encode_events`).
#[tauri::command]
pub fn net_ws_host_poll(state: tauri::State<'_, WsHostState>) -> Result<tauri::ipc::Response, NetHostError> {
    let guard = lock_state(&state)?;
    let Some(host) = guard.as_ref() else {
        return Err(NetHostError::new("not-running", "o host WebSocket não está rodando"));
    };
    Ok(tauri::ipc::Response::new(encode_events(&host.poll(MAX_POLL_BYTES))))
}

/// Corpo binário cru; header `x-peer-id` = `ws_<n>` ou `*` (broadcast).
#[tauri::command]
pub fn net_ws_host_send(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, WsHostState>,
) -> Result<bool, NetHostError> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(NetHostError::new("invalid-input", "corpo precisa ser binário"));
    };
    let target = request
        .headers()
        .get("x-peer-id")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| NetHostError::new("invalid-input", "header x-peer-id ausente"))?;
    if target != "*" {
        validate_peer_id(target)?;
    }
    let guard = lock_state(&state)?;
    let Some(host) = guard.as_ref() else {
        return Err(NetHostError::new("not-running", "o host WebSocket não está rodando"));
    };
    Ok(if target == "*" { host.broadcast(data) } else { host.send(target, data) })
}

#[tauri::command]
pub fn net_ws_host_close_peer(
    peer_id: String,
    state: tauri::State<'_, WsHostState>,
) -> Result<bool, NetHostError> {
    validate_peer_id(&peer_id)?;
    let guard = lock_state(&state)?;
    Ok(guard.as_ref().map(|host| host.close_peer(&peer_id)).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    async fn wait_events(host: &WsHost, count: usize) -> Vec<HostEvent> {
        let mut out = Vec::new();
        for _ in 0..400 {
            out.extend(host.poll(MAX_POLL_BYTES));
            if out.len() >= count {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        out
    }

    #[test]
    fn validates_input() {
        assert!(validate_bind("loopback").is_ok());
        assert!(validate_bind("lan").is_ok());
        assert_eq!(validate_bind("0.0.0.0").unwrap_err().code, "invalid-input");
        assert!(validate_max_clients(0).is_err());
        assert!(validate_max_clients(251).is_err());
        assert!(validate_max_clients(16).is_ok());
        assert!(validate_peer_id("ws_12").is_ok());
        for bad in ["", "ws_", "ws_x", "dedicated_server", "ws_1/..", &format!("ws_{}", "9".repeat(21))] {
            assert!(validate_peer_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn encodes_events_in_documented_layout() {
        let bytes = encode_events(&[
            HostEvent::Connected("ws_1".into()),
            HostEvent::Message("ws_1".into(), vec![0xa7, 1, 3, 0]),
            HostEvent::Disconnected("ws_1".into(), "bye".into()),
        ]);
        assert_eq!(&bytes[0..6], &[EVENT_CONNECTED, 4, b'w', b's', b'_', b'1']);
        assert_eq!(&bytes[6..10], &[0, 0, 0, 0]);
        assert_eq!(bytes[10], EVENT_MESSAGE);
        assert_eq!(&bytes[16..20], &[0, 0, 0, 4]);
        assert_eq!(&bytes[20..24], &[0xa7, 1, 3, 0]);
        assert_eq!(bytes[24], EVENT_DISCONNECTED);
        assert_eq!(&bytes[bytes.len() - 3..], b"bye");
    }

    #[tokio::test]
    async fn relays_binary_frames_both_ways_and_reports_disconnect() {
        let host = WsHost::start(0, "loopback", 4).await.unwrap();
        let url = format!("ws://127.0.0.1:{}", host.info().port);
        let (mut client, _) = connect_async(url.as_str()).await.unwrap();

        let events = wait_events(&host, 1).await;
        let HostEvent::Connected(peer) = &events[0] else { panic!("{events:?}") };
        assert_eq!(host.info().peers, 1);

        client.send(Message::Binary(Bytes::from_static(&[0xa7, 1, 3, 0, b'{', b'}']))).await.unwrap();
        let events = wait_events(&host, 1).await;
        assert_eq!(events, vec![HostEvent::Message(peer.clone(), vec![0xa7, 1, 3, 0, b'{', b'}'])]);

        assert!(host.send(peer, &[1, 2, 3]));
        assert!(!host.send("ws_999", &[1]));
        assert!(!host.send(peer, &[])); // vazio recusado
        let reply = client.next().await.unwrap().unwrap();
        assert_eq!(reply, Message::Binary(Bytes::from_static(&[1, 2, 3])));
        assert!(host.broadcast(&[9]));
        assert_eq!(client.next().await.unwrap().unwrap(), Message::Binary(Bytes::from_static(&[9])));

        client.close(None).await.unwrap();
        let events = wait_events(&host, 1).await;
        assert!(matches!(&events[0], HostEvent::Disconnected(id, reason) if id == peer && reason == "conexao_fechada"));
        assert_eq!(host.info().peers, 0);
        host.stop();
    }

    #[tokio::test]
    async fn enforces_max_clients_and_close_peer() {
        let host = WsHost::start(0, "loopback", 1).await.unwrap();
        let url = format!("ws://127.0.0.1:{}", host.info().port);
        let (mut first, _) = connect_async(url.as_str()).await.unwrap();
        let events = wait_events(&host, 1).await;
        let HostEvent::Connected(peer) = &events[0] else { panic!() };

        // A segunda conexão passa do limite: o TCP é fechado sem handshake.
        assert!(connect_async(url.as_str()).await.is_err());

        assert!(host.close_peer(peer));
        let events = wait_events(&host, 1).await;
        assert!(matches!(&events[0], HostEvent::Disconnected(_, reason) if reason == "host_closed"));
        // O cliente vê o fechamento.
        let next = first.next().await;
        assert!(matches!(next, Some(Ok(Message::Close(_))) | None | Some(Err(_))));

        // A vaga volta.
        let (_again, _) = connect_async(url.as_str()).await.unwrap();
        let events = wait_events(&host, 1).await;
        assert!(matches!(&events[0], HostEvent::Connected(_)));
        host.stop();
    }

    #[tokio::test]
    async fn stop_disconnects_everyone_and_frees_the_port() {
        let host = WsHost::start(0, "loopback", 4).await.unwrap();
        let port = host.info().port;
        let url = format!("ws://127.0.0.1:{port}");
        let (mut client, _) = connect_async(url.as_str()).await.unwrap();
        wait_events(&host, 1).await;
        host.stop();
        let next = client.next().await;
        assert!(matches!(next, Some(Ok(Message::Close(_))) | None | Some(Err(_))));
        drop(host);
        // Porta liberada: outro host abre na mesma porta.
        let mut reopened = None;
        for _ in 0..100 {
            if let Ok(h) = WsHost::start(port, "loopback", 1).await {
                reopened = Some(h);
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(reopened.is_some());
    }

    #[tokio::test]
    async fn oversized_messages_are_rejected_by_the_socket() {
        let host = WsHost::start(0, "loopback", 2).await.unwrap();
        let url = format!("ws://127.0.0.1:{}", host.info().port);
        let (mut client, _) = connect_async(url.as_str()).await.unwrap();
        wait_events(&host, 1).await;
        let _ = client.send(Message::Binary(Bytes::from(vec![0u8; MAX_MESSAGE_BYTES + 1]))).await;
        let events = wait_events(&host, 1).await;
        assert!(matches!(&events[0], HostEvent::Disconnected(_, reason) if reason == "erro_conexao"), "{events:?}");
        host.stop();
    }
}
