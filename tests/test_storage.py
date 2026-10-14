import sys, unittest, uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from storage import ProgressStore, ConflictError

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.path=Path(__file__).resolve().parents[1]/"qa"/"test-runs"/uuid.uuid4().hex/"progress.sqlite3"
        self.store=ProgressStore(self.path)
    def test_reopen_and_revision_conflict(self):
        value={"status":"filling","favorite":True,"notes":"尚未提交，需要补成绩单","appliedOn":""}
        self.store.save("record1",value,0)
        self.assertEqual(ProgressStore(self.path).read_all()["record1"]["notes"],value["notes"])
        with self.assertRaises(ConflictError):self.store.save("record1",value,0)
    def test_backup_validation_and_no_overwrite(self):
        self.store.save("a",{"notes":"new"},0)
        result=self.store.restore_missing({"format":"job-dating-progress-v1","records":{"a":{"notes":"old"},"b":{"notes":"restored"}}})
        self.assertEqual(result,{"restored":1,"skipped":1})
        self.assertEqual(self.store.read_all()["a"]["notes"],"new")
        with self.assertRaises(ValueError):self.store.restore_missing({"format":"job-dating-progress-v1","records":{"c":{"notes":[]}}})
        self.assertNotIn("c",self.store.read_all())
if __name__=="__main__":unittest.main()
