//! Monetização nativa: Steam Inventory (itens, consumo e compra pelo
//! cliente via `StartPurchase`) por bindings raw do steamworks.
//!
//! Microtransações (ISteamMicroTxn InitTxn/FinalizeTxn) exigem a publisher
//! Web API key e por isso SÓ podem ser feitas por um servidor do jogo: os
//! comandos `monetization_init_purchase`/`finalize_purchase` permanecem
//! fail-closed (nenhum recibo é fabricado). O cliente só observa a resposta
//! do usuário (`MicroTxnAuthorizationResponse_t`, via `steam_poll_events`).

use serde::{Deserialize, Serialize};
use tauri::Manager;

const MAX_IDENTIFIER_LEN: usize = 128;
const MAX_SKU_LEN: usize = 128;
const MAX_CONSUME_QUANTITY: u32 = 1_000_000;
const MAX_AMOUNT_CENTS: u64 = 100_000_000_000;
const MAX_PURCHASE_LINES: usize = 32;
const MAX_PURCHASE_QUANTITY: u32 = 100;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransactionReceiptDto {
    pub order_id: String,
    pub trans_id: String,
    pub steam_id: String,
    pub sku: String,
    pub amount_cents: u64,
    pub status: String,
    pub timestamp: u64,
    pub signature: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamInventoryItemDto {
    pub item_id: String,
    pub definition_id: u32,
    /// `def:<definitionId>` — o TS mapeia para o SKU do catálogo (`steamItemDefId`).
    pub sku: String,
    pub quantity: u32,
    pub acquired_timestamp: u64,
    pub is_tradable: bool,
    pub is_marketable: bool,
}

const MICROTXN_SERVER_ONLY: &str = "Steam MicroTxn exige servidor do jogo (ISteamMicroTxn com publisher key): \
configure um PurchaseProvider no TypeScript. Compra recusada em modo fail-closed.";

#[tauri::command]
pub async fn monetization_init_purchase(
    sku: String,
    amount_cents: u64,
) -> Result<TransactionReceiptDto, String> {
    validate_sku(&sku)?;
    validate_amount_cents(amount_cents)?;
    Err(MICROTXN_SERVER_ONLY.to_string())
}

#[tauri::command]
pub async fn monetization_finalize_purchase(order_id: String) -> Result<bool, String> {
    validate_identifier(&order_id, "order_id")?;
    Err(MICROTXN_SERVER_ONLY.to_string())
}

/// Linha validada de compra de inventário (definição, quantidade).
pub fn validate_purchase_lines(item_defs: &[u32], quantities: &[u32]) -> Result<(), String> {
    if item_defs.is_empty() || item_defs.len() > MAX_PURCHASE_LINES || item_defs.len() != quantities.len() {
        return Err("Compra de inventário inválida: listas vazias, grandes demais ou desalinhadas".to_string());
    }
    if item_defs.iter().any(|def| *def == 0 || *def > i32::MAX as u32) {
        return Err("itemDef inválido".to_string());
    }
    if quantities.iter().any(|qty| *qty == 0 || *qty > MAX_PURCHASE_QUANTITY) {
        return Err(format!("quantidade precisa estar entre 1 e {MAX_PURCHASE_QUANTITY}"));
    }
    Ok(())
}

/// Converte flags de item em (tradable, removido/consumido).
#[cfg_attr(not(feature = "steam"), allow(dead_code))]
pub fn item_flags(flags: u16) -> (bool, bool) {
    let no_trade = flags & 1 != 0;
    let gone = flags & (256 | 512) != 0;
    (!no_trade, gone)
}

#[cfg(feature = "steam")]
mod inventory {
    use super::*;
    use std::ffi::CString;
    use std::time::{Duration, Instant};

    const RESULT_TIMEOUT: Duration = Duration::from_secs(15);
    const MAX_ITEMS: u32 = 4096;

    fn interface() -> Result<*mut steamworks::sys::ISteamInventory, String> {
        let inventory = unsafe { steamworks::sys::SteamAPI_SteamInventory_v003() };
        if inventory.is_null() {
            Err("Interface ISteamInventory indisponível".to_string())
        } else {
            Ok(inventory)
        }
    }

    /// Espera o resultado sair de `Pending` (o callback pump roda em outra thread).
    fn wait_result(
        inventory: *mut steamworks::sys::ISteamInventory,
        handle: steamworks::sys::SteamInventoryResult_t,
    ) -> Result<(), String> {
        let started = Instant::now();
        loop {
            let status = unsafe { steamworks::sys::SteamAPI_ISteamInventory_GetResultStatus(inventory, handle) };
            match status {
                steamworks::sys::EResult::k_EResultPending => {
                    if started.elapsed() > RESULT_TIMEOUT {
                        return Err("Timeout aguardando resultado do Steam Inventory".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
                steamworks::sys::EResult::k_EResultOK => return Ok(()),
                other => return Err(format!("Steam Inventory falhou: {other:?}")),
            }
        }
    }

    fn marketable(inventory: *mut steamworks::sys::ISteamInventory, definition: i32) -> bool {
        let Ok(name) = CString::new("marketable") else { return false };
        let mut buffer = [0_i8; 16];
        let mut size = buffer.len() as u32;
        let ok = unsafe {
            steamworks::sys::SteamAPI_ISteamInventory_GetItemDefinitionProperty(
                inventory,
                definition,
                name.as_ptr(),
                buffer.as_mut_ptr(),
                &mut size,
            )
        };
        if !ok {
            return false;
        }
        let value = unsafe { std::ffi::CStr::from_ptr(buffer.as_ptr()) };
        value.to_bytes() == b"true" || value.to_bytes() == b"1"
    }

    fn read_items(
        inventory: *mut steamworks::sys::ISteamInventory,
        handle: steamworks::sys::SteamInventoryResult_t,
    ) -> Result<Vec<SteamInventoryItemDto>, String> {
        let mut count = 0_u32;
        let ok = unsafe {
            steamworks::sys::SteamAPI_ISteamInventory_GetResultItems(inventory, handle, std::ptr::null_mut(), &mut count)
        };
        if !ok {
            return Err("GetResultItems falhou".to_string());
        }
        let count = count.min(MAX_ITEMS);
        let mut details: Vec<steamworks::sys::SteamItemDetails_t> = vec![unsafe { std::mem::zeroed() }; count as usize];
        let mut filled = count;
        let ok = unsafe {
            steamworks::sys::SteamAPI_ISteamInventory_GetResultItems(inventory, handle, details.as_mut_ptr(), &mut filled)
        };
        if !ok {
            return Err("GetResultItems falhou".to_string());
        }
        let timestamp = unsafe { steamworks::sys::SteamAPI_ISteamInventory_GetResultTimestamp(inventory, handle) };

        let mut items = Vec::with_capacity(filled as usize);
        for detail in details.into_iter().take(filled as usize) {
            // cópias por valor (struct packed)
            let item_id = detail.m_itemId;
            let definition = detail.m_iDefinition;
            let quantity = detail.m_unQuantity;
            let flags = detail.m_unFlags;
            let (tradable, gone) = item_flags(flags);
            if gone || definition <= 0 {
                continue;
            }
            items.push(SteamInventoryItemDto {
                item_id: item_id.to_string(),
                definition_id: definition as u32,
                sku: format!("def:{definition}"),
                quantity: u32::from(quantity),
                acquired_timestamp: u64::from(timestamp),
                is_tradable: tradable,
                is_marketable: marketable(inventory, definition),
            });
        }
        Ok(items)
    }

    pub fn fetch_all() -> Result<Vec<SteamInventoryItemDto>, String> {
        let inventory = interface()?;
        unsafe { steamworks::sys::SteamAPI_ISteamInventory_LoadItemDefinitions(inventory) };
        let mut handle = steamworks::sys::k_SteamInventoryResultInvalid;
        if !unsafe { steamworks::sys::SteamAPI_ISteamInventory_GetAllItems(inventory, &mut handle) } {
            return Err("GetAllItems recusado pela Steam".to_string());
        }
        let result = wait_result(inventory, handle).and_then(|_| read_items(inventory, handle));
        unsafe { steamworks::sys::SteamAPI_ISteamInventory_DestroyResult(inventory, handle) };
        result
    }

    pub fn consume(item_id: u64, quantity: u32) -> Result<bool, String> {
        let inventory = interface()?;
        let mut handle = steamworks::sys::k_SteamInventoryResultInvalid;
        if !unsafe { steamworks::sys::SteamAPI_ISteamInventory_ConsumeItem(inventory, &mut handle, item_id, quantity) } {
            return Err("ConsumeItem recusado pela Steam".to_string());
        }
        let result = wait_result(inventory, handle);
        unsafe { steamworks::sys::SteamAPI_ISteamInventory_DestroyResult(inventory, handle) };
        result.map(|_| true)
    }

    pub fn start_purchase(item_defs: &[u32], quantities: &[u32]) -> Result<bool, String> {
        let inventory = interface()?;
        let defs: Vec<i32> = item_defs.iter().map(|def| *def as i32).collect();
        let call = unsafe {
            steamworks::sys::SteamAPI_ISteamInventory_StartPurchase(
                inventory,
                defs.as_ptr(),
                quantities.as_ptr(),
                defs.len() as u32,
            )
        };
        // 0 = k_uAPICallInvalid: a Steam recusou abrir o checkout.
        Ok(call != 0)
    }
}

#[cfg(feature = "steam")]
#[tauri::command]
pub async fn monetization_fetch_inventory(app: tauri::AppHandle) -> Result<Vec<SteamInventoryItemDto>, String> {
    app.state::<crate::steam::SteamState>().client()?;
    tauri::async_runtime::spawn_blocking(inventory::fetch_all)
        .await
        .map_err(|e| format!("Worker de inventário falhou: {e}"))?
}

#[cfg(not(feature = "steam"))]
#[tauri::command]
pub async fn monetization_fetch_inventory(app: tauri::AppHandle) -> Result<Vec<SteamInventoryItemDto>, String> {
    let _ = app.state::<crate::steam::SteamState>();
    Err("Steam Inventory indisponível: build sem a feature `steam`; inventário não foi fabricado.".to_string())
}

#[cfg(feature = "steam")]
#[tauri::command]
pub async fn monetization_consume_item(app: tauri::AppHandle, item_id: String, quantity: u32) -> Result<bool, String> {
    let item = parse_item_instance(&item_id)?;
    validate_quantity(quantity)?;
    app.state::<crate::steam::SteamState>().client()?;
    tauri::async_runtime::spawn_blocking(move || inventory::consume(item, quantity))
        .await
        .map_err(|e| format!("Worker de consumo falhou: {e}"))?
}

#[cfg(not(feature = "steam"))]
#[tauri::command]
pub async fn monetization_consume_item(app: tauri::AppHandle, item_id: String, quantity: u32) -> Result<bool, String> {
    let _ = app.state::<crate::steam::SteamState>();
    parse_item_instance(&item_id)?;
    validate_quantity(quantity)?;
    Err("Steam Inventory indisponível: build sem a feature `steam`.".to_string())
}

/// Abre o checkout da Steam (overlay) para itens do Steam Inventory. Os
/// itens comprados chegam ao inventário (refaça `fetch_inventory`).
#[cfg(feature = "steam")]
#[tauri::command]
pub async fn monetization_start_inventory_purchase(
    app: tauri::AppHandle,
    item_defs: Vec<u32>,
    quantities: Vec<u32>,
) -> Result<bool, String> {
    validate_purchase_lines(&item_defs, &quantities)?;
    app.state::<crate::steam::SteamState>().client()?;
    inventory::start_purchase(&item_defs, &quantities)
}

#[cfg(not(feature = "steam"))]
#[tauri::command]
pub async fn monetization_start_inventory_purchase(
    item_defs: Vec<u32>,
    quantities: Vec<u32>,
) -> Result<bool, String> {
    validate_purchase_lines(&item_defs, &quantities)?;
    Err("Steam Inventory indisponível: build sem a feature `steam`.".to_string())
}

fn parse_item_instance(item_id: &str) -> Result<u64, String> {
    validate_identifier(item_id, "item_id")?;
    if item_id.len() > 20 || !item_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("item_id precisa ser o id decimal da instância".to_string());
    }
    item_id.parse::<u64>().map_err(|_| "item_id fora do intervalo".to_string())
}

fn validate_sku(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_SKU_LEN
        || value.contains('\0')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
    {
        return Err("sku inválido.".to_string());
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_IDENTIFIER_LEN || value.contains('\0') {
        return Err(format!("{label} inválido."));
    }
    Ok(())
}

fn validate_amount_cents(amount_cents: u64) -> Result<(), String> {
    if amount_cents == 0 || amount_cents > MAX_AMOUNT_CENTS {
        return Err("amount_cents fora do intervalo permitido.".to_string());
    }
    Ok(())
}

fn validate_quantity(quantity: u32) -> Result<(), String> {
    if quantity == 0 || quantity > MAX_CONSUME_QUANTITY {
        return Err("quantity fora do intervalo permitido.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn purchase_lines_validation() {
        assert!(validate_purchase_lines(&[100], &[1]).is_ok());
        assert!(validate_purchase_lines(&[], &[]).is_err());
        assert!(validate_purchase_lines(&[100, 101], &[1]).is_err());
        assert!(validate_purchase_lines(&[0], &[1]).is_err());
        assert!(validate_purchase_lines(&[100], &[0]).is_err());
        assert!(validate_purchase_lines(&[100], &[101]).is_err());
        assert!(validate_purchase_lines(&[u32::MAX], &[1]).is_err());
    }

    #[test]
    fn item_flag_mapping() {
        assert_eq!(item_flags(0), (true, false));
        assert_eq!(item_flags(1), (false, false));
        assert_eq!(item_flags(256), (true, true));
        assert_eq!(item_flags(512 | 1), (false, true));
    }

    #[test]
    fn identifier_validation() {
        assert!(parse_item_instance("123").is_ok());
        assert!(parse_item_instance("12a").is_err());
        assert!(parse_item_instance("").is_err());
        assert!(validate_sku("gold_pack:1").is_ok());
        assert!(validate_sku("bad sku").is_err());
        assert!(validate_amount_cents(0).is_err());
        assert!(validate_quantity(0).is_err());
    }
}
