use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::db::Store;
use crate::error::AppResult;
use crate::models::{Book, BookProgress, Chapter, FetchStatus, ImportProgress};
use crate::source::fanqie::{
    normalize_novel_content, BookInfo, ChapterMeta, ChapterSnapshot, FanqieClient,
};
use crate::source::official::OfficialApi;

pub async fn import_fanqie_book(
    app: AppHandle,
    store: Arc<Store>,
    client: Arc<FanqieClient>,
    official: Arc<Mutex<OfficialApi>>,
    input: String,
) -> AppResult<Book> {
    let task_id = Uuid::new_v4().to_string();
    emit(
        &app,
        ImportProgress {
            task_id: task_id.clone(),
            book_id: String::new(),
            title: input.clone(),
            status: "DOWNLOADING".into(),
            total_chapters: 0,
            completed_chapters: 0,
            current_chapter_title: String::new(),
            status_text: "正在解析书籍…".into(),
            is_complete: false,
            error: None,
        },
    );

    let book_id = match client.resolve_book_id(&input).await {
        Ok(id) => id,
        Err(_) => client
            .search(&input)
            .await?
            .into_iter()
            .next()
            .map(|hit| hit.book_id)
            .ok_or_else(|| crate::error::AppError::from("搜索没有返回书籍"))?,
    };

    emit(
        &app,
        ImportProgress {
            task_id: task_id.clone(),
            book_id: book_id.clone(),
            title: input.clone(),
            status: "DOWNLOADING".into(),
            total_chapters: 0,
            completed_chapters: 0,
            current_chapter_title: String::new(),
            status_text: "正在获取章节目录…".into(),
            is_complete: false,
            error: None,
        },
    );

    let info = match client.book_info(&book_id).await {
        Ok(info) => info,
        Err(web_error) => {
            let mut api = official.lock().await;
            match api.directory(&book_id).await {
                Ok(book) => official_book_info(book),
                Err(official_error) => {
                    return Err(format!(
                        "网页目录和官方目录均获取失败：网页={}；官方={}",
                        web_error, official_error
                    )
                    .into());
                }
            }
        }
    };

    let total = info.chapters.len() as i64;
    if total == 0 {
        return Err("章节目录为空，已停止导入".into());
    }

    let mut chapters: Vec<Chapter> = Vec::with_capacity(info.chapters.len());
    let mut font_url = None;

    for meta in &info.chapters {
        emit(
            &app,
            ImportProgress {
                task_id: task_id.clone(),
                book_id: book_id.clone(),
                title: info.title.clone(),
                status: "DOWNLOADING".into(),
                total_chapters: total,
                completed_chapters: chapters.len() as i64,
                current_chapter_title: meta.title.clone(),
                status_text: format!("正在获取正文：{} / {total} 章", chapters.len() + 1),
                is_complete: false,
                error: None,
            },
        );

        let snapshot = match client.chapter(&book_id, &meta.item_id, meta.index).await {
            Ok(snapshot) => snapshot,
            Err(web_error) => {
                let mut api = official.lock().await;
                match api.chapter(&book_id, &meta.item_id).await {
                    Ok(chapter) => official_chapter_snapshot(meta, chapter),
                    Err(official_error) => {
                        let err: crate::error::AppError = format!(
                            "第 {} 章获取失败：网页={}；官方={}",
                            meta.index + 1,
                            web_error,
                            official_error
                        )
                        .into();
                        emit(
                            &app,
                            ImportProgress {
                                task_id: task_id.clone(),
                                book_id: book_id.clone(),
                                title: info.title.clone(),
                                status: "FAILED".into(),
                                total_chapters: total,
                                completed_chapters: chapters.len() as i64,
                                current_chapter_title: meta.title.clone(),
                                status_text: "导入失败，未写入书架".into(),
                                is_complete: false,
                                error: Some(err.to_string()),
                            },
                        );
                        return Err(err);
                    }
                }
            }
        };

        if snapshot.content.trim().is_empty() {
            return Err(format!("第 {} 章正文为空，已停止导入", meta.index + 1).into());
        }
        if font_url.is_none() {
            font_url = snapshot.font_url.clone();
        }
        let word_count = snapshot
            .content
            .chars()
            .filter(|c| !c.is_whitespace())
            .count() as i64;
        chapters.push(Chapter {
            id: format!("{}_{}", book_id, meta.item_id),
            index: meta.index,
            title: if snapshot.title.is_empty() {
                meta.title.clone()
            } else {
                snapshot.title
            },
            content: snapshot.content,
            word_count,
            font_url: snapshot.font_url,
        });
        tokio::time::sleep(std::time::Duration::from_millis(280)).await;
    }

    let now = now_ms();
    let total_words = chapters.iter().map(|c| c.word_count).sum();
    let book = Book {
        id: format!("book_tomato_{now}"),
        title: info.title.clone(),
        author: info.author,
        cover_url: info.cover_url,
        cover_color: Some("from-[#fdfcfa] to-[#f5f1e8]".into()),
        font_url,
        source_type: "tomato".into(),
        source_url: Some(input),
        total_chapters: total,
        total_words: Some(total_words),
        progress: BookProgress {
            chapter_index: 0,
            chapter_title: chapters
                .first()
                .map(|c| c.title.clone())
                .unwrap_or_else(|| "第一章".into()),
            percentage: 0,
            scroll_offset: Some(0),
            last_read_time: now,
        },
        chapters,
        created_at: now,
        updated_at: now,
        is_archived: Some(false),
        fetch_status: Some(FetchStatus {
            total,
            completed: total,
            is_fetching: false,
            status: Some("READY".into()),
            error: None,
        }),
    };
    store.save_book(&book)?;
    emit(
        &app,
        ImportProgress {
            task_id,
            book_id: book.id.clone(),
            title: book.title.clone(),
            status: "COMPLETED".into(),
            total_chapters: total,
            completed_chapters: total,
            current_chapter_title: book.progress.chapter_title.clone(),
            status_text: format!("《{}》导入完成，已加入书架", book.title),
            is_complete: true,
            error: None,
        },
    );
    Ok(book)
}

