mod modding;
mod monetization;
mod overlay;
mod security;
#[cfg(feature = "steam")]
mod steam;
#[cfg(not(feature = "steam"))]
#[path = "steam_offline.rs"]
mod steam;
mod steam_support;

use steam::SteamState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let steam_state = SteamState::initialize();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(steam_state)
        .invoke_handler(tauri::generate_handler![
            steam::steam_runtime_status,
            steam::steam_is_initialized,
            steam::steam_get_user,
            steam::steam_unlock_achievement,
            steam::steam_set_stat,
            steam::steam_store_stats,
            steam::steam_create_lobby,
            steam::steam_join_lobby,
            steam::steam_leave_lobby,
            steam::steam_set_lobby_data,
            steam::steam_get_lobby_data,
            steam::steam_send_p2p_packet,
            steam::steam_read_p2p_packet,
            steam::steam_accept_p2p_session,
            steam::steam_close_p2p_session,
            steam::steam_get_p2p_session_state,
            steam::steam_cloud_status,
            steam::steam_cloud_list_files,
            steam::steam_cloud_write_file,
            steam::steam_cloud_read_file,
            steam::steam_cloud_delete_file,
            steam::steam_overlay_is_enabled,
            steam::steam_activate_overlay,
            steam::steam_workshop_download_item,
            steam::steam_poll_events,
            steam::steam_set_stat_float,
            steam::steam_get_stat,
            steam::steam_read_p2p_packets,
            steam::steam_request_lobby_list,
            steam::steam_get_lobby_details,
            steam::steam_get_lobby_members,
            steam::steam_invite_to_lobby,
            steam::steam_activate_invite_dialog,
            steam::steam_set_lobby_joinable,
            overlay::overlay_set_ignore_cursor_events,
            overlay::overlay_set_always_on_top,
            overlay::overlay_get_taskbar_bounds,
            overlay::overlay_dock_to_taskbar,
            security::security_validate_system_clock,
            security::security_write_crash_dump,
            modding::modding_scan_local_mods,
            modding::modding_download_workshop_item,
            modding::modding_publish_workshop_item,
            modding::modding_list_installed_mods,
            modding::modding_read_mod_file,
            modding::modding_load_enabled_mods,
            modding::modding_save_enabled_mods,
            modding::modding_workshop_item_state,
            monetization::monetization_init_purchase,
            monetization::monetization_finalize_purchase,
            monetization::monetization_fetch_inventory,
            monetization::monetization_consume_item,
            monetization::monetization_start_inventory_purchase
        ])
        .build(tauri::generate_context!())
        .expect("Erro ao construir o aplicativo Tauri");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<SteamState>().shutdown();
        }
    });
}
