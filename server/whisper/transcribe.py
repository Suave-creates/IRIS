"""IRIS meeting transcription CLI.

Usage:
    python transcribe.py <audioFile> [--language en|hi|<code>] [--model <name>]

Prints exactly one JSON object to stdout:
    {"engine": "whisper-<model>", "language": "<detected>", "durationSecs": <float>,
     "segments": [{"start": <float s>, "end": <float s>, "text": "<trimmed>"}]}

All logging/progress goes to stderr. Exit code 0 on success; on failure a JSON
object {"error": "..."} is printed to stdout and the exit code is non-zero.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def fail(message: str) -> None:
    print(json.dumps({"error": message}), flush=True)
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("audio_file")
    parser.add_argument("--language", default=None)
    parser.add_argument("--model", default=None)
    try:
        args = parser.parse_args()
    except SystemExit:
        fail("Invalid arguments. Usage: transcribe.py <audioFile> [--language <code>] [--model <name>]")
        return

    audio_path = args.audio_file
    if not os.path.isfile(audio_path):
        fail(f"Audio file not found: {audio_path}")
        return

    model_name = args.model or os.environ.get("WHISPER_MODEL") or "large-v3"
    language = args.language
    if language is not None and language.strip().lower() in ("", "auto"):
        language = None

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # noqa: BLE001 - report any import failure verbatim
        fail(f"faster-whisper import failed: {exc}")
        return

    log(f"Loading model '{model_name}' (device=cpu, compute_type=int8)...")
    load_start = time.perf_counter()
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
    except Exception as exc:  # noqa: BLE001
        fail(f"Model load failed for '{model_name}': {exc}")
        return
    load_secs = time.perf_counter() - load_start
    log(f"Model loaded in {load_secs:.1f}s")

    log(f"Transcribing '{audio_path}' (language={language or 'auto'})...")
    transcribe_start = time.perf_counter()
    try:
        segments_iter, info = model.transcribe(
            audio_path,
            language=language,
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=True,
            word_timestamps=False,
        )
        segments = []
        for seg in segments_iter:
            text = seg.text.strip()
            if not text:
                continue
            segments.append({
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": text,
            })
            log(f"  [{seg.start:8.2f} -> {seg.end:8.2f}] {text}")
    except Exception as exc:  # noqa: BLE001
        fail(f"Transcription failed: {exc}")
        return
    transcribe_secs = time.perf_counter() - transcribe_start
    log(f"Transcription finished in {transcribe_secs:.1f}s ({len(segments)} segments)")

    duration = float(getattr(info, "duration", 0.0) or 0.0)
    if duration <= 0.0 and segments:
        duration = segments[-1]["end"]

    result = {
        "engine": f"whisper-{model_name}",
        "language": info.language or (language or "unknown"),
        "durationSecs": round(duration, 3),
        "segments": segments,
    }
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