fn official_book_info(book: crate::source::official::OfficialBook) -> BookInfo {
    let chapters = book
        .chapters
        .into_iter()
        .enumerate()
        .map(|(index, (item_id, title))| ChapterMeta {
            item_id,
            title,
            index: index as i64,
        })
        .collect();
    BookInfo {
        book_id: book.book_id,
        title: book.title,
        author: book.author,
        cover_url: book.cover_url,
        description: book.description,
        chapters,
    }
}

fn official_chapter_snapshot(
    meta: &ChapterMeta,
    chapter: crate::source::official::OfficialChapter,
) -> ChapterSnapshot {
    ChapterSnapshot {
        item_id: meta.item_id.clone(),
        title: if chapter.title.is_empty() {
            meta.title.clone()
        } else {
            chapter.title
        },
        content: normalize_novel_content(&chapter.content),
        expected_word_count: None,
        is_chapter_lock: false,
        font_url: None,
        provider: "official-api".into(),
    }
}

fn emit(app: &AppHandle, progress: ImportProgress) {
    let _ = app.emit("import-progress", progress);
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_directory_is_converted_to_fanqie_metadata() {
        let info = official_book_info(crate::source::official::OfficialBook {
            book_id: "123456789012345".into(),
            title: "测试书".into(),
            author: "测试作者".into(),
            cover_url: None,
            description: None,
            chapters: vec![
                ("101".into(), "第一章".into()),
                ("102".into(), "第二章".into()),
            ],
        });

        assert_eq!(info.book_id, "123456789012345");
        assert_eq!(info.chapters.len(), 2);
        assert_eq!(info.chapters[0].index, 0);
        assert_eq!(info.chapters[1].item_id, "102");
    }

    #[test]
    fn official_html_is_normalized_before_import() {
        let snapshot = official_chapter_snapshot(
            &ChapterMeta {
                item_id: "101".into(),
                title: "目录标题".into(),
                index: 0,
            },
            crate::source::official::OfficialChapter {
                title: "正文标题".into(),
                content: "<p>第一段</p><p>第二段</p>".into(),
            },
        );

        assert_eq!(snapshot.provider, "official-api");
        assert_eq!(snapshot.title, "正文标题");
        assert_eq!(snapshot.content, "第一段\n\n第二段");
    }
}
