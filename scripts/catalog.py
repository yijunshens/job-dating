"""Validated public recruitment data and stable discovery dates."""
import base64
import gzip
import http.cookiejar
import json
import os
from pathlib import Path
import re
from dataclasses import dataclass
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=8))
PUBLIC_META = {'captured_at', 'expected_records', 'baseline_at', 'new_count', 'active_count', 'retained_count'}


@dataclass(repr=False)
class SourceConfig:
    url: str
    host: str
    base: str
    token: str
    table: str
    view: str

    @property
    def fragments(self):
        return (self.url, self.host, self.token, self.table, self.view)


def load_source(root=None):
    """Read a runtime secret; never interpolate configuration into an exception."""
    try:
        root = Path(root) if root is not None else Path(__file__).resolve().parents[1]
        raw = os.environ.get('RECRUITMENT_SOURCE_URL')
        if raw is None:
            raw = json.loads((root/'private/source.json').read_text(encoding='utf-8'))['url']
        url = urllib.parse.urlsplit(raw.strip())
        query = urllib.parse.parse_qs(url.query, strict_parsing=True)
        match = re.fullmatch(r'/base/([A-Za-z0-9]+)', url.path)
        table, view = query['table'], query['view']
        if (url.scheme != 'https' or not url.hostname or not url.hostname.endswith('.feishu.cn')
                or url.username or url.password or url.port or url.fragment or not match
                or len(table) != 1 or len(view) != 1
                or not all(re.fullmatch(r'[A-Za-z0-9]+', item) for item in (table[0], view[0]))):
            raise ValueError()
        return SourceConfig(raw.strip(), url.hostname, 'https://'+url.hostname, match[1], table[0], view[0])
    except Exception:
        raise ValueError('Private source configuration is missing or invalid; check RECRUITMENT_SOURCE_URL or private/source.json') from None


def sanitize_catalog(value, source):
    """Remove source metadata and references before writing any publishable dataset."""
    fragments = set(source.fragments)
    for item in source.fragments:
        fragments.update((urllib.parse.quote(item, safe=''), urllib.parse.quote_plus(item)))
    pattern = re.compile('|'.join(re.escape(item) for item in sorted(fragments, key=len, reverse=True)), re.IGNORECASE)
    def clean(item):
        if isinstance(item, str): return pattern.sub('[来源已隐藏]', item)
        if isinstance(item, list): return [clean(part) for part in item]
        if isinstance(item, dict): return {clean(key): clean(part) for key, part in item.items()}
        return item
    result = clean(value)
    if 'metadata' in result:
        result['metadata'] = {k:v for k,v in result['metadata'].items() if k in PUBLIC_META}
    return result
EXPECTED_TYPES = {"招聘单位": 1, "企业性质": 4, "行业分类": 4, "招聘岗位": 1, "工作地点": 4,
                  "可投届次": 4, "更新时间": 5, "截止日期": 1, "学历要求": 1, "招聘类型": 4,
                  "公告来源": 1, "公告链接": 15, "投递链接": 15, "专业要求": 1, "是否笔试": 4,
                  "已交社保可投": 3}


def validate_source_schema(field_map, field_ids):
    schema = {field_map[fid]["name"]: field_map[fid]["type"] for fid in field_ids}
    if len(schema) != len(field_ids) or any(schema.get(name) != kind for name, kind in EXPECTED_TYPES.items()):
        raise ValueError("Source columns changed; previous data retained until adapter is updated")
    return schema


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def validate_snapshot(snapshot):
    rows = snapshot.get("records")
    expected = snapshot.get("metadata", {}).get("expected_records")
    if not isinstance(rows, list) or not rows or len(rows) != expected:
        raise ValueError("Incomplete source snapshot; previous data retained")
    ids = set()
    for row in rows:
        rid = row.get("record_id")
        if not isinstance(rid, str) or not rid or rid in ids:
            raise ValueError("Invalid or duplicate source record ID")
        if not isinstance(row.get("招聘单位"), str) or not row["招聘单位"].strip():
            raise ValueError("Source record lacks company")
        if row["招聘单位"] != "必看文档【重要】" and not isinstance(row.get("截止日期"), str):
            raise ValueError("Source record lacks deadline text")
        ids.add(rid)
    datetime.fromisoformat(snapshot["metadata"]["captured_at"].replace("Z", "+00:00"))
    return snapshot


