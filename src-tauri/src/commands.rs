use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::db::Store;
use crate::download::import_fanqie_book;
use crate::error::AppResult;
use crate::fs_export::{default_export_path, write_txt};
use crate::models::{
    AIInterpretation, Bookmark, Book, BookProgress, Excerpt, Highlight, ReaderSettings, SearchHit,
};
use crate::source::fanqie::FanqieClient;
use crate::source::local::parse_txt;

pub struct AppState {
    pub store: Arc<Store>,
    pub fanqie: Arc<FanqieClient>,
}

#[tauri::command]
pub fn list_books(state: State<AppState>) -> AppResult<Vec<Book>> {
    state.store.list_books()
}

#[tauri::command]
pub fn get_book(state: State<AppState>, id: String) -> AppResult<Option<Book>> {
    state.store.get_book(&id)
}

#[tauri::command]
pub fn save_book(state: State<AppState>, book: Book) -> AppResult<()> {
    state.store.save_book(&book)
}

#[tauri::command]
pub fn delete_book(state: State<AppState>, id: String) -> AppResult<()> {
    state.store.delete_book(&id)
}

#[tauri::command]
pub fn hide_book(state: State<AppState>, id: String, is_archived: bool) -> AppResult<()> {
    if let Some(mut book) = state.store.get_book(&id)? {
        book.is_archived = Some(is_archived);
        book.updated_at = now_ms();
        state.store.save_book(&book)?;
    }
    Ok(())
}

#[tauri::command]
pub fn update_book_progress(
    state: State<AppState>,
    id: String,
    chapter_index: i64,
    chapter_title: String,
    percentage: i64,
    scroll_offset: Option<i64>,
) -> AppResult<()> {
    if let Some(mut book) = state.store.get_book(&id)? {
        book.progress = BookProgress {
            chapter_index,
            chapter_title,
            percentage,
            scroll_offset,
            last_read_time: now_ms(),
        };
        book.updated_at = now_ms();
        state.store.save_book(&book)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_excerpts(state: State<AppState>) -> AppResult<Vec<Excerpt>> {
    state.store.list_excerpts()
}

#[tauri::command]
pub fn save_excerpt(state: State<AppState>, excerpt: Excerpt) -> AppResult<()> {
    state.store.save_excerpt(&excerpt)
}

#[tauri::command]
pub fn delete_excerpt(state: State<AppState>, id: String) -> AppResult<()> {
    state.store.delete_excerpt(&id)
}

#[tauri::command]
pub fn update_excerpt_thought(state: State<AppState>, id: String, thought: String) -> AppResult<()> {
    let mut list = state.store.list_excerpts()?;
    if let Some(item) = list.iter_mut().find(|e| e.id == id) {
        item.thought = Some(thought);
        state.store.save_excerpt(item)?;
    }
    Ok(())
}

#[tauri::command]
pub fn highlights_by_book(state: State<AppState>, book_id: String) -> AppResult<Vec<Highlight>> {
    state.store.highlights_by_book(&book_id)
}

#[tauri::command]
pub fn save_highlight(state: State<AppState>, highlight: Highlight) -> AppResult<()> {
    state.store.save_highlight(&highlight)
}

#[tauri::command]
pub fn delete_highlight(state: State<AppState>, id: String) -> AppResult<()> {
    state.store.delete_highlight(&id)
}

#[tauri::command]
pub fn bookmarks_by_book(state: State<AppState>, book_id: String) -> AppResult<Vec<Bookmark>> {
    state.store.bookmarks_by_book(&book_id)
}

#[tauri::command]
pub fn save_bookmark(state: State<AppState>, bookmark: Bookmark) -> AppResult<()> {
    state.store.save_bookmark(&bookmark)
}

#[tauri::command]
pub fn delete_bookmark(state: State<AppState>, id: String) -> AppResult<()> {
    state.store.delete_bookmark(&id)
}

#[tauri::command]
pub fn find_ai(
    state: State<AppState>,
    book_id: String,
    chapter_index: i64,
    selected_text: String,
) -> AppResult<Option<AIInterpretation>> {
    state.store.find_ai(&book_id, chapter_index, &selected_text)
}

#[tauri::command]
pub fn save_ai(state: State<AppState>, item: AIInterpretation) -> AppResult<()> {
    state.store.save_ai(&item)
}

#[tauri::command]
pub fn reader_settings(state: State<AppState>) -> AppResult<ReaderSettings> {
    state.store.reader_settings()
}

#[tauri::command]
pub fn save_reader_settings(state: State<AppState>, settings: ReaderSettings) -> AppResult<()> {
    state.store.save_reader_settings(&settings)
}

#[tauri::command]
pub fn import_txt(state: State<AppState>, file_name: String, content: String) -> AppResult<Book> {
    let book = parse_txt(&content, &file_name)?;
    state.store.save_book(&book)?;
    Ok(book)
}

#[tauri::command]
pub async fn search_fanqie(state: State<'_, AppState>, query: String) -> AppResult<Vec<SearchHit>> {
    state.fanqie.search(&query).await
}

#[tauri::command]
pub async fn import_fanqie(app: AppHandle, state: State<'_, AppState>, input: String) -> AppResult<Book> {
    import_fanqie_book(app, state.store.clone(), state.fanqie.clone(), input).await
}

#[tauri::command]
pub fn export_book_txt(app: AppHandle, state: State<AppState>, id: String) -> AppResult<String> {
    let book = state
        .store
        .get_book(&id)?
        .ok_or_else(|| crate::error::AppError::from("书籍不存在"))?;
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let dest = default_export_path(dir.join("exports"), &book);
    let path = write_txt(&book, dest)?;
    Ok(path.to_string_lossy().into_owned())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
