from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any


current_process: subprocess.Popen[str] | None = None
cancelled = False

DEMUCS_PROFILES: dict[str, tuple[str, str | None]] = {
    "vocals": ("htdemucs", "vocals"),
    "vocals-ft": ("htdemucs_ft", "vocals"),
    "vocals-mdx": ("mdx_extra", "vocals"),
    "four-stems": ("htdemucs", None),
    "four-stems-ft": ("htdemucs_ft", None),
    "four-stems-mdx": ("mdx_extra", None),
    "six-stems": ("htdemucs_6s", None),
    "drums": ("htdemucs", "drums"),
    "bass": ("htdemucs", "bass"),
    "guitar": ("htdemucs_6s", "guitar"),
    "piano": ("htdemucs_6s", "piano"),
    "other": ("htdemucs", "other"),
}

AUDIOSEP_QUERIES: dict[str, str] = {
    "percussion": "percussion instruments",
    "trumpet": "trumpet",
    "keyboards": "musical keyboards",
    "synthesizer": "synthesizer",
    "violin": "violin",
    "acoustic-guitar": "acoustic guitar",
}


def emit(event: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def handle_signal(_signum: int, _frame: Any) -> None:
    global cancelled
    cancelled = True
    if current_process is not None and current_process.poll() is None:
        current_process.terminate()


def check_dependencies() -> int:
    try:
        import demucs  # noqa: F401
        import torch  # noqa: F401
    except ImportError:
        return 1
    ffmpeg = os.environ.get("OPENSEP_FFMPEG", "ffmpeg")
    ffprobe = os.environ.get("OPENSEP_FFPROBE", "ffprobe")
    return 0 if shutil.which(ffmpeg) and shutil.which(ffprobe) else 1


def audiosep_available() -> bool:
    python = Path(os.environ.get("OPENSEP_AUDIOSEP_PYTHON", ""))
    root = Path(os.environ.get("OPENSEP_AUDIOSEP_ROOT", ""))
    adapter = Path(os.environ.get("OPENSEP_AUDIOSEP_ADAPTER", ""))
    return python.is_file() and root.is_dir() and adapter.is_file()


def run_command(arguments: list[str], progress_start: int, progress_end: int, message: str) -> None:
    global current_process
    current_process = subprocess.Popen(
        arguments,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
    )
    assert current_process.stdout is not None
    progress = progress_start
    emit({"type": "progress", "stage": "processing", "progress": progress, "message": message})
    for line in current_process.stdout:
        if cancelled:
            break
        if line.strip():
            progress = min(progress_end - 1, progress + 1)
            emit({"type": "progress", "stage": "processing", "progress": progress, "message": message})
    code = current_process.wait()
    current_process = None
    if cancelled:
        raise InterruptedError("Job cancelled")
    if code != 0:
        raise RuntimeError(f"Processor command failed with exit code {code}")


def encoding_options(output_format: str) -> tuple[str, str, list[str]]:
    formats: dict[str, tuple[str, str, list[str]]] = {
        "mp3-320": ("mp3", "audio/mpeg", ["-codec:a", "libmp3lame", "-b:a", "320k"]),
        "wav-16": ("wav", "audio/wav", ["-codec:a", "pcm_s16le"]),
        "wav-32": ("wav", "audio/wav", ["-codec:a", "pcm_f32le"]),
        "flac-16": ("flac", "audio/flac", ["-codec:a", "flac", "-sample_fmt", "s16"]),
        "flac-24": ("flac", "audio/flac", ["-codec:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24"]),
        "m4a": ("m4a", "audio/mp4", ["-codec:a", "aac", "-b:a", "256k"]),
    }
    if output_format not in formats:
        raise ValueError(f"Unsupported output format: {output_format}")
    return formats[output_format]


def process(manifest_path: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("protocolVersion") != 1:
        raise ValueError("Unsupported worker protocol version")

    input_path = Path(manifest["inputPath"]).resolve(strict=True)
    work_dir = Path(manifest["workDir"]).resolve()
    results_dir = Path(manifest["resultsDir"]).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    results_dir.mkdir(parents=True, exist_ok=True)
    profile = manifest["profileId"]
    output_format = manifest["outputFormat"]

    emit({"type": "ready"})
    if profile in DEMUCS_PROFILES:
        model, target_stem = DEMUCS_PROFILES[profile]
        arguments = [sys.executable, "-m", "demucs.separate", "-n", model, "-o", str(work_dir)]
        if target_stem is not None:
            arguments.extend(["--two-stems", target_stem])
        arguments.append(str(input_path))
        run_command(arguments, 8, 78, "Separando las pistas")
        source_dir = work_dir / model / input_path.stem
    elif profile in AUDIOSEP_QUERIES:
        if not audiosep_available():
            raise RuntimeError("AudioSep no está instalado. Ejecuta Instalar-OpenSep.cmd en esta PC.")
        source_dir = work_dir / "audiosep" / input_path.stem
        source_dir.mkdir(parents=True, exist_ok=True)
        arguments = [
            os.environ["OPENSEP_AUDIOSEP_PYTHON"],
            os.environ["OPENSEP_AUDIOSEP_ADAPTER"],
            "--root", os.environ["OPENSEP_AUDIOSEP_ROOT"],
            "--input", str(input_path),
            "--output-dir", str(source_dir),
            "--stem", profile,
            "--query", AUDIOSEP_QUERIES[profile],
            "--ffmpeg", os.environ.get("OPENSEP_FFMPEG", "ffmpeg"),
        ]
        run_command(arguments, 8, 78, f"Separando {profile} con AudioSep")
    else:
        raise ValueError(f"Unsupported separation profile: {profile}")

    source_files = sorted(source_dir.glob("*.wav"))
    if not source_files:
        raise RuntimeError("Demucs did not produce any stems")

    extension, mime, codec_options = encoding_options(output_format)
    total = len(source_files)
    for index, source in enumerate(source_files):
        if cancelled:
            raise InterruptedError("Job cancelled")
        if source.stem.startswith("no_"):
            stem = "instrumental" if profile.startswith("vocals") else ("remainder" if profile == "other" else "other")
        else:
            stem = source.stem
        output_path = results_dir / f"{stem}.{extension}"
        progress = 80 + int(index / max(total, 1) * 18)
        emit({"type": "progress", "stage": "encoding", "progress": progress, "message": f"Codificando {stem}"})
        global current_process
        current_process = subprocess.Popen(
            [os.environ.get("OPENSEP_FFMPEG", "ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), *codec_options, str(output_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            shell=False,
        )
        _, stderr = current_process.communicate()
        code = current_process.returncode
        current_process = None
        if cancelled:
            raise InterruptedError("Job cancelled")
        if code != 0:
            raise RuntimeError(f"FFmpeg failed for {stem}: {stderr[-500:]}")
        emit({"type": "artifact", "stem": stem, "path": str(output_path), "mime": mime})

    emit({"type": "progress", "stage": "encoding", "progress": 99, "message": "Finalizando resultados"})
    emit({"type": "completed"})


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenSep Demucs worker")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--check-audiosep", action="store_true")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    if args.check:
        return check_dependencies()
    if args.check_audiosep:
        return 0 if audiosep_available() else 1
    if args.manifest is None:
        parser.error("--manifest is required")

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    try:
        process(args.manifest)
        return 0
    except InterruptedError:
        return 130
    except Exception as error:
        emit({"type": "error", "code": "PROCESSING_FAILED", "message": str(error)[:500]})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
