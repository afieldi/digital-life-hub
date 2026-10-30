mod loopback;
mod token;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(Arc::new(loopback::LoopbackState::default()))
        .invoke_handler(tauri::generate_handler![
            loopback::auth_loopback_start,
            loopback::auth_loopback_wait,
            token::token_get,
            token::token_set,
            token::token_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Digital Life Hub");
}
