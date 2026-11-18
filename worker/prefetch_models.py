from __future__ import annotations

import argparse

from demucs.pretrained import get_model


def main() -> int:
    parser = argparse.ArgumentParser(description="Download and validate OpenSep Demucs models")
    parser.add_argument("models", nargs="+")
    args = parser.parse_args()
    for model_name in args.models:
        print(f"Preparando {model_name}...", flush=True)
        get_model(name=model_name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

