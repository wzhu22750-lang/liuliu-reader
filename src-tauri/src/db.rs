use std::path::PathBuf;

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::{
    AIInterpretation, Bookmark, Book, Excerpt, Highlight, ReaderSettings,
};

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: PathBuf) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                updated_at INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS excerpts (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS highlights (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS bookmarks (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_cache (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                chapter_index INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            ",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn list_books(&self) -> AppResult<Vec<Book>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT payload FROM books ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| {
            let payload: String = row.get(0)?;
            Ok(payload)
        })?;
        let mut books = Vec::new();
        for row in rows {
            books.push(serde_json::from_str(&row?)?);
        }
        Ok(books)
    }

    pub fn get_book(&self, id: &str) -> AppResult<Option<Book>> {
        let conn = self.conn.lock();
        let payload: Option<String> = conn
            .query_row("SELECT payload FROM books WHERE id = ?1", [id], |row| row.get(0))
            .optional()?;
        Ok(payload.map(|p| serde_json::from_str(&p)).transpose()?)
    }

    pub fn save_book(&self, book: &Book) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO books(id, updated_at, payload) VALUES(?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, payload=excluded.payload",
            params![book.id, book.updated_at, serde_json::to_string(book)?],
        )?;
        Ok(())
    }

    pub fn delete_book(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM books WHERE id = ?1", [id])?;
        conn.execute("DELETE FROM highlights WHERE book_id = ?1", [id])?;
        conn.execute("DELETE FROM bookmarks WHERE book_id = ?1", [id])?;
        Ok(())
    }

    pub fn list_excerpts(&self) -> AppResult<Vec<Excerpt>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT payload FROM excerpts ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    pub fn save_excerpt(&self, excerpt: &Excerpt) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO excerpts(id, book_id, created_at, payload) VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            params![excerpt.id, excerpt.book_id, excerpt.created_at, serde_json::to_string(excerpt)?],
        )?;
        Ok(())
    }

    pub fn delete_excerpt(&self, id: &str) -> AppResult<()> {
        self.conn.lock().execute("DELETE FROM excerpts WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn highlights_by_book(&self, book_id: &str) -> AppResult<Vec<Highlight>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT payload FROM highlights WHERE book_id = ?1")?;
        let rows = stmt.query_map([book_id], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    pub fn save_highlight(&self, highlight: &Highlight) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO highlights(id, book_id, payload) VALUES(?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            params![highlight.id, highlight.book_id, serde_json::to_string(highlight)?],
        )?;
        Ok(())
    }

    pub fn delete_highlight(&self, id: &str) -> AppResult<()> {
        self.conn.lock().execute("DELETE FROM highlights WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn bookmarks_by_book(&self, book_id: &str) -> AppResult<Vec<Bookmark>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT payload FROM bookmarks WHERE book_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([book_id], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    pub fn save_bookmark(&self, bookmark: &Bookmark) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO bookmarks(id, book_id, created_at, payload) VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            params![bookmark.id, bookmark.book_id, bookmark.created_at, serde_json::to_string(bookmark)?],
        )?;
        Ok(())
    }

    pub fn delete_bookmark(&self, id: &str) -> AppResult<()> {
        self.conn.lock().execute("DELETE FROM bookmarks WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn find_ai(
        &self,
        book_id: &str,
        chapter_index: i64,
        selected_text: &str,
    ) -> AppResult<Option<AIInterpretation>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT payload FROM ai_cache WHERE book_id = ?1 AND chapter_index = ?2",
        )?;
        let rows = stmt.query_map(params![book_id, chapter_index], |row| row.get::<_, String>(0))?;
        for row in rows {
            let item: AIInterpretation = serde_json::from_str(&row?)?;
            if item.selected_text.trim() == selected_text.trim() {
                return Ok(Some(item));
            }
        }
        Ok(None)
    }

    pub fn save_ai(&self, item: &AIInterpretation) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO ai_cache(id, book_id, chapter_index, payload) VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            params![item.id, item.book_id, item.chapter_index, serde_json::to_string(item)?],
        )?;
        Ok(())
    }

    pub fn reader_settings(&self) -> AppResult<ReaderSettings> {
        let conn = self.conn.lock();
        let payload: Option<String> = conn
            .query_row(
                "SELECT payload FROM settings WHERE key = 'reader_settings'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(payload
            .map(|p| serde_json::from_str(&p))
            .transpose()?
            .unwrap_or_default())
    }

    pub fn save_reader_settings(&self, settings: &ReaderSettings) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO settings(key, payload) VALUES('reader_settings', ?1)
             ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
            [serde_json::to_string(settings)?],
        )?;
        Ok(())
    }
}
