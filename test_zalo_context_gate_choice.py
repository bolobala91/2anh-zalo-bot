"""Regression tests for named, evidence-linked context decisions."""
import importlib.util
import io
import json
from pathlib import Path
import secrets
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "context_gate_choice_under_test", Path(__file__).parent / "hermes-plugin/zalo/context_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ContextGateChoiceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.secret = secrets.token_urlsafe(32)
        self.reader = lambda name, default=None: self.secret if name == "NINEROUTER_API_KEY" else default
        self.state = gate._state(
            text="Làm phần ngân sách trước nhé.", sender_uid="person-1", sender_name="Người thử",
            bot_uid="bot-1", bot_name="Tuấn MKT", quote_is_own=False,
            recent=[{"id": "bot-message-1", "sender_uid": "bot-1",
                     "text": "Bạn muốn mình xem phần nào trước?", "reply_to_sender_uid": "person-1"}],
        )

    def test_systemone_choice_returns_named_followup_with_bot_evidence(self):
        def transport(request, timeout):
            payload = json.loads(request.data)
            self.assertEqual(request.full_url, gate.DEFAULT_BASE_URL + "/systemone")
            self.assertEqual(set(payload["questions"]), {"context_decision"})
            question = payload["questions"]["context_decision"]
            self.assertEqual(question["type"], "choice")
            self.assertIn("follow_up__m0", question["criteria"])
            self.assertEqual(payload["state"]["recent_messages"][0]["message_ref"], "m0")
            return io.BytesIO(json.dumps({"answers": {"context_decision": {
                "type": "choice", "choice": "follow_up__m0",
                "probabilities": {"follow_up__m0": 0.39}, "confidence": 0.39,
            }}}).encode())

        with patch.object(gate, "urlopen", side_effect=transport):
            result = gate._request_sync(extra={}, state=self.state, get_secret=self.reader)
        self.assertEqual(result, {"category": "follow_up", "evidence_ref": "m0"})

    def test_verified_tag_reply_or_owner_call_word_normalizes_to_direct_address(self):
        for key in ("tagged_bot", "reply_to_bot", "text_matches_call_word"):
            state = gate._state(
                text="Tuấn ơi, phần ngân sách.", sender_uid="person-1", sender_name="Người thử",
                bot_uid="bot-1", bot_name="Tuấn MKT", quote_is_own=key == "reply_to_bot", recent=[],
                addressing={} if key == "reply_to_bot" else {key: True},
            )
            body = io.BytesIO(b'{"answers":{"context_decision":{"type":"choice","choice":"ambiguous"}}}')
            with self.subTest(evidence=key), patch.object(gate, "urlopen", return_value=body):
                result = gate._request_sync(extra={}, state=state, get_secret=self.reader)
            self.assertEqual(result, {"category": "addressed_to_bot", "evidence_ref": None})

    def test_name_only_call_word_is_not_hard_positive_when_a_duplicate_exists(self):
        state = gate._state(
            text="Tuấn ơi, xem giúp.", sender_uid="owner", sender_name="Chủ nhân",
            bot_uid="bot-1", bot_name="Tuấn MKT", quote_is_own=False, recent=[],
            addressing={"text_matches_call_word": True, "other_members_share_bot_name": True,
                        "name_roster_complete": True},
        )
        body = io.BytesIO(b'{"answers":{"context_decision":{"type":"choice","choice":"ambiguous"}}}')
        with patch.object(gate, "urlopen", return_value=body):
            result = gate._request_sync(extra={}, state=state, get_secret=self.reader)
        self.assertEqual(result, {"category": "ambiguous", "evidence_ref": None})

    def test_chat_completion_returns_same_named_contract_without_probability_threshold(self):
        extra = {"context_gate_base_url": "https://openrouter.ai/api/v1",
                 "context_gate_model": "google/gemma-4-26b-a4b-it:free",
                 "context_gate_key_env": "OPENROUTER_API_KEY"}
        def transport(request, timeout):
            body = json.loads(request.data)
            system = body["messages"][0]["content"]
            self.assertIn("evidence_ref", system)
            self.assertIn("follow_up", system)
            return io.BytesIO(json.dumps({"choices": [{"finish_reason": "stop", "message": {
                "content": '{"category":"follow_up","evidence_ref":"m0"}'}}]}).encode())

        with patch.object(gate, "urlopen", side_effect=transport):
            result = gate._request_sync(extra=extra, state=self.state,
                                        get_secret=lambda name, default=None: self.secret if name == "OPENROUTER_API_KEY" else default)
        self.assertEqual(result, {"category": "follow_up", "evidence_ref": "m0"})

    async def test_followup_needs_a_real_bot_message_reference(self):
        for classification, expected in [
            ({"category": "follow_up", "evidence_ref": "m0"}, True),
            ({"category": "follow_up", "evidence_ref": "m9"}, False),
            ({"category": "follow_up", "evidence_ref": None}, False),
            ({"category": "member_conversation", "evidence_ref": None}, False),
            ({"category": "new_topic", "evidence_ref": None}, False),
            ({"category": "ambiguous", "evidence_ref": None}, False),
            ({"category": "addressed_to_bot", "evidence_ref": None}, True),
            ({"category": "made_up", "evidence_ref": None}, False),
        ]:
            with self.subTest(classification=classification), patch.object(
                    gate, "_request_sync", return_value=classification):
                self.assertIs(await gate.should_respond(
                    extra={"context_gate_threshold": "0.99"}, get_secret=self.reader,
                    text="Làm phần ngân sách trước nhé.", sender_uid="person-1", sender_name="Người thử",
                    bot_uid="bot-1", bot_name="Tuấn MKT", quote_is_own=False,
                    recent=[{"id": "bot-message-1", "sender_uid": "bot-1",
                             "text": "Bạn muốn mình xem phần nào trước?"}],
                ), expected)


if __name__ == "__main__":
    unittest.main()
