//! Fanqie 书源。
//!
//! 实现公开网页目录 / 搜索 / 免费章正文，以及可配置的明文 Provider。
//! 官方 App 的设备注册、Ladon/Argus 签名和 AES 正文解密不在本模块落地：
//! 那是受保护的客户端协议，应由用户自有授权服务或独立 native crate 注入。

use regex::Regex;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::SearchHit;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Debug, Clone)]
pub struct ChapterMeta {
    pub item_id: String,
    pub title: String,
    pub index: i64,
}

#[derive(Debug, Clone)]
pub struct BookInfo {
    pub book_id: String,
    pub title: String,
    pub author: String,
    pub cover_url: Option<String>,
    pub description: Option<String>,
    pub chapters: Vec<ChapterMeta>,
}

#[derive(Debug, Clone)]
pub struct ChapterSnapshot {
    #[allow(dead_code)]
    pub item_id: String,
    pub title: String,
    pub content: String,
    pub expected_word_count: Option<i64>,
    pub is_chapter_lock: bool,
    pub font_url: Option<String>,
    #[allow(dead_code)]
    pub provider: String,
}

pub struct FanqieClient {
    http: reqwest::Client,
    plaintext_endpoints: Vec<String>,
}

impl FanqieClient {
    pub fn new() -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .redirect(reqwest::redirect::Policy::limited(8))
            .timeout(std::time::Duration::from_secs(12))
            .build()?;
        let plaintext_endpoints = std::env::var("FANQIE_CONTENT_API_ENDPOINTS")
            .unwrap_or_default()
            .split([',', '\n'])
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        Ok(Self {
            http,
            plaintext_endpoints,
        })
    }

    pub async fn resolve_book_id(&self, input: &str) -> AppResult<String> {
        let trimmed = input.trim();
        if let Some(id) = capture_id(r"[?&]book_id=(\d{10,25})", trimmed) {
            return Ok(id);
        }
        if let Some(id) = capture_id(r"/page/(\d{10,25})", trimmed) {
            return Ok(id);
        }
        if Regex::new(r"^\d{10,25}$").unwrap().is_match(trimmed) {
            return Ok(trimmed.to_string());
        }
        if let Some(url) = capture_url(trimmed) {
            if url.contains("changdunovel.com") || url.contains("zlink.fqnovel.com") || url.contains("/t/") {
                let response = self
                    .http
                    .get(&url)
                    .header("Accept", "text/html")
                    .send()
                    .await?;
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let body = response.text().await.unwrap_or_default();
                let hay = format!("{} {}", location.unwrap_or_default(), body);
                if let Some(id) = capture_id(r"[?&]book_id=(\d{10,25})", &hay)
                    .or_else(|| capture_id(r"/page/(\d{10,25})", &hay))
                {
                    return Ok(id);
                }
            }
        }
        Err("未能解析出书籍 ID。请使用番茄/长读链接、数字 ID，或先搜索书名再选择结果。".into())
    }

    pub async fn search(&self, query: &str) -> AppResult<Vec<SearchHit>> {
        let keyword = query.trim();
        if keyword.is_empty() {
            return Err("请输入书名".into());
        }
        if Regex::new(r"^\d{10,25}$").unwrap().is_match(keyword) {
            let info = self.book_info(keyword).await?;
            return Ok(vec![SearchHit {
                book_id: info.book_id,
                title: info.title,
                author: info.author,
                cover_url: info.cover_url,
                description: info.description,
            }]);
        }

        let url = format!(
            "https://fanqienovel.com/search?keyword={}",
            urlencoding_lite(keyword)
        );
        let html = self.fetch_text(&url).await?;
        let mut hits = parse_search_hits(&html);
        if hits.is_empty() {
            if let Ok(state) = extract_initial_state(&html) {
                hits = search_hits_from_state(&state);
            }
        }
        if hits.is_empty() {
            return Err("没有搜到匹配书籍。网页搜索可能被风控，请改用分享链接或书籍 ID。".into());
        }
        hits.truncate(20);
        Ok(hits)
    }

    pub async fn book_info(&self, book_id: &str) -> AppResult<BookInfo> {
        let page = format!("https://fanqienovel.com/page/{book_id}");
        let html = self.fetch_text(&page).await?;
        let state = extract_initial_state(&html)?;
        let page_data = state.get("page").cloned().unwrap_or(Value::Null);
        let title = first_string(&page_data, &["bookName", "book_name"])
            .unwrap_or_else(|| format!("番茄小说_{book_id}"));
        let author = first_string(&page_data, &["authorName", "author"]).unwrap_or_else(|| "网络作者".into());
        let cover_url = first_string(&page_data, &["thumbUrl", "thumbUri"]);
        let description = first_string(&page_data, &["abstract", "description"]);
        let mut chapters = Vec::new();
        if let Some(volumes) = page_data.get("chapterListWithVolume").and_then(|v| v.as_array()) {
            for volume in volumes {
                if let Some(list) = volume.as_array() {
                    for chapter in list {
                        push_chapter(&mut chapters, chapter);
                    }
                }
            }
        }
        if chapters.is_empty() {
            if let Some(list) = page_data.get("chapterList").and_then(|v| v.as_array()) {
                for chapter in list {
                    push_chapter(&mut chapters, chapter);
                }
            }
        }
        if chapters.is_empty() {
            return Err("官方网页目录没有章节".into());
        }
        Ok(BookInfo {
            book_id: book_id.to_string(),
            title,
            author,
            cover_url,
            description,
            chapters,
        })
    }

    pub async fn chapter(&self, book_id: &str, item_id: &str, index: i64) -> AppResult<ChapterSnapshot> {
        let web = self.fetch_web_chapter(item_id).await?;
        if chapter_complete(&web) {
            return Ok(web);
        }
        if let Some(provider) = self.fetch_plaintext_provider(book_id, item_id, index).await? {
            let mut merged = provider;
            if merged.title.is_empty() {
                merged.title = web.title;
            }
            if !chapter_complete(&merged) {
                return Err(format!(
                    "第 {} 章《{}》仍不是完整正文（网页锁定预览，明文 Provider 也未通过完整性检查）",
                    index + 1,
                    merged.title
                )
                .into());
            }
            return Ok(merged);
        }
        Err(format!(
            "第 {} 章《{}》仅返回预览。完整正文需要配置 FANQIE_CONTENT_API_ENDPOINTS 明文 Provider，官方签名解密不在本仓库实现。",
            index + 1,
            web.title
        )
        .into())
    }

    async fn fetch_web_chapter(&self, item_id: &str) -> AppResult<ChapterSnapshot> {
        let url = format!("https://fanqienovel.com/reader/{item_id}");
        let html = self.fetch_text(&url).await?;
        let state = extract_initial_state(&html)?;
        let chapter = state
            .pointer("/reader/chapterData")
            .cloned()
            .unwrap_or(Value::Null);
        if chapter.is_null() {
            return Err("网页没有返回 chapterData".into());
        }
        let font_url = Regex::new(r"src:url\((https://[^)]+\.woff2)\)")
            .unwrap()
            .captures(&html)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
        Ok(ChapterSnapshot {
            item_id: item_id.to_string(),
            title: first_string(&chapter, &["title"]).unwrap_or_else(|| "正文章节".into()),
            content: normalize_novel_content(first_string(&chapter, &["content"]).as_deref().unwrap_or("")),
            expected_word_count: first_i64(&chapter, &["chapterWordNumber", "chapter_word_number"]),
            is_chapter_lock: chapter
                .get("isChapterLock")
                .or(chapter.get("is_chapter_lock"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            font_url,
            provider: "fanqie-web".into(),
        })
    }

    async fn fetch_plaintext_provider(
        &self,
        book_id: &str,
        item_id: &str,
        index: i64,
    ) -> AppResult<Option<ChapterSnapshot>> {
        let token = std::env::var("FANQIE_CONTENT_API_TOKEN").unwrap_or_default();
        for endpoint in &self.plaintext_endpoints {
            if endpoint.starts_with("tnd-sidecar://") {
                continue;
            }
            let url = build_provider_url(endpoint, book_id, item_id, index);
            let mut req = self.http.get(&url).header("Accept", "application/json");
            if !token.is_empty() {
                req = req.header("token", &token).bearer_auth(&token);
            }
            let response = match req.send().await {
                Ok(r) => r,
                Err(_) => continue,
            };
            if !response.status().is_success() {
                continue;
            }
            let payload: Value = match response.json().await {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(parsed) = parse_provider_payload(&payload, item_id) {
                return Ok(Some(parsed));
            }
        }
        Ok(None)
    }

    async fn fetch_text(&self, url: &str) -> AppResult<String> {
        let response = self
            .http
            .get(url)
            .header("Accept", "text/html,application/xhtml+xml,application/json")
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(format!("请求失败 HTTP {}", response.status()).into());
        }
        Ok(response.text().await?)
    }
}

pub fn chapter_complete(snapshot: &ChapterSnapshot) -> bool {
    let actual = snapshot.content.chars().count() as i64;
    if snapshot.content.trim().is_empty() {
        return false;
    }
    if snapshot.is_chapter_lock {
        return false;
    }
    if let Some(expected) = snapshot.expected_word_count {
        if expected > 0 && actual < ((expected as f64) * 0.85) as i64 {
            return false;
        }
    }
    true
}

pub fn normalize_novel_content(value: &str) -> String {
    let mut text = Regex::new(r"(?i)<p\b[^>]*>")
        .unwrap()
        .replace_all(value, "")
        .into_owned();
    text = Regex::new(r"(?i)</p\s*>").unwrap().replace_all(&text, "\n\n").into_owned();
    text = Regex::new(r"(?i)<br\s*/?\s*>").unwrap().replace_all(&text, "\n").into_owned();
    text = html_escape::decode_html_entities(&text).into_owned();
    text = Regex::new(r"<[^>]+>").unwrap().replace_all(&text, "").into_owned();
    text = text.replace('\r', "");
    text = Regex::new(r"\n{3,}").unwrap().replace_all(&text, "\n\n").into_owned();
    text.trim().to_string()
}

fn parse_provider_payload(payload: &Value, item_id: &str) -> Option<ChapterSnapshot> {
    let root = payload.get("data").unwrap_or(payload);
    let mut candidates = Vec::new();
    if let Some(item) = root.get(item_id) {
        candidates.push(item);
    }
    candidates.push(root);
    for key in ["items", "item_list", "chapters", "results"] {
        if let Some(arr) = root.get(key).and_then(|v| v.as_array()) {
            candidates.extend(arr.iter());
        }
    }
    let many = candidates.len() > 1;
    for candidate in candidates {
        let id = first_string(candidate, &["item_id", "itemId", "id"]).unwrap_or_else(|| item_id.to_string());
        if id != item_id && many {
            continue;
        }
        let content = first_string(candidate, &["content", "origin_content", "text"]).unwrap_or_default();
        let content = normalize_novel_content(&content);
        if content.is_empty() || content == "Invalid" {
            continue;
        }
        return Some(ChapterSnapshot {
            item_id: item_id.to_string(),
            title: first_string(candidate, &["title", "chapter_title"]).unwrap_or_default(),
            content,
            expected_word_count: first_i64(candidate, &["chapterWordNumber", "word_count"]),
            is_chapter_lock: false,
            font_url: None,
            provider: "plaintext-provider".into(),
        });
    }
    None
}

fn build_provider_url(endpoint: &str, book_id: &str, item_id: &str, index: i64) -> String {
    if endpoint.contains('{') {
        return endpoint
            .replace("{item_id}", item_id)
            .replace("{item_ids}", item_id)
            .replace("{book_id}", book_id)
            .replace("{chapter_index}", &index.to_string());
    }
    let mut url = reqwest::Url::parse(endpoint).unwrap_or_else(|_| reqwest::Url::parse("https://invalid.local").unwrap());
    if url.path().contains("batch_full") || url.path().contains("batch_chapter") {
        url.query_pairs_mut().append_pair("item_ids", item_id);
    } else {
        url.query_pairs_mut().append_pair("item_id", item_id);
    }
    url.query_pairs_mut()
        .append_pair("book_id", book_id)
        .append_pair("chapter_index", &index.to_string());
    url.to_string()
}

fn extract_initial_state(html: &str) -> AppResult<Value> {
    let marker = "window.__INITIAL_STATE__=";
    let start = html
        .find(marker)
        .ok_or_else(|| AppError::from("页面缺少 INITIAL_STATE"))?
        + marker.len();
    let source = html[start..].trim_start();
    if !source.starts_with('{') {
        return Err("INITIAL_STATE 不是 JSON 对象".into());
    }
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (index, ch) in source.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let json = &source[..=index];
                    return Ok(serde_json::from_str(json)?);
                }
            }
            _ => {}
        }
    }
    Err("INITIAL_STATE JSON 不完整".into())
}

