package com.liuli.reader.bridge;

import android.content.Context;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Reads only this application's managed TXT export directory. No arbitrary file access. */
public final class LiuliReaderBridge {
    private static final long MAX_BYTES = 64L * 1024 * 1024;
    private final File root;
    private final WebView webView;

    public LiuliReaderBridge(Context context, WebView webView) {
        this.webView = webView;
        File external = context.getExternalFilesDir(null);
        if (external == null) throw new IllegalStateException("应用存储目录不可用");
        root = new File(external, "Download/FanqieNovels/liuli-downloads");
    }

    public static void install(WebView view, Context context, boolean debug) {
        WebView.setWebContentsDebuggingEnabled(debug);
        view.getSettings().setDomStorageEnabled(true);
        view.addJavascriptInterface(new LiuliReaderBridge(context, view), "LiuliReaderFiles");
        // Reapply the build preference after the native host has initialized.
        final boolean debugging = debug;
        view.postDelayed(new Runnable() {
            @Override public void run() { WebView.setWebContentsDebuggingEnabled(debugging); }
        }, 3000);

    }

    @JavascriptInterface public String downloadDirectory() {
        try {
            if (!root.isDirectory() && !root.mkdirs()) throw new Exception("无法创建下载目录");
            return new JSONObject().put("path", root.getCanonicalPath()).toString();
        } catch (Exception error) {
            return failure(error);
        }
    }

    @JavascriptInterface public String createDownloadDirectory() {
        try {
            File directory = new File(root, java.util.UUID.randomUUID().toString());
            if (!directory.mkdirs()) throw new Exception("无法创建任务下载目录");
            return new JSONObject().put("path", directory.getCanonicalPath()).toString();
        } catch (Exception error) { return failure(error); }
    }

    @JavascriptInterface public String readText(String path) {
        try {
            File file = new File(path).getCanonicalFile();
            String prefix = root.getCanonicalPath() + File.separator;
            if (!file.getPath().startsWith(prefix) || !file.getName().endsWith(".txt")) {
                throw new Exception("只允许读取本应用下载目录中的 TXT 文件");
            }
            if (!file.isFile() || file.length() == 0 || file.length() > MAX_BYTES) {
                throw new Exception("下载文件不存在、为空或超过 64 MB");
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (FileInputStream input = new FileInputStream(file)) {
                byte[] buffer = new byte[16384];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if ((long) out.size() + count > MAX_BYTES) throw new Exception("文件超过 64 MB");
                    out.write(buffer, 0, count);
                }
            }
            String contents = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(out.toByteArray())).toString();
            return new JSONObject().put("text", contents).toString();
        } catch (Exception error) {
            return failure(error);
        }
    }

    /** Public metadata only; no arbitrary URLs, request headers, redirects or credentials. */
    @JavascriptInterface public void bookPageAsync(final String bookId, final String requestId) {
        if (requestId == null || !requestId.matches("[a-zA-Z0-9-]{1,80}")) return;
        new Thread(new Runnable() {
            @Override public void run() {
                final String result = fetchBookPage(bookId);
                webView.post(new Runnable() {
                    @Override public void run() {
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('liuli-book-page',{detail:{id:"
                            + JSONObject.quote(requestId) + ",result:" + result + "}}))", null);
                    }
                });
            }
        }, "liuli-book-metadata").start();
    }

    private String fetchBookPage(String bookId) {
        java.net.HttpURLConnection connection = null;
        try {
            if (bookId == null || !bookId.matches("[0-9]{1,30}")) throw new Exception("书籍 ID 无效");
            java.net.URL url = new java.net.URL("https://fanqienovel.com/page/" + bookId);
            connection = (java.net.HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept", "text/html");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0");
            if (connection.getResponseCode() != 200) throw new Exception("无法核验公开目录的章节状态");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (java.io.InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[16384]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (out.size() + count > 4000000) throw new Exception("目录响应过大");
                    out.write(buffer, 0, count);
                }
            }
            return new JSONObject().put("html", new String(out.toByteArray(), StandardCharsets.UTF_8)).toString();
        } catch (Exception error) { return failure(error); }
        finally { if (connection != null) connection.disconnect(); }
    }

    private static String failure(Exception error) {
        try { return new JSONObject().put("error", error.getMessage() == null ? "文件读取失败" : error.getMessage()).toString(); }
        catch (Exception ignored) { return "{\"error\":\"文件读取失败\"}"; }
    }
}
