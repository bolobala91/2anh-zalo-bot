"""Run identical synthetic, labeled conversations against selected context models."""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
import time
from typing import Any, Callable, Iterable
from urllib.parse import urlsplit


BOT = "synthetic-bot"
OWNER = "synthetic-owner"
MEMBER = "synthetic-member"


def _message(message_id, sender, text, *, reply_to_sender_uid=None):
    row = {"id": message_id, "sender_uid": sender,
           "sender_name": "Tuấn MKT" if sender == BOT else "Người thử", "text": text}
    if reply_to_sender_uid:
        row["reply_to_sender_uid"] = reply_to_sender_uid
    return row


CASES = (
    {"id": "tag-bot", "expected": {"category": "addressed_to_bot", "evidence_ref": None},
     "text": "Xem giúp mình kế hoạch này.", "sender": MEMBER,
     "addressing": {"tagged_bot": True}},
    {"id": "owner-call", "expected": {"category": "addressed_to_bot", "evidence_ref": None},
     "text": "Tuấn MKT ơi, xem giúp kế hoạch.", "sender": OWNER,
     "addressing": {"text_matches_call_word": True}},
    {"id": "reply-bot", "expected": {"category": "addressed_to_bot", "evidence_ref": None},
     "text": "Làm phần ngân sách trước nhé.", "sender": MEMBER, "quote_is_own": True,
     "recent": [_message("bot-question", BOT, "Bạn muốn mình xem phần nào trước?",
                          reply_to_sender_uid=MEMBER)]},
    {"id": "same-speaker-follow-up", "expected": {"category": "follow_up", "evidence_ref": "m2"},
     "text": "Làm phần ngân sách trước nhé.", "sender": MEMBER,
     "recent": [_message("earlier-bot-note", BOT, "Mình đã mở kế hoạch."),
                _message("request", MEMBER, "Tuấn xem giúp kế hoạch này."),
                _message("question", BOT, "Bạn muốn mình xem phần nào trước?",
                         reply_to_sender_uid=MEMBER)]},
    {"id": "other-member-continues-bot", "expected": {"category": "follow_up", "evidence_ref": "m1"},
     "text": "Làm tiếp phần ngân sách đi.", "sender": "synthetic-member-2",
     "recent": [_message("request", MEMBER, "Bot xem giúp kế hoạch."),
                _message("question", BOT, "Mọi người muốn xem phần nào trước?",
                         reply_to_sender_uid=MEMBER)]},
    {"id": "member-dinner-chat", "expected": {"category": "member_conversation", "evidence_ref": None},
     "text": "Ai đặt bàn chưa?", "sender": MEMBER,
     "recent": [_message("dinner", "synthetic-member-2", "Tối nay mình đi ăn nhé.")]},
    {"id": "new-topic-after-bot", "expected": {"category": "new_topic", "evidence_ref": None},
     "text": "Hôm nay mọi người ăn ở đâu?", "sender": MEMBER,
     "recent": [_message("old-answer", BOT, "Kế hoạch ngân sách đã được cập nhật.",
                          reply_to_sender_uid=MEMBER)]},
    {"id": "marketing-topic-not-addressed", "expected": {"category": "member_conversation", "evidence_ref": None},
     "text": "Mọi người thấy chiến dịch này nên chạy kênh nào?", "sender": MEMBER,
     "recent": [_message("marketing", "synthetic-member-2", "Đang bàn về chiến dịch tháng này.")]},
    {"id": "duplicate-name-ambiguous", "expected": {"category": "ambiguous", "evidence_ref": None},
     "text": "Tuấn ơi, xem giúp mình nhé.", "sender": MEMBER,
     "addressing": {"other_members_share_bot_name": True,
                    "name_roster_complete": True}},
    {"id": "tag-other-member", "expected": {"category": "member_conversation", "evidence_ref": None},
     "text": "Bình xem giúp mình nhé.", "sender": MEMBER,
     "addressing": {"mentions_other": True}},
)


def state_for_case(gate, case: dict[str, Any]) -> dict[str, Any]:
    return gate._state(
        text=case["text"], sender_uid=case["sender"],
        sender_name="Người thử", bot_uid=BOT, bot_name="Tuấn MKT",
        quote_is_own=case.get("quote_is_own", False), recent=case.get("recent", ()),
        addressing=case.get("addressing", {}),
    )