def merge_catalog(previous, incoming, baseline=False):
    validate_snapshot(incoming)
    stamp = incoming["metadata"]["captured_at"]
    prior = {r["record_id"]: r for r in (previous or {}).get("records", [])}
    merged, seen, added = [], set(), 0
    for source in incoming["records"]:
        rid = source["record_id"]
        if source["招聘单位"] == "必看文档【重要】":
            continue
        old = prior.get(rid)
        first = old.get("firstSeenAt") if old else (None if baseline else stamp)
        if old is None and not baseline:
            added += 1
        merged.append({**source, "firstSeenAt": first, "lastSeenAt": stamp, "active": True})
        seen.add(rid)
    for rid, old in prior.items():
        if rid not in seen:
            merged.append({**old, "active": False})
    old_meta = (previous or {}).get("metadata", {})
    return {
        "metadata": {**{k:v for k,v in incoming["metadata"].items() if k in PUBLIC_META}, "baseline_at": old_meta.get("baseline_at", stamp),
                     "new_count": added, "active_count": len(seen), "retained_count": len(merged)},
        "fields": incoming.get("fields", (previous or {}).get("fields", [])),
        "records": merged,
    }


def _decode(value):
    return json.loads(gzip.decompress(base64.b64decode(value)))


def _field_value(field, raw):
    if raw is None:
        return None
    kind = field["type"]
    if kind in (3, 4):
        options = {o["id"]: o["name"] for o in field["property"]["options"]}
        values = raw if isinstance(raw, list) else [raw]
        result = [options[value] for value in values]
        return result if kind == 4 else (result[0] if result else None)
    if kind == 5:
        return datetime.fromtimestamp(raw / 1000, TZ).strftime("%Y/%m/%d")
    if kind in (1, 15):
        if isinstance(raw, list):
            return ("\n" if kind == 15 else "").join(
                (p.get("link") or p.get("text", "")) if kind == 15 else p.get("text", "") for p in raw)
        return str(raw)
    raise ValueError(f"Unsupported source field type: {kind}")


def fetch_snapshot(root=None):
    """Use only the source's currently anonymous readable interface; never bypass login."""
    source = load_source(root)
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        # GitHub masks the complete secret; derived identifiers also need masking.
        for item in source.fragments:
            print('::add-mask::'+item.replace('%','%25').replace('\r','%0D').replace('\n','%0A'), flush=True)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    headers = {"User-Agent": "Mozilla/5.0", "Referer": source.url}

    def get(url):
        with opener.open(urllib.request.Request(url, headers=headers), timeout=40) as response:
            body = response.read(40 * 1024 * 1024 + 1)
            if len(body) > 40 * 1024 * 1024:
                raise ValueError("Source response exceeds limit")
            return body

    def api(endpoint, params):
        url = f"{source.base}/space/api/v1/bitable/{source.token}/{endpoint}?{urllib.parse.urlencode(params)}"
        value = json.loads(get(url))
        if value.get("code") != 0:
            raise ValueError('Source refused request; previous data retained')
        return value["data"]

    get(source.url)
    initial_params = {"tableID": source.table, "viewID": source.view, "recordLimit": 200, "ondemandLimit": 200,
                      "needBase": "true", "viewLazyLoad": "true", "ondemandVer": 2, "openType": 0,
                      "noMissCS": "true", "optimizationFlag": 1, "removeFmlExtra": "true"}
    initial = api("clientvars", initial_params)
    table = _decode(initial["table"])
    fields = table["viewMap"][source.view]["property"]["fields"]
    validate_source_schema(table["fieldMap"], fields)
    meta = table["meta"]
    if meta["id"] != source.table or not 1 <= meta["recordsNum"] <= 30000:
        raise ValueError("Unexpected source table/count")
    revision, total = meta["rev"], meta["recordsNum"]
    record_map, order = {}, []
    for offset in range(0, total, 2000):
        params = {"tableId": source.table, "viewId": source.view, "tableRev": revision, "depRev": "{}",
                  "viewLazyLoad": "true", "offset": offset, "limit": 2000,
                  "tableID": source.table, "viewID": source.view, "removeFmlExtra": "true"}
        chunk = _decode(api("records", params)["records"])
        if chunk["tableID"] != source.table or chunk["tableRev"] != revision:
            raise ValueError("Source changed during fetch; retry later")
        for rid, value in chunk["recordMap"].items():
            if rid in record_map and record_map[rid] != value:
                raise ValueError("Conflicting source records")
            if rid not in record_map:
                order.append(rid)
            record_map[rid] = value
    if len(record_map) != total:
        raise ValueError(f"Incomplete source: {len(record_map)} of {total}; previous data retained")
    final_meta = _decode(api("clientvars", initial_params)["table"])["meta"]
    if final_meta["rev"] != revision or final_meta["recordsNum"] != total:
        raise ValueError("Source revision changed during fetch; retry later")
    records = []
    for rid in order:
        row = {"record_id": rid}
        for fid in fields:
            field = table["fieldMap"][fid]
            value = _field_value(field, record_map[rid].get(fid, {}).get("value"))
            if field["name"] in ("招聘单位", "截止日期") and value is None:
                value = "" if field["name"] == "截止日期" else None
            row[field["name"]] = value
        records.append(row)
    return sanitize_catalog(validate_snapshot({"metadata": {"captured_at": utc_now(), "expected_records": total},
        "fields": [table["fieldMap"][fid]["name"] for fid in fields], "records": records}), source)
