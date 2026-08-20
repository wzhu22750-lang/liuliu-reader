#!/usr/bin/env python3
"""Auto-sync script: watches the repo for changes and pushes to GitHub."""
import os
import subprocess
import sys
import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

REPO_DIR = os.path.dirname(os.path.abspath(__file__))
GIT = "/usr/bin/git"
DEBOUNCE_SECONDS = 3

def run(cmd, cwd=REPO_DIR):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)

class Handler(FileSystemEventHandler):
    def __init__(self):
        super().__init__()
        self._timer = None

    def _schedule_sync(self):
        if self._timer:
            self._timer.cancel()
        self._timer = threading.Timer(DEBOUNCE_SECONDS, self._do_sync)
        self._timer.daemon = True
        self._timer.start()

    def _do_sync(self):
        # Check if there are changes
        r = run([GIT, "status", "--porcelain"])
        if not r.stdout.strip():
            return  # No changes
        run([GIT, "add", "-A"])
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        run([GIT, "commit", "-m", f"auto: sync {ts}"])
        r = run([GIT, "push", "origin", "HEAD"])
        if r.returncode == 0:
            print(f"[{ts}] Pushed to GitHub ✓")
        else:
            print(f"[{ts}] Push failed: {r.stderr.strip()}")

    def on_modified(self, event):
        if ".git" in event.src_path or "auto_sync.py" in event.src_path:
            return
        self._schedule_sync()

    def on_created(self, event):
        if ".git" in event.src_path or "auto_sync.py" in event.src_path:
            return
        self._schedule_sync()

import threading

if __name__ == "__main__":
    observer = Observer()
    observer.schedule(Handler(), REPO_DIR, recursive=True)
    observer.start()
    print(f"Auto-sync watching: {REPO_DIR}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()