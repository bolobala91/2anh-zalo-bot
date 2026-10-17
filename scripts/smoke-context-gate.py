"""Opt-in live classifier smoke using synthetic text and the plugin's transport.

Run with Hermes' Python (python, not python3), and its source on PYTHONPATH.
Never loads messages/history or changes config. No secrets are printed.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import time

from agent.secret_scope import load_env_file


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-home", type=Path, required=True)
    parser.add_argument("--plugin-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] / "hermes-plugin/zalo")
    parser.add_argument("--provider", choices=("configured", "jev-9router", "openrouter-jev", "gemma-31b", "gemma-26b", "gemini-9router", "gemini-cli"),
                        default="configured")
    args = parser.parse_args()
    scope = load_env_file(args.profile_home / ".env")
    spec = importlib.util.spec_from_file_location("context_gate_smoke", args.plugin_dir / "context_gate.py")
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    extra = gate.settings({}, scope.get)
    if args.provider != "configured":
        extra["context_gate_classifier"] = "jev-openrouter" if args.provider == "openrouter-jev" else args.provider
    extra = gate.resolved_settings(extra, scope.get)
    model = extra.get("context_gate_model", gate.DEFAULT_MODEL)
    endpoint = extra.get("context_gate_base_url", gate.DEFAULT_BASE_URL).rstrip("/")
    endpoint += "/chat/completions" if model in gate.CHAT_MODELS else "/systemone"
    recent = [{"sender_uid": "test-user", "text": "Tuấn xem giúp kế hoạch này.", "age_seconds": 20},
              {"sender_uid": "test-bot", "text": "Bạn muốn mình xem phần nào trước?", "age_seconds": 10,
               "reply_to_sender_uid": "test-user"}]
    cases = [("followup", "Làm phần ngân sách trước nhé.", recent, True, {}),
             ("unrelated", "Ai đặt bàn chưa?",
              [{"sender_uid": "test-other", "text": "Tối nay cả nhóm đi ăn nhé."}], False, {}),
             ("duplicate_name_ambiguous", "Tuấn ơi, đặt bàn chưa?", [], False,
              {"text_matches_call_word": True, "other_members_share_bot_name": True, "name_roster_complete": True}),
             ("duplicate_name_bot_uid", "Tuấn ơi, xem giúp kế hoạch này.", [], True,
              {"tagged_bot": True, "other_members_share_bot_name": True, "name_roster_complete": True}),
             ("duplicate_name_other_uid", "Tuấn ơi, đặt bàn chưa?", [], False,
              {"mentions_other": True, "other_members_share_bot_name": True, "name_roster_complete": True})]
    failed = False
    for label, text, history, expected, addressing in cases:
        started = time.monotonic()
        try:
            state = gate._state(text=text, sender_uid="test-user", sender_name="Người thử",
                                bot_uid="test-bot", bot_name="Tuấn MKT", quote_is_own=False, recent=history, addressing=addressing)
            p = gate._request_sync(extra=extra, state=state, get_secret=scope.get)
            threshold = float(extra.get("context_gate_threshold", gate.DEFAULT_THRESHOLD))
            passed = (p >= threshold) == expected
            print(json.dumps({"case": label, "endpoint": endpoint, "model": model,
                              "probability": p, "threshold": threshold, "passed": passed,
                              "seconds": round(time.monotonic() - started, 2)}))
            failed |= not passed
        except Exception as error:
            # Do not print exception messages, headers, bodies, state, or credentials.
            print(json.dumps({"case": label, "endpoint": endpoint, "model": model,
                              "status": "unavailable", "error_type": type(error).__name__}))
            failed = True
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
