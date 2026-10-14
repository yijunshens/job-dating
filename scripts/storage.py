"""Private, transactional application records, independent of recruitment data."""
import json
from pathlib import Path
import re
import sqlite3
from datetime import date
from catalog import utc_now

STATUSES = {"todo", "filling", "applied", "test", "interview", "offer", "closed"}


class ConflictError(ValueError):
    pass


class ProgressStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS progress (id TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL)")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA journal_mode=PERSIST")
        db.execute("PRAGMA synchronous=FULL")
        return db

    def read_all(self):
        with self.connect() as db:
            return {rid: json.loads(value) for rid, value in db.execute("SELECT id,value FROM progress")}

    @staticmethod
    def validate(rid, value):
        if not isinstance(rid, str) or not re.fullmatch(r"[A-Za-z0-9_:-]{1,160}", rid):
            raise ValueError("Invalid record ID")
        if not isinstance(value, dict):
            raise ValueError("Invalid progress")
        status = value.get("status", "todo")
        notes = value.get("notes", "")
        favorite = value.get("favorite", False)
        applied_on = value.get("appliedOn", "")
        if status not in STATUSES or not isinstance(notes, str) or len(notes) > 10000 or type(favorite) is not bool:
            raise ValueError("Invalid progress fields")
        if not isinstance(applied_on, str) or (applied_on and (not re.fullmatch(r"\d{4}-\d{2}-\d{2}", applied_on) or date.fromisoformat(applied_on).isoformat() != applied_on)):
            raise ValueError("Invalid application date")
        return {"status": status, "notes": notes, "favorite": favorite, "appliedOn": applied_on}

    def save(self, rid, value, expected_revision):
        clean = self.validate(rid, value)
        if type(expected_revision) is not int or expected_revision < 0:
            raise ValueError("Expected revision required")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT revision FROM progress WHERE id=?", (rid,)).fetchone()
            revision = old[0] if old else 0
            if revision != expected_revision:
                raise ConflictError("记录已在另一窗口修改，请重新载入后再保存。")
            saved = {**clean, "revision": revision + 1, "updatedAt": utc_now()}
            db.execute("INSERT INTO progress(id,value,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision",
                       (rid, json.dumps(saved, ensure_ascii=False), revision + 1))
        return saved

    def restore_missing(self, backup):
        if not isinstance(backup, dict) or backup.get("format") != "job-dating-progress-v1" or not isinstance(backup.get("records"), dict):
            raise ValueError("请选择 Job Dating 投递记录备份。")
        rows = backup["records"]
        if len(rows) > 30000:
            raise ValueError("Backup too large")
        clean = {rid: self.validate(rid, value) for rid, value in rows.items()}
        restored = skipped = 0
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for rid, value in clean.items():
                if db.execute("SELECT 1 FROM progress WHERE id=?", (rid,)).fetchone():
                    skipped += 1
                    continue
                saved = {**value, "revision": 1, "updatedAt": utc_now()}
                db.execute("INSERT INTO progress VALUES(?,?,?)", (rid, json.dumps(saved, ensure_ascii=False), 1))
                restored += 1
        return {"restored": restored, "skipped": skipped}
