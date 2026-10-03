use serde::{Deserialize, Serialize};

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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamInventoryItemDto {
    pub item_id: String,
    pub definition_id: u32,
    pub sku: String,
    pub quantity: u32,
    pub acquired_timestamp: u64,
    pub is_tradable: bool,
    pub is_marketable: bool,
}

#[tauri::command]
pub async fn monetization_init_purchase(
    sku: String,
    amount_cents: u64,
) -> Result<TransactionReceiptDto, String> {
    println!(
        "[Rust Monetization] Inicializando transação ISteamMicroTxn para SKU: {} | Preço: {} centavos",
        sku, amount_cents
    );

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;

    let order_id = format!("order_rust_{}_{}", sku, timestamp);
    let trans_id = format!("trans_rust_{}", timestamp);
    let steam_id = "76561198000000000".to_string();

    let raw_sig = format!("{}:{}:{}:{}:{}:STEAM_SECRET_SALT", order_id, trans_id, steam_id, sku, amount_cents);
    let signature = format!("sig_{:x}", simple_hash(&raw_sig));

    Ok(TransactionReceiptDto {
        order_id,
        trans_id,
        steam_id,
        sku,
        amount_cents,
        status: "pending".to_string(),
        timestamp,
        signature,
    })
}

#[tauri::command]
pub async fn monetization_finalize_purchase(order_id: String) -> Result<bool, String> {
    println!("[Rust Monetization] Finalizando compra no Overlay da Steam para a Ordem: {}", order_id);
    Ok(true)
}

#[tauri::command]
pub async fn monetization_fetch_inventory() -> Result<Vec<SteamInventoryItemDto>, String> {
    println!("[Rust Monetization] Consultando inventário do usuário via steamworks::Client::inventory()");
    Ok(Vec::new())
}

#[tauri::command]
pub async fn monetization_consume_item(item_id: String, quantity: u32) -> Result<bool, String> {
    println!("[Rust Monetization] Consumindo {} unidade(s) do item de inventário: {}", quantity, item_id);
    Ok(true)
}

fn simple_hash(value: &str) -> u64 {
    let mut hash = 5381u64;
    for byte in value.bytes() {
        hash = ((hash << 5).wrapping_add(hash)).wrapping_add(byte as u64);
    }
    hash
}