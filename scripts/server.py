"""Loopback-only service for the personal tracker."""
import argparse
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import mimetypes
from pathlib import Path
import secrets
import threading
from urllib.parse import unquote, urlsplit
from catalog import TZ, utc_now
from storage import ProgressStore, ConflictError
from sync import ROOT, load_catalog, sync_once


def make_server(root=ROOT, port=4188, auto_sync=True):
    root = Path(root)
    store = ProgressStore(root / "private" / "progress.sqlite3")
    state = {"catalog": load_catalog(root), "syncing": False}
    guard = threading.Lock()
    csrf = secrets.token_urlsafe(32)

    def reload_catalog():
        catalog = load_catalog(root)
        with guard:
            state["catalog"] = catalog
        return catalog

    def start_sync():
        with guard:
            if state["syncing"]:
                return False
            state["syncing"] = True
        def work():
            try:
                sync_once(root)
                reload_catalog()
                print("Daily catalog sync completed", flush=True)
            except Exception as error:
                print(f"Sync incomplete; previous data kept: {error}", flush=True)
            finally:
                with guard:
                    state["syncing"] = False
        threading.Thread(target=work, daemon=True).start()
        return True

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            if args and str(args[0]).startswith("GET /api/"):
                return
            super().log_message(fmt, *args)

        def allowed(self, mutation=False):
            hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if self.headers.get("Host") not in hosts:
                self.send_error(403, "Only configured loopback hosts are allowed")
                return False
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.send_error(403, "Cross-site request rejected")
                return False
            if mutation and (self.headers.get("Origin") not in {"http://" + h for h in hosts}
                             or self.headers.get("X-Job-Dating-Token") != csrf):
                self.send_error(403, "Same-origin token required")
                return False
            return True

        def respond(self, value, status=200):
            body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.allowed():
                return
            path = unquote(urlsplit(self.path).path)
            if path == "/api/config":
                return self.respond({"mode": "local", "csrfToken": csrf})
            if path == "/api/progress":
                return self.respond(store.read_all())
            if path == "/api/progress/export":
                return self.respond({"format": "job-dating-progress-v1", "exportedAt": utc_now(), "records": store.read_all()})
            if path in ("/api/catalog", "/data/catalog.json"):
                # The scheduled process can refresh data while the UI service remains running.
                try:
                    catalog = reload_catalog()
                except (OSError, ValueError):
                    with guard:
                        catalog = state["catalog"]
                return self.respond(catalog)
            if path == "/api/sync-status":
                status = {}
                try:
                    status = json.loads((root / "data/sync-status.json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    pass
                with guard:
                    if state["syncing"]:
                        status["state"] = "syncing"
                    elif status.get("state") == "syncing":
                        # A standalone scheduled updater may still hold the shared file lock.
                        status.setdefault("message", "正在同步或等待同步完成")
                    status.setdefault("last_success_at", state["catalog"]["metadata"]["captured_at"])
                return self.respond(status)
            if path.startswith("/api/"):
                return self.respond({"error": "Unknown API route"}, 404)
            relative = "index.html" if path == "/" else path.lstrip("/")
            # Only dist's public files are served; private/, source code and parent traversal are denied.
            public_root = (root / "dist").resolve()
            target = (public_root / relative).resolve()
            if not target.is_relative_to(public_root) or not target.is_file():
                return self.send_error(404)
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            self.mutate()

        def do_PUT(self):
            self.mutate()

        def mutate(self):
            if not self.allowed(mutation=True):
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size < 0 or size > 20 * 1024 * 1024 or self.headers.get_content_type() != "application/json":
                    raise ValueError("Invalid request body")
                data = json.loads(self.rfile.read(size) or b"{}")
                path = unquote(urlsplit(self.path).path)
                if self.command == "POST" and path == "/api/sync":
                    return self.respond({"started": start_sync()}, 202)
                if self.command == "POST" and path == "/api/progress/import":
                    return self.respond(store.restore_missing(data))
                if self.command == "PUT" and path.startswith("/api/progress/"):
                    rid = path.removeprefix("/api/progress/")
                    return self.respond(store.save(rid, data.get("value"), data.get("expectedRevision")))
                return self.respond({"error": "Unknown API route"}, 404)
            except ConflictError as error:
                return self.respond({"error": str(error)}, 409)
            except (ValueError, TypeError, AttributeError) as error:
                return self.respond({"error": str(error)}, 400)
            except Exception:
                return self.respond({"error": "保存失败，请保留当前内容并重试。"}, 500)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    if auto_sync:
        captured = datetime.fromisoformat(state["catalog"]["metadata"]["captured_at"].replace("Z", "+00:00")).astimezone(TZ).date()
        if captured < datetime.now(TZ).date():
            start_sync()
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4188)
    parser.add_argument("--no-auto-sync", action="store_true")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    server = make_server(root=args.root, port=args.port, auto_sync=not args.no_auto_sync)
    print(f"Local: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