fn parse_search_hits(html: &str) -> Vec<SearchHit> {
    let re = Regex::new(r#"/page/(\d{10,25})"#).unwrap();
    let mut hits = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for cap in re.captures_iter(html) {
        let book_id = cap[1].to_string();
        if !seen.insert(book_id.clone()) {
            continue;
        }
        hits.push(SearchHit {
            book_id,
            title: "番茄书籍".into(),
            author: "未知作者".into(),
            cover_url: None,
            description: None,
        });
    }
    hits
}

fn search_hits_from_state(state: &Value) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    let mut stack = vec![state];
    while let Some(value) = stack.pop() {
        match value {
            Value::Array(arr) => stack.extend(arr.iter()),
            Value::Object(map) => {
                let book_id = map
                    .get("book_id")
                    .or(map.get("bookId"))
                    .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string())));
                if let Some(book_id) = book_id {
                    if Regex::new(r"^\d{10,25}$").unwrap().is_match(&book_id) {
                        hits.push(SearchHit {
                            book_id,
                            title: first_string(value, &["book_name", "bookName", "title"]).unwrap_or_else(|| "未命名".into()),
                            author: first_string(value, &["author", "authorName"]).unwrap_or_else(|| "未知作者".into()),
                            cover_url: first_string(value, &["thumb_url", "thumbUrl", "cover"]),
                            description: first_string(value, &["abstract", "description"]),
                        });
                    }
                }
                stack.extend(map.values());
            }
            _ => {}
        }
    }
    hits
}

