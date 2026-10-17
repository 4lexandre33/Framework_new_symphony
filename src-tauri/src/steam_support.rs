//! Lógica pura (sem dependência de steamworks) compartilhada pelo adapter
//! Steam real (`steam.rs`) e pelo adapter offline (`steam_offline.rs`).
//!
//! Tudo aqui é validável por `cargo test` sem o runtime da Steam.
#![cfg_attr(not(feature = "steam"), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

pub const MAX_PENDING_STEAM_EVENTS: usize = 1024;
pub const MAX_EVENTS_PER_POLL: u32 = 256;
pub const MAX_P2P_BATCH_PACKETS: u32 = 512;
pub const MAX_P2P_BATCH_BYTES: u32 = 4 * 1024 * 1024;
pub const MAX_P2P_PACKET_BYTES: usize = 1024 * 1024;
pub const MAX_LOBBY_SEARCH_FILTERS: usize = 16;
pub const MAX_LOBBY_SEARCH_RESULTS: u32 = 50;
pub const MAX_LOBBY_FILTER_KEY_LEN: usize = 255;
pub const MAX_LOBBY_FILTER_VALUE_LEN: usize = 255;

/// Evento nativo da Steam enfileirado pelo callback pump e drenado pelo
/// WebView via `steam_poll_events`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SteamEventDto {
    #[serde(rename_all = "camelCase")]
    P2pSessionRequest { remote_steam_id: String },
    #[serde(rename_all = "camelCase")]
    P2pSessionConnectFail { remote_steam_id: String, error: u8 },
    #[serde(rename_all = "camelCase")]
    LobbyChatUpdate {
        lobby_id: String,
        user_steam_id: String,
        making_change_steam_id: String,
        /// entered | left | disconnected | kicked | banned
        change: String,
    },
    #[serde(rename_all = "camelCase")]
    LobbyDataUpdate {
        lobby_id: String,
        member_steam_id: String,
        success: bool,
    },
    #[serde(rename_all = "camelCase")]
    LobbyJoinRequested {
        lobby_id: String,
        friend_steam_id: String,
    },
    #[serde(rename_all = "camelCase")]
    UserStatsReceived {
        steam_id: String,
        success: bool,
        error: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    MicroTxnAuthorization {
        app_id: u32,
        order_id: String,
        authorized: bool,
    },
    #[serde(rename_all = "camelCase")]
    WorkshopDownloadResult {
        published_file_id: String,
        success: bool,
        error: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    InventoryResultReady { handle: i32, success: bool },
    SteamServersConnected,
    SteamServersDisconnected,
    #[serde(rename_all = "camelCase")]
    EventsDropped { count: u64 },
}

/// Fila limitada: ao exceder a capacidade descarta o evento mais antigo e
/// contabiliza a perda (informada ao WebView como `eventsDropped`).
#[derive(Debug)]
pub struct SteamEventQueue {
    events: VecDeque<SteamEventDto>,
    capacity: usize,
    dropped: u64,
}

impl SteamEventQueue {
    pub fn new(capacity: usize) -> Self {
        Self {
            events: VecDeque::new(),
            capacity: capacity.max(1),
            dropped: 0,
        }
    }

    pub fn push(&mut self, event: SteamEventDto) {
        if self.events.len() >= self.capacity {
            self.events.pop_front();
            self.dropped = self.dropped.saturating_add(1);
        }
        self.events.push_back(event);
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn drain(&mut self, max_events: u32) -> Vec<SteamEventDto> {
        let limit = clamp_count(max_events, MAX_EVENTS_PER_POLL) as usize;
        let mut drained = Vec::with_capacity(limit.min(self.events.len()) + 1);

        if self.dropped > 0 {
            drained.push(SteamEventDto::EventsDropped {
                count: self.dropped,
            });
            self.dropped = 0;
        }

        while drained.len() < limit {
            match self.events.pop_front() {
                Some(event) => drained.push(event),
                None => break,
            }
        }

        drained
    }
}

/// Limita um contador pedido pelo WebView a `1..=max` (0 vira 1).
pub fn clamp_count(requested: u32, max: u32) -> u32 {
    requested.clamp(1, max.max(1))
}

/// Orçamento de uma drenagem P2P em lote.
#[derive(Debug, Clone, Copy)]
pub struct P2PBatchBudget {
    pub max_packets: u32,
    pub max_bytes: u32,
    packets: u32,
    bytes: u32,
}

impl P2PBatchBudget {
    pub fn new(max_packets: u32, max_bytes: u32) -> Self {
        Self {
            max_packets: clamp_count(max_packets, MAX_P2P_BATCH_PACKETS),
            max_bytes: max_bytes.clamp(MAX_P2P_PACKET_BYTES as u32, MAX_P2P_BATCH_BYTES),
            packets: 0,
            bytes: 0,
        }
    }

    /// `true` se ainda cabe um pacote de `size` bytes no lote.
    pub fn can_take(&self, size: usize) -> bool {
        self.packets < self.max_packets
            && (self.bytes as usize).saturating_add(size) <= self.max_bytes as usize
    }

    pub fn take(&mut self, size: usize) {
        self.packets = self.packets.saturating_add(1);
        self.bytes = self.bytes.saturating_add(size as u32);
    }

    pub fn exhausted(&self) -> bool {
        self.packets >= self.max_packets
    }
}

/// Classifica um pacote P2P pendente: dentro do limite é lido; acima é
/// descartado (lido para um buffer pequeno) para NUNCA travar o canal (G111).
#[derive(Debug, PartialEq, Eq)]
pub enum PacketDisposition {
    Read,
    Discard,
}

pub fn classify_incoming_packet(size: usize) -> PacketDisposition {
    if size > MAX_P2P_PACKET_BYTES {
        PacketDisposition::Discard
    } else {
        PacketDisposition::Read
    }
}

/// Valida o valor de uma estatística float vinda do WebView.
pub fn validate_stat_f32(value: f64) -> Result<f32, String> {
    if !value.is_finite() || value.abs() > f32::MAX as f64 {
        return Err("Valor de estatística float inválido".to_string());
    }
    Ok(value as f32)
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LobbyComparison {
    Equal,
    NotEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LobbyStringFilterDto {
    pub key: String,
    pub value: String,
    pub comparison: Option<LobbyComparison>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LobbyNumberFilterDto {
    pub key: String,
    pub value: i32,
    pub comparison: Option<LobbyComparison>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct LobbySearchDto {
    pub string_filters: Option<Vec<LobbyStringFilterDto>>,
    pub number_filters: Option<Vec<LobbyNumberFilterDto>>,
    pub slots_available: Option<u8>,
    /// close | default | far | worldwide
    pub distance: Option<String>,
    pub max_results: Option<u32>,
}

fn validate_filter_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_LOBBY_FILTER_KEY_LEN || key.contains('\0') {
        return Err("Chave de filtro de lobby inválida".to_string());
    }
    Ok(())
}

pub fn validate_lobby_search(search: &LobbySearchDto) -> Result<(), String> {
    let string_count = search.string_filters.as_ref().map_or(0, Vec::len);
    let number_count = search.number_filters.as_ref().map_or(0, Vec::len);

    if string_count + number_count > MAX_LOBBY_SEARCH_FILTERS {
        return Err(format!(
            "Busca de lobby aceita no máximo {MAX_LOBBY_SEARCH_FILTERS} filtros"
        ));
    }

    for filter in search.string_filters.iter().flatten() {
        validate_filter_key(&filter.key)?;
        if filter.value.len() > MAX_LOBBY_FILTER_VALUE_LEN || filter.value.contains('\0') {
            return Err("Valor de filtro de lobby inválido".to_string());
        }
        if let Some(comparison) = &filter.comparison {
            if !matches!(comparison, LobbyComparison::Equal | LobbyComparison::NotEqual) {
                return Err("Filtro string de lobby aceita apenas equal/notEqual".to_string());
            }
        }
    }

    for filter in search.number_filters.iter().flatten() {
        validate_filter_key(&filter.key)?;
    }

    if let Some(distance) = search.distance.as_deref() {
        if !matches!(distance, "close" | "default" | "far" | "worldwide") {
            return Err(format!("Filtro de distância inválido: {distance}"));
        }
    }

    if let Some(max_results) = search.max_results {
        if max_results == 0 || max_results > MAX_LOBBY_SEARCH_RESULTS {
            return Err(format!(
                "maxResults precisa estar entre 1 e {MAX_LOBBY_SEARCH_RESULTS}"
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_queue_is_bounded_and_reports_drops() {
        let mut queue = SteamEventQueue::new(2);
        for index in 0..5 {
            queue.push(SteamEventDto::P2pSessionRequest {
                remote_steam_id: index.to_string(),
            });
        }
        assert_eq!(queue.len(), 2);
        let drained = queue.drain(10);
        assert_eq!(drained[0], SteamEventDto::EventsDropped { count: 3 });
        assert_eq!(drained.len(), 3);
        assert_eq!(queue.len(), 0);
        assert!(queue.drain(10).is_empty());
    }

    #[test]
    fn event_queue_drain_respects_limit() {
        let mut queue = SteamEventQueue::new(10);
        for _ in 0..5 {
            queue.push(SteamEventDto::SteamServersConnected);
        }
        assert_eq!(queue.drain(2).len(), 2);
        assert_eq!(queue.len(), 3);
        assert_eq!(queue.drain(0).len(), 1);
    }

    #[test]
    fn event_serialization_uses_camel_case_tag() {
        let json = serde_json::to_string(&SteamEventDto::P2pSessionRequest {
            remote_steam_id: "1".to_string(),
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"p2pSessionRequest","remoteSteamId":"1"}"#);
    }

    #[test]
    fn oversized_packets_are_discarded_not_locked() {
        assert_eq!(classify_incoming_packet(10), PacketDisposition::Read);
        assert_eq!(
            classify_incoming_packet(MAX_P2P_PACKET_BYTES),
            PacketDisposition::Read
        );
        assert_eq!(
            classify_incoming_packet(MAX_P2P_PACKET_BYTES + 1),
            PacketDisposition::Discard
        );
    }

    #[test]
    fn batch_budget_limits_packets_and_bytes() {
        let mut budget = P2PBatchBudget::new(2, 0);
        assert_eq!(budget.max_bytes, MAX_P2P_PACKET_BYTES as u32);
        assert!(budget.can_take(100));
        budget.take(100);
        assert!(!budget.can_take(MAX_P2P_PACKET_BYTES));
        budget.take(100);
        assert!(budget.exhausted());
        assert!(!budget.can_take(1));
        assert_eq!(P2PBatchBudget::new(0, u32::MAX).max_packets, 1);
        assert_eq!(
            P2PBatchBudget::new(u32::MAX, u32::MAX).max_bytes,
            MAX_P2P_BATCH_BYTES
        );
    }

    #[test]
    fn stat_float_validation() {
        assert_eq!(validate_stat_f32(1.5).unwrap(), 1.5_f32);
        assert!(validate_stat_f32(f64::NAN).is_err());
        assert!(validate_stat_f32(f64::INFINITY).is_err());
        assert!(validate_stat_f32(1e300).is_err());
    }

    #[test]
    fn lobby_search_validation() {
        let ok = LobbySearchDto {
            string_filters: Some(vec![LobbyStringFilterDto {
                key: "mode".into(),
                value: "coop".into(),
                comparison: None,
            }]),
            number_filters: None,
            slots_available: Some(1),
            distance: Some("worldwide".into()),
            max_results: Some(10),
        };
        assert!(validate_lobby_search(&ok).is_ok());

        let mut bad = ok.clone();
        bad.distance = Some("moon".into());
        assert!(validate_lobby_search(&bad).is_err());

        let mut bad = ok.clone();
        bad.max_results = Some(0);
        assert!(validate_lobby_search(&bad).is_err());

        let mut bad = ok.clone();
        bad.string_filters = Some(vec![LobbyStringFilterDto {
            key: "a\0".into(),
            value: "b".into(),
            comparison: None,
        }]);
        assert!(validate_lobby_search(&bad).is_err());

        let mut bad = ok;
        bad.string_filters = Some(vec![LobbyStringFilterDto {
            key: "a".into(),
            value: "b".into(),
            comparison: Some(LobbyComparison::GreaterThan),
        }]);
        assert!(validate_lobby_search(&bad).is_err());
    }
}
