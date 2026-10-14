import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from catalog import merge_catalog, validate_snapshot, validate_source_schema, EXPECTED_TYPES

def row(id,company="Company"):
    return {"record_id":id,"招聘单位":company,"截止日期":"2026/11/01"}
def snapshot(rows):
    return {"metadata":{"captured_at":"2026-10-14T02:00:00Z","expected_records":len(rows)},"records":rows}
class CatalogTests(unittest.TestCase):
    def test_missing_or_changed_consumed_source_column_rejected(self):
        fields={str(i):{"name":name,"type":kind} for i,(name,kind) in enumerate(EXPECTED_TYPES.items())}
        validate_source_schema(fields,list(fields))
        apply_id=next(k for k,v in fields.items() if v["name"]=="投递链接")
        with self.assertRaises(ValueError):validate_source_schema(fields,[k for k in fields if k!=apply_id])
        fields[apply_id]["type"]=1
        with self.assertRaises(ValueError):validate_source_schema(fields,list(fields))
    def test_baseline_is_not_mislabelled_new(self):
        c=merge_catalog(None,snapshot([row("a")]),baseline=True)
        self.assertIsNone(c["records"][0]["firstSeenAt"])
        self.assertEqual(c["metadata"]["new_count"],0)
    def test_edit_does_not_reset_new_date_and_reappearance_retains_it(self):
        c=merge_catalog(None,snapshot([row("a")]),baseline=True)
        c=merge_catalog(c,snapshot([row("a"),row("b")]))
        first=c["records"][1]["firstSeenAt"]
        self.assertEqual(c["metadata"]["new_count"],1)
        c=merge_catalog(c,snapshot([row("a","Changed")]))
        self.assertFalse(c["records"][1]["active"])
        c=merge_catalog(c,snapshot([row("a"),row("b","Changed")]))
        self.assertEqual(c["records"][1]["firstSeenAt"],first)
        self.assertEqual(c["metadata"]["new_count"],0)
    def test_partial_or_duplicate_snapshot_rejected(self):
        s=snapshot([row("a")]);s["metadata"]["expected_records"]=2
        with self.assertRaises(ValueError):validate_snapshot(s)
        with self.assertRaises(ValueError):validate_snapshot(snapshot([row("a"),row("a")]))
    def test_old_history_not_mutated(self):
        c=merge_catalog(None,snapshot([row("a")]),baseline=True)
        merge_catalog(c,snapshot([row("b")]))
        self.assertTrue(c["records"][0]["active"])
if __name__=="__main__":unittest.main()
