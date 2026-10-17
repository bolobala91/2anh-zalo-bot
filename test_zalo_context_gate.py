"""Synthetic decision-service contract tests; no real credentials or traffic."""
import asyncio
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "context_gate_under_test", Path(__file__).parent / "hermes-plugin/zalo/context_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ContextGateTest(unittest.IsolatedAsyncioTestCase):
    async def test_direct_reply_is_classified_and_does_not_short_circuit(self):
        details = {}
        with patch.object(gate, '_request_sync', return_value=.1) as request:
            self.assertFalse(await gate.should_respond(**{**self.args, 'quote_is_own':True}, diagnostics=details))
        request.assert_called_once()
        self.assertTrue(request.call_args.kwargs['state']['current']['reply_to_bot'])

    def test_name_collisions_and_addressing_are_minimal_metadata(self):
        state = gate._state(text='Tuấn ơi', sender_uid='user-1', sender_name='Tuấn khác',
            bot_uid='bot-1', bot_name='Tuấn MKT', quote_is_own=False,
            recent=[{'sender_uid':'user-2','sender_name':'Tuấn Phạm','text':'Tôi đặt bàn rồi','age_seconds':301}],
            addressing={'text_matches_call_word':True, 'other_members_share_bot_name':True,
                        'name_roster_complete':True, 'secret':'never-send-this'})
        self.assertTrue(state['current']['sender_shares_bot_name'])
        self.assertTrue(state['recent_messages'][0]['sender_shares_bot_name'])
        self.assertEqual(state['recent_messages'][0]['age_seconds'],301)
        self.assertTrue(state['current']['other_members_share_bot_name'])
        self.assertNotIn('never-send-this',json.dumps(state))
        self.assertNotIn('Tuấn Phạm',json.dumps(state,ensure_ascii=False))

    async def test_cli_gemini_uses_profile_key_and_never_openrouter(self):
        self.values.update(ZALO_CONTEXT_GATE_CLASSIFIER='gemini-cli', OPENAI_API_KEY=self.secret)
        details = {}
        def request(req, timeout):
            self.assertEqual(req.full_url, 'https://cli.bolamarketing.com/v1/chat/completions')
            self.assertEqual(json.loads(req.data)['model'], 'gemini-3.8-flash-high')
            self.assertEqual(req.get_header('Authorization'), 'Bearer ' + self.secret)
            return io.BytesIO(b'{"choices":[{"finish_reason":"stop","message":{"content":"{\\"should_respond\\":0.8}"}}]}')
        with patch.object(gate, 'urlopen', side_effect=request):
            self.assertTrue(await gate.should_respond(**self.args, diagnostics=details))
        self.assertEqual(details['stages'][0]['provider'], 'cli')
        for model in ('google/gemini-3.8-flash', gate.GEMINI_MODEL, gate.CLI_GEMINI_MODEL):
            extra = {'context_gate_classifier':'configured', 'context_gate_base_url':'https://openrouter.ai/api/v1', 'context_gate_model':model}
            with patch.object(gate, 'urlopen') as req:
                self.assertFalse(await gate.should_respond(**{**self.args, 'extra':extra}))
                req.assert_not_called()

    async def test_gemini_uses_9router_chat_transport_with_no_tools(self):
        self.values['ZALO_CONTEXT_GATE_CLASSIFIER'] = 'gemini-9router'
        def request(req, timeout):
            self.assertEqual(req.full_url, 'https://9router.bolamarketing.com/v1/chat/completions')
            body = json.loads(req.data)
            self.assertEqual(body['model'], 'gemini/gemini-3.8-flash')
            self.assertEqual(body['reasoning']['effort'], 'low')
            self.assertNotIn('tools', body)
            return io.BytesIO(json.dumps({'choices': [{'finish_reason': 'stop', 'message': {'content': '{"should_respond":0.89}'}}]}).encode())
        with patch.object(gate, 'urlopen', side_effect=request):
            self.assertTrue(await gate.should_respond(**self.args))

    async def test_gemini_fallback_stays_on_9router_and_low_score_stops(self):
        self.values.update(ZALO_CONTEXT_GATE_FALLBACK_ENABLED='true',
                           ZALO_CONTEXT_GATE_FALLBACK_MODEL='gemini/gemini-3.8-flash',
                           ZALO_CONTEXT_GATE_OPENROUTER_FALLBACK_ENABLED='true')
        details = {}
        with patch.object(gate, '_request_sync', side_effect=[TimeoutError(), .1]) as request:
            self.assertFalse(await gate.should_respond(**self.args, diagnostics=details))
        self.assertEqual(request.call_count, 2)
        fallback = request.call_args.kwargs['extra']
        self.assertEqual(fallback['context_gate_base_url'], gate.DEFAULT_BASE_URL)
        self.assertEqual(fallback['context_gate_key_env'], 'NINEROUTER_API_KEY')
        self.assertEqual(details['stages'][-1]['provider'], '9router')

    async def test_diagnostics_capture_fallback_without_secret_or_text(self):
        details = {}
        self.values.update(ZALO_CONTEXT_GATE_FALLBACK_ENABLED="true")
        with patch.object(gate, "_request_sync", side_effect=[TimeoutError(self.secret), 0.84]):
            self.assertTrue(await gate.should_respond(**self.args, diagnostics=details))
        self.assertEqual(details["reason"], "probability")
        self.assertEqual(details["probability"], 0.84)
        self.assertEqual(details["threshold"], 0.72)
        self.assertEqual([s["status"] for s in details["stages"]], ["timeout", "ok"])
        self.assertEqual(details["stages"][1]["model"], "google/gemma-4-26b-a4b-it:free")
        self.assertNotIn(self.secret, json.dumps(details))
        self.assertNotIn(self.args["text"], json.dumps(details))
        self.assertGreaterEqual(details["duration_ms"], 0)

    async def test_diagnostics_fail_closed_and_low_probability_never_retries(self):
        for result, reason in [(RuntimeError("private response"), "unavailable"), (0.1, "probability")]:
            details = {}
            with patch.object(gate, "_request_sync", side_effect=[result]) as request:
                self.assertFalse(await gate.should_respond(**self.args, diagnostics=details))
            self.assertEqual(details["reason"], reason)
            self.assertEqual(len(details["stages"]), 1)
            request.assert_called_once()
            self.assertNotIn("private response", json.dumps(details))

    def setUp(self):
        self.secret = secrets.token_urlsafe(32)
        self.values = {"NINEROUTER_API_KEY": self.secret}
        self.reader = lambda name, default=None: self.values.get(name, default)
        self.args = dict(extra={}, get_secret=self.reader, text="Làm tiếp phần vừa rồi.",
                         sender_uid="person-1", sender_name="Người thử",
                         bot_uid="bot-1", bot_name="Tuấn MKT", quote_is_own=False,
                         recent=[{"sender_uid": "bot-1", "text": "Bạn muốn xem phần nào?"}])

    async def test_threshold_boundaries_and_invalid_probabilities(self):
        for probability, expected in [(0, False), (0.719, False), (0.72, True),
                                      (1, True), (-0.1, False), (1.1, False),
                                      (float("nan"), False), (float("inf"), False),
                                      (True, False), ("0.99", False), (None, False)]:
            with self.subTest(probability=probability), patch.object(gate, "_request_sync", return_value=probability):
                self.assertIs(await gate.should_respond(**self.args), expected)

    async def test_scoped_threshold_and_invalid_config_fail_closed(self):
        for value, expected in [("0.95", False), ("0.72", True), ("nan", False),
                                ("-1", False), ("1.1", False), ("broken", False)]:
            self.values["ZALO_CONTEXT_GATE_THRESHOLD"] = value
            with self.subTest(value=value), patch.object(gate, "_request_sync", return_value=0.9):
                self.assertIs(await gate.should_respond(**self.args), expected)

    async def test_errors_are_silent_and_do_not_log_exception_secrets(self):
        errors = [TimeoutError(self.secret), RuntimeError(self.secret)]
        errors += [urllib.error.HTTPError("https://example.invalid", c, self.secret, {}, None)
                   for c in (401, 403, 429, 500, 503)]
        for error in errors:
            with self.subTest(error=type(error).__name__), patch.object(gate, "_request_sync", side_effect=error):
                with self.assertLogs(gate.logger, level="INFO") as logs:
                    self.assertFalse(await gate.should_respond(**self.args))
                self.assertNotIn(self.secret, " ".join(logs.output))

    async def test_real_transport_validates_json_shape_and_range(self):
        bad = [b"not json", b"[]", b"{}", b'{"answers": []}',
               b'{"answers":{"should_respond":{"noul":null}}}',
               b'{"answers":{"should_respond":{"noul":"0.99"}}}',
               b'{"answers":{"should_respond":{"noul":true}}}',
               b'{"answers":{"should_respond":{"noul":2}}}',
               b'{"answers":{"should_respond":{"noul":NaN}}}']
        for body in bad:
            with self.subTest(body=body), patch.object(gate, "urlopen", return_value=io.BytesIO(body)):
                self.assertFalse(await gate.should_respond(**self.args))

    async def test_transport_headers_payload_and_scoped_key(self):
        captured = []
        def request(req, timeout):
            captured.append(req)
            self.assertGreaterEqual(timeout, 5)
            self.assertLessEqual(timeout, 8)
            self.assertEqual(req.full_url, "https://9router.bolamarketing.com/v1/systemone")
            self.assertTrue(req.get_header("User-agent"))
            self.assertEqual(req.get_header("Authorization"), "Bearer " + self.secret)
            body = json.loads(req.data)
            self.assertEqual(body["model"], "openrouter/typesafe/jev-1.13")
            self.assertEqual(set(body), {"model", "state", "questions"})
            self.assertEqual(set(body["questions"]), {"should_respond"})
            self.assertNotIn(self.secret, req.data.decode())
            return io.BytesIO(b'{"answers":{"should_respond":{"type":"noul","noul":0.9}}}')
        with patch.dict(os.environ, {"NINEROUTER_API_KEY": "wrong-profile"}), patch.object(gate, "urlopen", side_effect=request):
            self.assertTrue(await gate.should_respond(**self.args))
        self.assertEqual(len(captured), 1)

    async def test_openrouter_uses_its_own_key_and_model(self):
        self.values.update(ZALO_CONTEXT_GATE_BASE_URL="https://openrouter.ai/api/v1",
                           OPENROUTER_API_KEY=self.secret)
        def request(req, timeout):
            self.assertEqual(req.full_url, "https://openrouter.ai/api/v1/systemone")
            self.assertEqual(json.loads(req.data)["model"], "typesafe/jev-1.14")
            self.assertEqual(req.get_header("Authorization"), "Bearer " + self.secret)
            return io.BytesIO(b'{"answers":{"should_respond":{"noul":0.8}}}')
        with patch.object(gate, "urlopen", side_effect=request):
            self.assertTrue(await gate.should_respond(**self.args))

    async def test_missing_scoped_key_never_borrows_environment_key(self):
        self.values.clear()
        with patch.dict(os.environ, {"NINEROUTER_API_KEY": self.secret}), patch.object(gate, "urlopen") as request:
            self.assertFalse(await gate.should_respond(**self.args))
            request.assert_not_called()

    async def test_gemma_models_only_classify_json_without_tools(self):
        self.values.update(ZALO_CONTEXT_GATE_BASE_URL="https://openrouter.ai/api/v1",
                           OPENROUTER_API_KEY=self.secret)
        for model in ("google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"):
            self.values["ZALO_CONTEXT_GATE_MODEL"] = model
            def request(req, timeout):
                self.assertEqual(req.full_url, "https://openrouter.ai/api/v1/chat/completions")
                body = json.loads(req.data)
                self.assertEqual(body["model"], model)
                self.assertNotIn("tools", body)
                self.assertNotIn("session", body)
                self.assertEqual(body["response_format"], {"type": "json_object"})
                return io.BytesIO(json.dumps({"choices": [{"finish_reason": "stop", "message": {
                    "content": '{"should_respond":0.9}'}}]}).encode())
            with self.subTest(model=model), patch.object(gate, "urlopen", side_effect=request):
                self.assertTrue(await gate.should_respond(**self.args))

    async def test_gemma_rejects_non_json_tools_truncation_and_extra_fields(self):
        self.values.update(ZALO_CONTEXT_GATE_BASE_URL="https://openrouter.ai/api/v1",
                           ZALO_CONTEXT_GATE_MODEL="google/gemma-4-31b-it:free", OPENROUTER_API_KEY=self.secret)
        cases = [("Hello", "stop", {}), ('{"should_respond":true}', "stop", {}),
                 ('{"should_respond":0.99}', "length", {}),
                 ('{"should_respond":0.99}', "stop", {"tool_calls": [{"id": "tool"}]}),
                 ('{"should_respond":0.99,"answer":"Hello"}', "stop", {})]
        for content, reason, extra in cases:
            body = json.dumps({"choices": [{"finish_reason": reason, "message": {"content": content, **extra}}]}).encode()
            with self.subTest(content=content, reason=reason), patch.object(gate, "urlopen", return_value=io.BytesIO(body)):
                self.assertFalse(await gate.should_respond(**self.args))

    async def test_overall_timeout_bounds_slow_transport(self):
        async def slow(*args, **kwargs):
            await asyncio.sleep(1)
            return 1
        with patch.object(gate, "TIMEOUT_S", 0.02), patch.object(gate.asyncio, "to_thread", side_effect=slow):
            self.assertFalse(await asyncio.wait_for(gate.should_respond(**self.args), 0.2))

    def test_state_is_bounded_pseudonymous_and_redacted(self):
        text = "https://example.invalid/session/private?token=hidden API_KEY=secret-value " + "x" * 1200
        state = gate._state(text=text, sender_uid="private-user-id", sender_name="Private Name",
                            bot_uid="private-bot-id", bot_name="Tuấn MKT", quote_is_own=False,
                            recent=[{"sender_uid": "private-user-id", "sender_name": "Private Name",
                                     "text": text, "raw": {"cookie": "sensitive"},
                                     "attachments": [{"text": "document contents"}]}] * 20)
        encoded = json.dumps(state)
        for hidden in ("private-user-id", "private-bot-id", "Private Name", "https://", "secret-value", "cookie", "document contents"):
            self.assertNotIn(hidden, encoded)
        self.assertLessEqual(len(state["recent_messages"]), 8)
        self.assertLessEqual(len(state["current"]["text"]), 1000)
        self.assertTrue(all(len(m["text"]) <= 500 for m in state["recent_messages"]))

    def test_enabled_uses_profile_reader(self):
        self.values["ZALO_CONTEXT_GATE_ENABLED"] = "true"
        with patch.dict(os.environ, {"ZALO_CONTEXT_GATE_ENABLED": "false"}):
            self.assertTrue(gate.enabled({}, get_secret=self.reader))

    def test_settings_never_copy_unrelated_extra_or_secrets(self):
        values = gate.settings({"bridge_token": self.secret, "api_key": self.secret,
                                "context_gate_threshold": 0.8}, self.reader)
        self.assertEqual(values, {"context_gate_threshold": "0.8"})
        self.assertNotIn(self.secret, repr(values))

    def test_redirects_never_forward_credentials(self):
        request = gate.urllib.request.Request("https://example.invalid", headers={"Authorization": self.secret})
        self.assertIsNone(gate._NoRedirect().redirect_request(
            request, None, 302, "redirect", {}, "https://other.invalid"))

    async def test_oversized_response_fails_closed(self):
        with patch.object(gate, "urlopen", return_value=io.BytesIO(b" " * (gate.MAX_RESPONSE_BYTES + 1))):
            self.assertFalse(await gate.should_respond(**self.args))

    async def test_jev_error_uses_openrouter_gemma_fallback(self):
        self.values.update(ZALO_CONTEXT_GATE_FALLBACK_ENABLED="true", OPENROUTER_API_KEY=self.secret)
        with patch.object(gate, "_request_sync", side_effect=[TimeoutError(self.secret), 0.9]) as request:
            self.assertTrue(await gate.should_respond(**self.args))
        self.assertEqual(request.call_count, 2)
        fallback = request.call_args.kwargs["extra"]
        self.assertEqual(fallback["context_gate_base_url"], "https://openrouter.ai/api/v1")
        self.assertEqual(fallback["context_gate_model"], "google/gemma-4-26b-a4b-it:free")
        self.assertEqual(fallback["context_gate_key_env"], "OPENROUTER_API_KEY")
        self.assertNotIn(self.secret, repr(fallback))

    async def test_valid_jev_ignore_never_requests_second_opinion(self):
        self.values["ZALO_CONTEXT_GATE_FALLBACK_ENABLED"] = "true"
        with patch.object(gate, "_request_sync", return_value=0.2) as request:
            self.assertFalse(await gate.should_respond(**self.args))
        self.assertEqual(request.call_count, 1)

    async def test_invalid_jev_probability_can_fallback_but_both_fail_stays_closed(self):
        self.values["ZALO_CONTEXT_GATE_FALLBACK_ENABLED"] = "true"
        for outcomes, expected in [([2, 0.9], True), ([None, 0.2], False),
                                   ([TimeoutError(), RuntimeError()], False)]:
            with self.subTest(expected=expected), patch.object(gate, "_request_sync", side_effect=outcomes) as request:
                self.assertIs(await gate.should_respond(**self.args), expected)
                self.assertEqual(request.call_count, 2)

    async def test_disabled_fallback_preserves_fail_closed(self):
        with patch.object(gate, "_request_sync", side_effect=TimeoutError()) as request:
            self.assertFalse(await gate.should_respond(**self.args))
        self.assertEqual(request.call_count, 1)

    async def test_fallback_has_a_shared_total_deadline(self):
        self.values["ZALO_CONTEXT_GATE_FALLBACK_ENABLED"] = "true"
        async def slow(*args, **kwargs):
            await asyncio.sleep(1)
            return 1
        with patch.object(gate, "PRIMARY_TIMEOUT_S", 0.02), patch.object(gate, "TOTAL_TIMEOUT_S", 0.05), \
                patch.object(gate.asyncio, "to_thread", side_effect=slow):
            self.assertFalse(await asyncio.wait_for(gate.should_respond(**self.args), 0.15))

    async def test_gemma_primary_never_retries_itself(self):
        self.values.update(ZALO_CONTEXT_GATE_FALLBACK_ENABLED="true",
                           ZALO_CONTEXT_GATE_MODEL="google/gemma-4-26b-a4b-it:free")
        with patch.object(gate, "_request_sync", side_effect=TimeoutError()) as request:
            self.assertFalse(await gate.should_respond(**self.args))
        self.assertEqual(request.call_count, 1)

    async def test_third_stage_uses_jev_openrouter_only_after_two_errors(self):
        self.values.update(ZALO_CONTEXT_GATE_FALLBACK_ENABLED="true",
                           ZALO_CONTEXT_GATE_OPENROUTER_FALLBACK_ENABLED="true")
        with patch.object(gate, "_request_sync", side_effect=[TimeoutError(), RuntimeError(), 0.9]) as request:
            self.assertTrue(await gate.should_respond(**self.args))
        self.assertEqual(request.call_count, 3)
        last = request.call_args.kwargs["extra"]
        self.assertEqual(last["context_gate_model"], "typesafe/jev-1.14")
        self.assertEqual(last["context_gate_base_url"], "https://openrouter.ai/api/v1")
        self.assertEqual(last["context_gate_key_env"], "OPENROUTER_API_KEY")

    async def test_gemma_valid_ignore_stops_before_third_stage(self):
        self.values.update(ZALO_CONTEXT_GATE_FALLBACK_ENABLED="true",
                           ZALO_CONTEXT_GATE_OPENROUTER_FALLBACK_ENABLED="true")
        with patch.object(gate, "_request_sync", side_effect=[TimeoutError(), 0.1]) as request:
            self.assertFalse(await gate.should_respond(**self.args))
        self.assertEqual(request.call_count, 2)

    async def test_three_errors_still_fail_closed(self):
        self.values.update(ZALO_CONTEXT_GATE_FALLBACK_ENABLED="true",
                           ZALO_CONTEXT_GATE_OPENROUTER_FALLBACK_ENABLED="true")
        with patch.object(gate, "_request_sync", side_effect=TimeoutError()) as request:
            self.assertFalse(await gate.should_respond(**self.args))
        self.assertEqual(request.call_count, 3)

    async def test_third_stage_reserves_time_within_shared_deadline(self):
        self.values.update(ZALO_CONTEXT_GATE_FALLBACK_ENABLED="true",
                           ZALO_CONTEXT_GATE_OPENROUTER_FALLBACK_ENABLED="true")
        from types import SimpleNamespace
        clock = [100.0]
        budgets = []
        async def consume_budget(fn, **kwargs):
            budgets.append(kwargs["timeout_s"])
            if len(budgets) < 3:
                clock[0] += kwargs["timeout_s"]
                raise TimeoutError()
            return 0.9
        # Assert the real 8-second budget directly; millisecond wall-clock
        # deadlines test scheduler load rather than the allocation invariant.
        with patch.object(gate.asyncio, "get_running_loop", return_value=SimpleNamespace(time=lambda: clock[0])), \
                patch.object(gate.asyncio, "to_thread", side_effect=consume_budget):
            self.assertTrue(await gate.should_respond(**self.args))
        self.assertEqual(budgets, [3.0, 3.0, 2.0])

    async def test_openrouter_primary_is_not_retried_as_third_stage(self):
        self.values.update(ZALO_CONTEXT_GATE_FALLBACK_ENABLED="true",
                           ZALO_CONTEXT_GATE_OPENROUTER_FALLBACK_ENABLED="true",
                           ZALO_CONTEXT_GATE_BASE_URL="https://openrouter.ai/api/v1",
                           ZALO_CONTEXT_GATE_MODEL="typesafe/jev-1.14")
        with patch.object(gate, "_request_sync", side_effect=TimeoutError()) as request:
            self.assertFalse(await gate.should_respond(**self.args))
        self.assertEqual(request.call_count, 2)


if __name__ == "__main__":
    unittest.main()
