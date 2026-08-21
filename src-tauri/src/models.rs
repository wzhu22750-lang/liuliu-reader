use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub index: i64,
    pub title: String,
    pub content: String,
    pub word_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookProgress {
    pub chapter_index: i64,
    pub chapter_title: String,
    pub percentage: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_offset: Option<i64>,
    pub last_read_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchStatus {
    pub total: i64,
    pub completed: i64,
    pub is_fetching: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_url: Option<String>,
    pub source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    pub total_chapters: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_words: Option<i64>,
    pub chapters: Vec<Chapter>,
    pub progress: BookProgress,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_archived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetch_status: Option<FetchStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Excerpt {
    pub id: String,
    pub book_id: String,
    pub book_title: String,
    pub chapter_title: String,
    pub chapter_index: i64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thought: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_offset: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: String,
    pub book_id: String,
    pub chapter_index: i64,
    pub chapter_title: String,
    pub text: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub style: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub book_id: String,
    pub chapter_index: i64,
    pub chapter_title: String,
    pub snippet: String,
    pub percentage: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_offset: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIInterpretation {
    pub id: String,
    pub book_id: String,
    pub chapter_index: i64,
    pub selected_text: String,
    pub explanation: String,
    pub spoiler_scope: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSettings {
    pub font_size: i64,
    pub line_height: f64,
    pub theme: String,
    pub render_mode: String,
    pub spoiler_scope: String,
    pub last_highlight_style: String,
    pub auto_snap_sentence: bool,
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            font_size: 18,
            line_height: 1.8,
            theme: "light".into(),
            render_mode: "scroll".into(),
            spoiler_scope: "current".into(),
            last_highlight_style: "amber".into(),
            auto_snap_sentence: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub book_id: String,
    pub title: String,
    pub author: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub task_id: String,
    pub book_id: String,
    pub title: String,
    pub status: String,
    pub total_chapters: i64,
    pub completed_chapters: i64,
    pub current_chapter_title: String,
    pub status_text: String,
    pub is_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
