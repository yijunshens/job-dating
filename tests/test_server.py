import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from server import make_server
from sync import save_catalog, load_catalog, sync_once
from catalog import merge_catalog, validate_source_schema

class ServerTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(__file__).resolve().parents[1]/"qa"/"test-runs"/uuid.uuid4().hex
        self.initial=merge_catalog(None,{"metadata":{"captured_at":"2026-10-13T06:00:00Z","expected_records":1},"records":[{"record_id":"test-id","招聘单位":"Test","截止日期":"尽快投递"}]},baseline=True)
        save_catalog(self.initial,self.root)
        self.server=make_server(self.root,0,False)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.host='127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
    def request(self,method,path,payload=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        body=json.dumps(payload) if payload is not None else None
        connection.request(method,path,body,{"Content-Type":"application/json",**(headers or {})})
        response=connection.getresponse();status=response.status;raw=response.read();connection.close()
        try:value=json.loads(raw)
        except ValueError:value={}
        return status,value
    def test_host_origin_and_private_paths(self):
        self.assertEqual(self.request('GET','/api/progress',headers={'Host':'attacker.invalid'})[0],403)
        self.assertEqual(self.request('GET','/private/progress.sqlite3')[0],404)
        token=self.request('GET','/api/config')[1]['csrfToken']
        body={'value':{'notes':'mine'},'expectedRevision':0}
        self.assertEqual(self.request('PUT','/api/progress/test-id',body,{'Origin':'https://attacker.invalid','X-Job-Dating-Token':token})[0],403)
        headers={'Origin':'http://'+self.host,'X-Job-Dating-Token':token}
        self.assertEqual(self.request('PUT','/api/progress/test-id',body,headers)[0],200)
        self.assertEqual(self.request('PUT','/api/progress/test-id',body,headers)[0],409)
        self.assertEqual(self.request('GET','/api/progress')[1]['test-id']['notes'],'mine')
    def test_failed_sync_and_interrupted_latest_keep_data(self):
        with self.assertRaises(RuntimeError):
            sync_once(self.root,lambda:{'metadata':{'expected_records':20},'records':[]})
        self.assertEqual(load_catalog(self.root),self.initial)
        (self.root/'data/catalog.json').write_text('{interrupted',encoding='utf-8')
        self.assertEqual(load_catalog(self.root),self.initial)
    def test_source_schema_failure_keeps_previous_catalog(self):
        def changed_source():
            validate_source_schema({'company':{'name':'招聘单位','type':1}},['company'])
        with self.assertRaises(RuntimeError):sync_once(self.root,changed_source)
        self.assertEqual(load_catalog(self.root),self.initial)
        status=json.loads((self.root/'data/sync-status.json').read_text(encoding='utf-8'))
        self.assertEqual(status['state'],'error')
        self.assertEqual(status['last_success_at'],self.initial['metadata']['captured_at'])
if __name__=='__main__':unittest.main()
