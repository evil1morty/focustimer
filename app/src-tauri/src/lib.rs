mod timer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            timer::register(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            timer::timer_snapshot,
            timer::timer_start,
            timer::timer_pause,
            timer::timer_resume,
            timer::timer_skip,
            timer::timer_reset,
            timer::timer_set_template,
            timer::timer_set_auto_start_next,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
