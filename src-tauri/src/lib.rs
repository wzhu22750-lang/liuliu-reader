mod commands;
mod db;
mod download;
mod error;
mod fs_export;
mod models;
mod source;

use std::sync::Arc;

use tauri::Manager;

use commands::AppState;
use db::Store;
use error::AppError;
use source::fanqie::FanqieClient;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| AppError::from(e.to_string()))?;
            std::fs::create_dir_all(&dir)?;
            let store = Store::open(dir.join("liuliu.sqlite"))?;
            let fanqie = FanqieClient::new()?;
            app.manage(AppState {
                store: Arc::new(store),
                fanqie: Arc::new(fanqie),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books,
            commands::get_book,
            commands::save_book,
            commands::delete_book,
            commands::hide_book,
            commands::update_book_progress,
            commands::list_excerpts,
            commands::save_excerpt,
            commands::delete_excerpt,
            commands::update_excerpt_thought,
            commands::highlights_by_book,
            commands::save_highlight,
            commands::delete_highlight,
            commands::bookmarks_by_book,
            commands::save_bookmark,
            commands::delete_bookmark,
            commands::find_ai,
            commands::save_ai,
            commands::reader_settings,
            commands::save_reader_settings,
            commands::import_txt,
            commands::search_fanqie,
            commands::import_fanqie,
            commands::export_book_txt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running 溜溜读书");
}
