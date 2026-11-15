from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenSep AudioSep adapter")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--stem", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--ffmpeg", required=True)
    args = parser.parse_args()

    root = args.root.resolve(strict=True)
    checkpoint = root / "checkpoint" / "audiosep_base_4M_steps.ckpt"
    config = root / "config" / "audiosep_base.yaml"
    if not checkpoint.is_file():
        raise RuntimeError("Falta el checkpoint de AudioSep. Ejecuta Instalar-OpenSep.cmd.")

    sys.path.insert(0, str(root))
    os.chdir(root)
    import torch
    from pipeline import build_audiosep, inference

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_audiosep(str(config), str(checkpoint), device)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    target = args.output_dir / f"{args.stem}.wav"
    other = args.output_dir / "other.wav"
    inference(model, str(args.input.resolve(strict=True)), args.query, str(target), device, use_chunk=True)

    subtraction = (
        "[0:a]aformat=sample_rates=32000:channel_layouts=mono[original];"
        "[1:a]aformat=sample_rates=32000:channel_layouts=mono[target];"
        "[original][target]amix=inputs=2:weights='1 -1':normalize=0[out]"
    )
    completed = subprocess.run(
        [args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(args.input), "-i", str(target),
         "-filter_complex", subtraction, "-map", "[out]", "-c:a", "pcm_s16le", str(other)],
        shell=False,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError("FFmpeg no pudo crear la pista residual de AudioSep")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
