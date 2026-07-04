# IRIS Whisper transcription

Server-side speech-to-text via [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
(CTranslate2, CPU int8). The Node server spawns `transcribe.py` as a child process.

## Setup (one-time per machine)

```
cd server/whisper
python -m venv .venv            # Python 3.13
.venv\Scripts\pip install faster-whisper
```

The first transcription with a given model downloads it to the HuggingFace cache
(`%USERPROFILE%\.cache\huggingface\hub`); `large-v3` is ~2.9 GB.

### Windows CRT fix (required on machines with an old VC++ runtime)

CTranslate2 wheels (4.6+) are built with a recent MSVC toolset. If the machine's
`C:\Windows\System32\MSVCP140.dll` is older than ~14.40 (this laptop shipped
14.31), **loading any Whisper model crashes with an access violation** (Windows
Event Log: faulting module `MSVCP140.dll`). Python resolves extension-module
DLL dependencies from the *package* directory + System32 — so the no-admin fix
is to place a newer CRT next to the native modules (already applied here,
sourced from Microsoft Edge's bundled 14.50 runtime):

```
copy msvcp140.dll vcruntime140.dll vcruntime140_1.dll  → .venv\Lib\site-packages\ctranslate2\
                                                       → .venv\Lib\site-packages\onnxruntime\capi\
```

(Installing the latest "Visual C++ 2015-2022 Redistributable x64" system-wide
fixes it globally but needs admin.) Verified 2026-07-03: large-v3 transcribes a
15 s sample in ~67 s on this CPU (i5-1335U, int8), including model load.

## CLI contract

```
.venv\Scripts\python.exe transcribe.py <audioFile> [--language en|hi|<code>] [--model <name>]
```

- Prints exactly one JSON object to stdout:
  `{"engine": "whisper-<model>", "language": "<detected>", "durationSecs": <float>,
    "segments": [{"start": <s>, "end": <s>, "text": "<trimmed>"}]}`
- All logging goes to stderr.
- Exit 0 on success; non-zero with `{"error": "..."}` on stdout on failure.
- Model resolution: `--model` flag, else `WHISPER_MODEL` env, else `large-v3`.
- `--language` omitted or `auto` → Whisper auto-detect (handles Hindi–English code-switching).
- Input formats: anything PyAV/FFmpeg decodes — wav, webm/opus, mp3, m4a, ogg. No system ffmpeg needed.