fn push_chapter(chapters: &mut Vec<ChapterMeta>, chapter: &Value) {
    let item_id = first_string(chapter, &["itemId", "item_id"]).unwrap_or_default();
    if !Regex::new(r"^\d{10,25}$").unwrap().is_match(&item_id) {
        return;
    }
    let index = chapters.len() as i64;
    chapters.push(ChapterMeta {
        item_id,
        title: first_string(chapter, &["title"]).unwrap_or_else(|| format!("第{}章", index + 1)),
        index,
    });
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = value.get(*key) {
            if let Some(s) = v.as_str() {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
            if let Some(n) = v.as_i64() {
                return Some(n.to_string());
            }
        }
    }
    None
}

fn first_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    for key in keys {
        if let Some(v) = value.get(*key) {
            if let Some(n) = v.as_i64() {
                return Some(n);
            }
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.parse() {
                    return Some(n);
                }
            }
        }
    }
    None
}

fn capture_id(pattern: &str, hay: &str) -> Option<String> {
    Regex::new(pattern)
        .ok()?
        .captures(hay)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn capture_url(input: &str) -> Option<String> {
    Regex::new(r"https?://[^\s\u{4e00}-\u{9fff}]+")
        .ok()?
        .find(input)
        .map(|m| {
            m.as_str()
                .trim_end_matches(|c: char| matches!(c, '。' | '，' | '！' | '？' | '、' | ')' | '(' | '>' | '<' | ';' | ','))
                .to_string()
        })
}

fn urlencoding_lite(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}
