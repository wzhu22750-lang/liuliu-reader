use regex::Regex;

use crate::error::AppResult;
use crate::models::{Book, BookProgress, Chapter, FetchStatus};

pub fn parse_txt(raw: &str, file_name: &str) -> AppResult<Book> {
    let clean = file_name.rsplit_once('.').map(|(n, _)| n).unwrap_or(file_name).trim();
    let mut title = clean.to_string();
    let mut author = "佚名".to_string();
    if let Some(caps) = Regex::new(r"(?:《([^》]+)》|([^-—_]+))[\s\-_—]+(?:作者[:：])?([^-—_]+)")
        .unwrap()
        .captures(clean)
    {
        title = caps.get(1).or(caps.get(2)).map(|m| m.as_str().trim().to_string()).unwrap_or(title);
        author = caps.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or(author);
    }

    let chapter_re = Regex::new(
        r"^\s*(第[0-9一二三四五六七八九十百千万]+[章回节卷集幕部篇]|楔子|序[言章]|尾声|番外|后记|引子|前言).{0,35}$",
    )
    .unwrap();

    let mut chapters: Vec<Chapter> = Vec::new();
    let mut current_title = "序章 / 前言".to_string();
    let mut paragraphs: Vec<String> = Vec::new();
    let mut index = 0i64;

    let flush = |title: &str, paragraphs: &mut Vec<String>, index: &mut i64, chapters: &mut Vec<Chapter>| {
        if paragraphs.is_empty() {
            return;
        }
        let content = paragraphs.join("\n\n");
        let word_count = content.chars().filter(|c| !c.is_whitespace()).count() as i64;
        chapters.push(Chapter {
            id: format!("ch_{index}"),
            index: *index,
            title: title.to_string(),
            content,
            word_count,
            font_url: None,
        });
        *index += 1;
        paragraphs.clear();
    };

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.chars().count() <= 45 && chapter_re.is_match(line) {
            flush(&current_title, &mut paragraphs, &mut index, &mut chapters);
            current_title = line.to_string();
            continue;
        }
        paragraphs.push(line.to_string());
    }
    flush(&current_title, &mut paragraphs, &mut index, &mut chapters);

    if chapters.is_empty() {
        return Err("未能从 TXT 中识别出章节".into());
    }

    let now = now_ms();
    let total_words = chapters.iter().map(|c| c.word_count).sum();
    Ok(Book {
        id: format!("book_txt_{now}"),
        title,
        author,
        cover_url: None,
        cover_color: Some("from-[#fdfcfa] to-[#f5f1e8]".into()),
        font_url: None,
        source_type: "txt".into(),
        source_url: Some(file_name.to_string()),
        total_chapters: chapters.len() as i64,
        total_words: Some(total_words),
        progress: BookProgress {
            chapter_index: 0,
            chapter_title: chapters[0].title.clone(),
            percentage: 0,
            scroll_offset: Some(0),
            last_read_time: now,
        },
        chapters,
        created_at: now,
        updated_at: now,
        is_archived: Some(false),
        fetch_status: Some(FetchStatus {
            total: index,
            completed: index,
            is_fetching: false,
            status: Some("READY".into()),
            error: None,
        }),
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
