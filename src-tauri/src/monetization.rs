use serde::{Deserialize, Serialize};

const MAX_IDENTIFIER_LEN: usize = 128;
const MAX_SKU_LEN: usize = 128;
const MAX_CONSUME_QUANTITY: u32 = 1_000_000;
const MAX_AMOUNT_CENTS: u64 = 100_000_000_000;

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
    validate_sku(&sku)?;
    validate_amount_cents(amount_cents)?;

    Err(
        "Steam MicroTxn native adapter não está configurado; compra recusada em modo fail-closed."
            .to_string(),
    )
}

#[tauri::command]
pub async fn monetization_finalize_purchase(
    order_id: String,
) -> Result<bool, String> {
    validate_identifier(
        &order_id,
        "order_id",
    )?;

    Err(
        "Steam MicroTxn finalize não está configurado; operação recusada em modo fail-closed."
            .to_string(),
    )
}

#[tauri::command]
pub async fn monetization_fetch_inventory(
) -> Result<Vec<SteamInventoryItemDto>, String> {
    Err(
        "Steam Inventory native adapter não está configurado; inventário não foi fabricado."
            .to_string(),
    )
}

#[tauri::command]
pub async fn monetization_consume_item(
    item_id: String,
    quantity: u32,
) -> Result<bool, String> {
    validate_identifier(
        &item_id,
        "item_id",
    )?;
    validate_quantity(
        quantity,
    )?;

    Err(
        "Steam Inventory consume não está configurado; operação recusada em modo fail-closed."
            .to_string(),
    )
}

fn validate_sku(
    value: &str,
) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_SKU_LEN
        || value.contains('\0')
        || !value
            .bytes()
            .all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(
                        byte,
                        b'_' | b'-' | b'.' | b':'
                    )
            })
    {
        return Err(
            "sku inválido."
                .to_string(),
        );
    }

    Ok(())
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

fn validate_amount_cents(
    amount_cents: u64,
) -> Result<(), String> {
    if amount_cents == 0
        || amount_cents > MAX_AMOUNT_CENTS
    {
        return Err(
            "amount_cents fora do intervalo permitido."
                .to_string(),
        );
    }

    Ok(())
}

fn validate_quantity(
    quantity: u32,
) -> Result<(), String> {
    if quantity == 0
        || quantity > MAX_CONSUME_QUANTITY
    {
        return Err(
            "quantity fora do intervalo permitido."
                .to_string(),
        );
    }

    Ok(())
}
