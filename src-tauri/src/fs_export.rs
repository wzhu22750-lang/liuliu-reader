use std::path::PathBuf;

use crate::error::AppResult;
use crate::models::Book;

pub fn write_txt(book: &Book, dest: PathBuf) -> AppResult<PathBuf> {
    if book.fetch_status.as_ref().and_then(|s| s.status.as_deref()) != Some("READY")
        && book.source_type == "tomato"
    {
        return Err("这本网络小说尚未完整导入，不能导出".into());
    }
    let mut body = format!(
        "书名：{}\n作者：{}\n来源：溜溜读书\n\n{}\n\n",
        book.title,
        book.author,
        "=".repeat(36)
    );
    for chapter in &book.chapters {
        if chapter.content.trim().is_empty() {
            return Err(format!("《{}》正文为空，已阻止导出", chapter.title).into());
        }
        body.push_str(&chapter.title);
        body.push_str("\n\n");
        body.push_str(&chapter.content);
        body.push_str("\n\n");
        body.push_str(&"-".repeat(24));
        body.push_str("\n\n");
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&dest, body.as_bytes())?;
    Ok(dest)
}

pub fn default_export_path(dir: PathBuf, book: &Book) -> PathBuf {
    let name = format!("{} - {}.txt", sanitize(&book.title), sanitize(&book.author));
    dir.join(name)
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect()
}
