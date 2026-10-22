package com.liuli.reader;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "ReaderFiles")
public class ReaderFilesPlugin extends Plugin {
    @PluginMethod
    public void saveJson(PluginCall call) {
        String contents = call.getString("contents");
        String filename = call.getString("filename", "ReaderAI_Backup.json");
        if (contents == null || filename == null || !filename.endsWith(".json") || filename.contains("/") || filename.contains("\\")) {
            call.reject("备份文件参数无效");
            return;
        }
        File pending = null;
        try {
            pending = File.createTempFile("reader-backup-", ".json", getContext().getCacheDir());
            try (FileOutputStream output = new FileOutputStream(pending)) {
                output.write(contents.getBytes(StandardCharsets.UTF_8));
            }
            // Activity state carries only the cache filename, not the entire book library.
            call.getData().remove("contents");
            call.getData().put("pendingFile", pending.getName());
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE, filename);
            startActivityForResult(call, intent, "documentCreated");
        } catch (Exception error) {
            if (pending != null) pending.delete();
            call.reject("无法打开备份保存窗口", error);
        }
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String name = call.getString("pendingFile", "");
        if (!name.startsWith("reader-backup-") || name.contains("/") || name.contains("\\")) {
            call.reject("备份缓存无效");
            return;
        }
        File pending = new File(getContext().getCacheDir(), name);
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            pending.delete();
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        getBridge().execute(() -> {
            try (FileInputStream input = new FileInputStream(pending);
                 OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new java.io.IOException("无法打开目标文件");
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
                call.resolve(new JSObject().put("cancelled", false));
            } catch (Exception error) {
                call.reject("备份保存失败", error);
            } finally {
                pending.delete();
            }
        });
    }
}
