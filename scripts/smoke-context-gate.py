"""Backward-compatible single-model wrapper for the shared context benchmark."""
import argparse
from pathlib import Path

from context_gate_benchmark import main as benchmark_main


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-home", type=Path, required=True)
    parser.add_argument("--plugin-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] / "hermes-plugin/zalo")
    parser.add_argument("--provider", choices=("configured", "jev-9router", "openrouter-jev", "gemma-31b",
                        "gemma-26b", "gemini-9router", "gemini-cli"), default="configured")
    args = parser.parse_args()
    model = "jev-openrouter" if args.provider == "openrouter-jev" else args.provider
    return benchmark_main(["--profile-home", str(args.profile_home), "--plugin-dir", str(args.plugin_dir),
                           "--models", model])


if __name__ == "__main__":
    raise SystemExit(main())
