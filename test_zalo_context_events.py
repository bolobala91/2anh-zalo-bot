import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("context_events", Path(__file__).parent / "hermes-plugin/zalo/context_events.py")
events = importlib.util.module_from_spec(spec)
spec.loader.exec_module(events)


class ContextEventsTest(unittest.TestCase):
    def test_only_safe_fields_are_saved_and_rotation_is_bounded(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "events.jsonl"
            details = {"reason": "classification", "classification": "follow_up", "evidence_ref": "m2",
                       "text": "private text", "api_key": "private credential", "duration_ms": 80,
                       "stages": [{"provider": "openrouter", "model": "typesafe/jev-1.14", "status": "ok",
                                   "classification": "follow_up", "evidence_ref": "m2",
                                   "duration_ms": 80, "body": "private response"}]}
            with patch.object(events, "MAX_BYTES", 1024):
                for i in range(20):
                    events.record(account="999", thread="200", message=str(i), respond=True, details=details, path=path)
            self.assertLessEqual(path.stat().st_size, 1024)
            self.assertLessEqual(path.with_suffix(".jsonl.1").stat().st_size, 1024)
            raw = path.read_text()
            self.assertNotIn("private", raw)
            row = json.loads(raw.splitlines()[-1])
            self.assertEqual(row["decision"], "RESPOND")
            self.assertEqual(row["message"], "19")
            self.assertEqual(row["classification"], "follow_up")
            self.assertEqual(row["evidence_ref"], "m2")
            self.assertNotIn("probability", row)
            self.assertNotIn("threshold", row)
            self.assertEqual(row["stages"][0]["model"], "typesafe/jev-1.14")
            self.assertEqual(row["stages"][0]["classification"], "follow_up")

    def test_storage_failure_does_not_change_message_handling(self):
        with patch.object(events, "log_path", side_effect=OSError("secret detail")):
            events.record(account="999", thread="200", message="1", respond=False, details={"reason": "no_context"})

    def test_untrusted_reason_model_and_nan_never_persist(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "events.jsonl"
            events.record(account="999", thread="200", message="1", respond=False, path=path,
                          details={"reason": "secret reason", "classification": "secret category",
                                   "stages": [{"model": "secret-model", "provider": "secret-url", "status": "secret-error"}]})
            raw = path.read_text()
            self.assertNotIn("secret", raw)
            self.assertNotIn("NaN", raw)
            self.assertEqual(json.loads(raw)["reason"], "unavailable")


if __name__ == "__main__":
    unittest.main()
