mod db;
mod settings;
mod tasks;
mod timer;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let pool = db::init(&handle).expect("init sqlite");
            app.manage(pool);
            timer::register(&handle);
            let settings_store = settings::init(&handle);
            app.manage(settings_store);
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
            timer::timer_set_auto_starts,
            tasks::tasks_list,
            tasks::tasks_create,
            tasks::tasks_update,
            tasks::tasks_delete,
            tasks::tasks_reorder,
            tasks::tasks_set_current,
            settings::settings_get,
            settings::settings_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
