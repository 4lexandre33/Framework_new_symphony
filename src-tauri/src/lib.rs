mod modding;
mod monetization;
mod overlay;
mod security;
mod steam;

use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use steam::SteamState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var("SteamAppId", "480");
    std::env::set_var("SteamGameId", "480");

    println!("[Steamworks Rust Backend] Tentando inicializar Steamworks SDK com AppID 480...");

    let (steam_client, single_user) = match steamworks::Client::init_app(steamworks::AppId(480)) {
        Ok((client, single_user)) => {
            println!("[Steamworks Rust Backend] ✅ CONECTADO COM SUCESSO À STEAM! (AppID 480)");
            (Some(client), Some(single_user))
        }
        Err(err1) => {
            match steamworks::Client::init() {
                Ok((client, single_user)) => {
                    println!("[Steamworks Rust Backend] ✅ CONECTADO VIA steam_appid.txt!");
                    (Some(client), Some(single_user))
                }
                Err(err2) => {
                    println!("============================================================");
                    println!("[Steamworks Rust Backend] ⚠️ FALHA AO CONECTAR À STEAM!");
                    println!("  Motivo init_app: {:?}", err1);
                    println!("  Motivo init:     {:?}", err2);
                    println!("  DICA: Verifique se o CMD e a Steam estão no mesmo nível de privilégio (UAC).");
                    println!("============================================================");
                    (None, None)
                }
            }
        }
    };

    if let Some(single_user) = single_user {
        thread::spawn(move || {
            loop {
                single_user.run_callbacks();
                thread::sleep(Duration::from_millis(100));
            }
        });
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SteamState {
            client: Mutex::new(steam_client),
        })
        .invoke_handler(tauri::generate_handler![
            steam::steam_is_initialized,
            steam::steam_get_user,
            steam::steam_unlock_achievement,
            steam::steam_set_stat,
            steam::steam_store_stats,
            steam::steam_create_lobby,
            steam::steam_send_p2p_packet,
            steam::steam_read_p2p_packet,
            overlay::overlay_set_ignore_cursor_events,
            overlay::overlay_set_always_on_top,
            overlay::overlay_get_taskbar_bounds,
            security::security_validate_system_clock,
            security::security_write_crash_dump,
            modding::modding_scan_local_mods,
            modding::modding_download_workshop_item,
            modding::modding_publish_workshop_item,
            monetization::monetization_init_purchase,
            monetization::monetization_finalize_purchase,
            monetization::monetization_fetch_inventory,
            monetization::monetization_consume_item
        ])
        .run(tauri::generate_context!())
        .expect("Erro durante a execução do aplicativo Tauri");
}