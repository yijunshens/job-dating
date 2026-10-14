"""Daily public-data sync. Private progress is never touched."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
import uuid
from catalog import fetch_snapshot, merge_catalog, utc_now, TZ, load_source, sanitize_catalog
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, separators=(",", ":"))
        file.flush()
        os.fsync(file.fileno())


@contextmanager
def sync_lock(root):
    path = root / "private" / "sync.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as file:
        if file.tell() == 0:
            file.write(b"0")
            file.flush()
        file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise RuntimeError("Another synchronization is running") from None
        try:
            yield
        finally:
            file.seek(0)
            if os.name == "nt":
                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(file, fcntl.LOCK_UN)


def load_catalog(root=ROOT):
    path = root / "data" / "catalog.json"
    candidates = [path, *sorted((root / "private" / "catalog-history").glob("*.json"), reverse=True)]
    for candidate in candidates:
        if not candidate.exists():
            continue
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
            if data.get("records") and data.get("metadata", {}).get("captured_at"):
                return data
        except (ValueError, OSError):
            continue
    raise ValueError("No valid catalog; run sync.py --seed before starting")


def save_catalog(catalog, root=ROOT):
    # Retain a complete durable journal entry before replacing the latest file's contents.
    # Recovery never deletes either old data or an interrupted latest file.
    stamp = catalog["metadata"]["captured_at"].replace(":", "-")
    history = root / "private" / "catalog-history" / f"{stamp}-{uuid.uuid4().hex[:8]}.json"
    write_json(history, catalog)
    write_json(root / "data" / "catalog.json", catalog)


def sync_once(root=ROOT, fetcher=None):
    with sync_lock(root):
        previous = load_catalog(root)
        write_json(root / "data" / "sync-status.json", {"state": "syncing", "started_at": utc_now()})
        try:
            incoming = fetcher() if fetcher is not None else fetch_snapshot(root)
            catalog = merge_catalog(previous, incoming)
            if fetcher is None:
                catalog = sanitize_catalog(catalog, load_source(root))
            save_catalog(catalog, root)
            result = {"state": "ready", "last_success_at": catalog["metadata"]["captured_at"],
                      "new_count": catalog["metadata"]["new_count"], "active_count": catalog["metadata"]["active_count"]}
            write_json(root / "data" / "sync-status.json", result)
            return result
        except Exception:
            write_json(root / "data" / "sync-status.json", {"state": "error", "attempted_at": utc_now(),
                "last_success_at": previous["metadata"]["captured_at"],
                "message": "同步未完成，已保留上次数据。请检查网络及来源访问状态。"})
            raise RuntimeError('Source sync failed; previous catalog retained. Check private configuration, source availability and network.') from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=Path)
    parser.add_argument("--if-due", action="store_true")
    args = parser.parse_args()
    if args.seed:
        if (ROOT / "data" / "catalog.json").exists():
            raise SystemExit("Catalog already exists; refusing to reset first-seen history")
        raw = json.loads(args.seed.read_text(encoding="utf-8"))
        catalog = sanitize_catalog(merge_catalog(None, raw, baseline=True), load_source(ROOT))
        save_catalog(catalog)
        print(json.dumps({"seeded": catalog["metadata"]["active_count"]}))
    else:
        if args.if_due:
            last = datetime.fromisoformat(load_catalog()["metadata"]["captured_at"].replace("Z", "+00:00")).astimezone(TZ).date()
            if last >= datetime.now(TZ).date():
                print("Already synchronized today")
                return
        print(json.dumps(sync_once(), ensure_ascii=False))


if __name__ == "__main__":
    main()