def run_benchmark(*, gate, models: Iterable[str], get_secret: Callable,
                  cases: Iterable[dict[str, Any]] = CASES, clock=time.monotonic) -> dict[str, Any]:
    cases = tuple(cases)
    plans = []
    for selected in models:
        if selected == "configured":
            extra = gate.settings({}, get_secret)
        else:
            if selected not in gate.CLASSIFIERS:
                raise ValueError("unsupported benchmark model")
            base_url, model, key_env = gate.CLASSIFIERS[selected]
            extra = {"context_gate_classifier": "configured", "context_gate_base_url": base_url,
                     "context_gate_model": model, "context_gate_key_env": key_env}
        resolved = gate.resolved_settings(extra, get_secret)
        extra.update(context_gate_fallback_enabled="false", context_gate_openrouter_fallback_enabled="false")
        model_name = resolved.get("context_gate_model", gate.DEFAULT_MODEL)
        base_url = resolved.get("context_gate_base_url", gate.DEFAULT_BASE_URL)
        host = urlsplit(base_url).hostname
        if host == "openrouter.ai":
            provider = "openrouter"
        elif base_url == gate.DEFAULT_BASE_URL:
            provider = "9router"
        elif base_url == gate.CLI_BASE_URL:
            provider = "cli"
        else:
            provider = "custom"
        plans.extend((selected, model_name, provider, extra, case) for case in cases)

    async def run_cases():
        results = []
        for selected, model_name, provider, extra, case in plans:
            started = clock()
            row = {"model_key": selected, "model": model_name, "provider": provider,
                   "case_id": case["id"], "expected": case["expected"],
                   "duration_ms": None, "status": "error"}
            try:
                state = state_for_case(gate, case)
                result = await asyncio.wait_for(
                    asyncio.to_thread(gate._request_sync, extra=extra, state=state,
                                      get_secret=get_secret, timeout_s=gate.TIMEOUT_S),
                    timeout=gate.TIMEOUT_S,
                )
                row.update(status="ok", actual=result)
            except Exception as error:
                # Error types only. Never print provider responses, paths, or credentials.
                row["error_type"] = type(error).__name__
            finally:
                row["duration_ms"] = max(0, round((clock() - started) * 1000))
            results.append(row)
        return results

    return {"sample_count": len(cases), "results": asyncio.run(run_cases())}


def summarize(report: dict[str, Any]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in report.get("results", []):
        groups.setdefault(row["model_key"], []).append(row)
    output = []
    for model_key, rows in groups.items():
        ok = [row for row in rows if row.get("status") == "ok"]
        exact = [row for row in ok if row.get("actual") == row.get("expected")]
        followups = [row for row in rows if row["expected"]["category"] == "follow_up"]
        followup_correct = [row for row in followups if row.get("actual") == row["expected"]]
        negatives = [row for row in rows if row["expected"]["category"] not in {"addressed_to_bot", "follow_up"}]
        routing_correct = [row for row in rows if (
            row["expected"]["category"] in {"addressed_to_bot", "follow_up"}
        ) == (
            row.get("actual", {}).get("category") in {"addressed_to_bot", "follow_up"}
        )]
        predicted_responses = [row for row in ok if row["actual"]["category"] in {"addressed_to_bot", "follow_up"}]
        false_positives = [row for row in negatives if row.get("actual", {}).get("category") in {"addressed_to_bot", "follow_up"}]
        true_positives = [row for row in predicted_responses
                          if row["expected"]["category"] in {"addressed_to_bot", "follow_up"}]
        per_category = {}
        for category in sorted({row["expected"]["category"] for row in rows}):
            sample = [row for row in rows if row["expected"]["category"] == category]
            matched = [row for row in sample if row.get("actual") == row["expected"]]
            per_category[category] = {"correct": len(matched), "total": len(sample)}
        durations = sorted(row["duration_ms"] for row in rows if isinstance(row.get("duration_ms"), int))
        output.append({
            "model_key": model_key,
            "model": rows[0].get("model"),
            "provider": rows[0].get("provider"),
            "samples": len(rows),
            "successful": len(ok),
            "errors": len(rows) - len(ok),
            "exact_accuracy": len(exact) / len(rows) if rows else None,
            "routing_accuracy": len(routing_correct) / len(rows) if rows else None,
            "follow_up_recall": len(followup_correct) / len(followups) if followups else None,
            "response_precision": len(true_positives) / len(predicted_responses) if predicted_responses else None,
            "false_positive_rate": len(false_positives) / len(negatives) if negatives else None,
            "avg_ms": round(sum(durations) / len(durations)) if durations else None,
            "p95_ms": durations[max(0, (95 * len(durations) + 99) // 100 - 1)] if durations else None,
            "by_category": per_category,
        })
    return {"sample_count": report.get("sample_count", 0), "models": output}


def _load_gate(plugin_dir: Path):
    spec = importlib.util.spec_from_file_location("context_gate_benchmark_target", plugin_dir / "context_gate.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("context gate module unavailable")
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    return gate


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-home", type=Path, required=True)
    parser.add_argument("--plugin-dir", type=Path, default=Path(__file__).resolve().parents[1] / "hermes-plugin/zalo")
    parser.add_argument("--models", nargs="+", choices=("configured", "jev-9router", "jev-openrouter", "gemma-26b",
                        "gemma-31b", "gemini-9router", "gemini-cli"), required=True)
    args = parser.parse_args(argv)
    try:
        from agent.secret_scope import load_env_file
        scope = load_env_file(args.profile_home / ".env")
        gate = _load_gate(args.plugin_dir)
        report = run_benchmark(gate=gate, models=args.models, get_secret=scope.get)
        result = summarize(report)
        # Per-case output contains only fixture IDs, labels and timing; no message text or keys.
        cases = []
        for case in CASES:
            rows = [row for row in report["results"] if row["case_id"] == case["id"]]
            cases.append({"case_id": case["id"], "expected": case["expected"], "results": [
                {"model_key": row["model_key"], "model": row["model"], "status": row["status"],
                 "actual": row.get("actual"), "error_type": row.get("error_type"),
                 "duration_ms": row["duration_ms"]} for row in rows
            ]})
        print(json.dumps({**result, "cases": cases}, ensure_ascii=False, indent=2))
        return int(any(model["successful"] != model["samples"] for model in result["models"]))
    except Exception as error:
        print(json.dumps({"status": "unavailable", "error_type": type(error).__name__}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
