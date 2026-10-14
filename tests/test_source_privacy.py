import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import catalog
import sync

# Deliberately fictional identifiers: never use production source secrets in tests.
SOURCE = 'https://fixture-source.feishu.cn/base/FictionalBaseToken?table=FictionalTable&view=FictionalView'


class SourcePrivacyTests(unittest.TestCase):
    def setUp(self):
        self.root = ROOT / 'qa' / 'privacy-tests' / uuid.uuid4().hex
        self.root.mkdir(parents=True)

    def test_private_source_configuration_is_required_and_validated(self):
        self.assertTrue(hasattr(catalog, 'load_source'), 'source must be loaded privately at runtime')
        with patch.dict(os.environ, {'RECRUITMENT_SOURCE_URL': SOURCE}):
            source = catalog.load_source(self.root)
            self.assertEqual(source.table, 'FictionalTable')
            self.assertEqual(source.view, 'FictionalView')
        with patch.dict(os.environ, {'RECRUITMENT_SOURCE_URL': 'https://attacker.invalid/base/Secret'}):
            with self.assertRaises(ValueError) as raised: catalog.load_source(self.root)
            self.assertNotIn('attacker.invalid', str(raised.exception))
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError): catalog.load_source(self.root)
            (self.root/'private').mkdir()
            (self.root/'private/source.json').write_text(json.dumps({'url': SOURCE}), encoding='utf-8')
            self.assertEqual(catalog.load_source(self.root).table, 'FictionalTable')

    def test_source_metadata_and_embedded_source_links_never_reach_saved_catalog(self):
        self.assertTrue(hasattr(catalog, 'sanitize_catalog'), 'public data requires source sanitization')
        with patch.dict(os.environ, {'RECRUITMENT_SOURCE_URL': SOURCE}):
            config = catalog.load_source(self.root)
        snapshot = {'metadata': {'source_url': SOURCE, 'table_id': config.table,
            'captured_at': '2026-10-14T02:00:00Z', 'expected_records': 1},
            'fields': ['招聘单位', '截止日期'], 'records': [{'record_id':'fixture-record',
            '招聘单位':'测试公司', '截止日期':'尽快投递', '公告链接':SOURCE,
            '投递链接':'https://careers.example.org/apply', '专业要求':['计算机', config.token]}]}
        clean = catalog.sanitize_catalog(snapshot, config)
        encoded = json.dumps(clean, ensure_ascii=False)
        for fragment in [config.host, config.token, config.table, config.view]:
            self.assertNotIn(fragment, encoded)
        self.assertNotIn('source_url', clean['metadata'])
        self.assertEqual(clean['records'][0]['投递链接'], 'https://careers.example.org/apply')
        self.assertEqual(snapshot['metadata']['source_url'], SOURCE)

    def test_sync_error_and_traceback_do_not_expose_source(self):
        initial = catalog.merge_catalog(None, {'metadata': {'captured_at':'2026-10-13T02:00:00Z',
            'expected_records':1}, 'records':[{'record_id':'fixture-record','招聘单位':'测试公司','截止日期':'尽快投递'}]}, baseline=True)
        sync.save_catalog(initial, self.root)
        def fail(): raise ValueError('upstream request failed: '+SOURCE)
        try:
            sync.sync_once(self.root, fail)
        except RuntimeError:
            captured = traceback.format_exc()
        else: self.fail('failed source fetch must fail')
        self.assertNotIn(SOURCE, captured)
        self.assertEqual(sync.load_catalog(self.root), initial)
        self.assertNotIn(SOURCE, (self.root/'data/sync-status.json').read_text(encoding='utf-8'))


if __name__ == '__main__': unittest.main()
