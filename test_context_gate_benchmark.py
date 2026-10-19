import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

gate_spec = importlib.util.spec_from_file_location(
    "benchmark_gate_under_test", Path(__file__).parent / "hermes-plugin/zalo/context_gate.py")
gate = importlib.util.module_from_spec(gate_spec)
gate_spec.loader.exec_module(gate)
benchmark_spec = importlib.util.spec_from_file_location(
    "context_gate_benchmark_under_test", Path(__file__).parent / "scripts/context_gate_benchmark.py")
benchmark = importlib.util.module_from_spec(benchmark_spec)
benchmark_spec.loader.exec_module(benchmark)


class ContextGateBenchmarkTest(unittest.TestCase):
    def test_fixture_covers_each_decision_class_with_only_synthetic_ids(self):
        cases = benchmark.CASES
        categories = {row["expected"]["category"] for row in cases}
        self.assertEqual(categories, set(gate.CATEGORIES))
        self.assertEqual(len({row["id"] for row in cases}), len(cases))
        for case in cases:
            self.assertTrue(case["sender"].startswith("synthetic-") or case["sender"] == "synthetic-owner")
            self.assertFalse(any("@" in str(value) for value in case.values()))

    def test_every_selected_model_gets_the_same_labeled_cases_and_metrics_separate_quality_from_latency(self):
        states = []
        def classify(*, extra, state, get_secret, timeout_s=None):
            self.assertEqual(extra["context_gate_fallback_enabled"], "false")
            self.assertEqual(extra["context_gate_openrouter_fallback_enabled"], "false")
            states.append((extra["context_gate_model"], state))
            case_index = (len(states) - 1) % len(benchmark.CASES)
            expected = benchmark.CASES[case_index]["expected"]
            if extra["context_gate_model"] == "openrouter/typesafe/jev-1.13" and case_index == 3:
                return {"category": "follow_up", "evidence_ref": "m0"}
            return expected

        clock = iter([float(i) for i in range(40)])
        with patch.object(gate, "_request_sync", side_effect=classify):
            report = benchmark.run_benchmark(gate=gate, models=("jev-9router", "gemma-26b"),
                                             get_secret=lambda name, default=None: default,
                                             clock=lambda: next(clock))
        self.assertEqual(report["sample_count"], len(benchmark.CASES))
        self.assertEqual(len(states), len(benchmark.CASES) * 2)
        for i in range(len(benchmark.CASES)):
            self.assertEqual(states[i][1], states[i + len(benchmark.CASES)][1])
        summary = benchmark.summarize(report)
        self.assertEqual([row["model_key"] for row in summary["models"]], ["jev-9router", "gemma-26b"])
        self.assertEqual(summary["models"][0]["samples"], len(benchmark.CASES))
        self.assertEqual(summary["models"][0]["follow_up_recall"], 0.5)
        self.assertLess(summary["models"][0]["exact_accuracy"], summary["models"][1]["exact_accuracy"])
        self.assertEqual(summary["models"][0]["routing_accuracy"], 1.0)
        self.assertEqual(summary["models"][0]["avg_ms"], summary["models"][1]["avg_ms"])
        self.assertEqual(summary["models"][0]["false_positive_rate"], 0)


if __name__ == "__main__":
    unittest.main()
