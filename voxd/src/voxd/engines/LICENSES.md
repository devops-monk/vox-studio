# Engine & model licenses

Every engine voxd can use, and the license of the model or tool behind it.
Add a row here before merging a new engine.

| Engine id | Model / tool | License | Source |
|---|---|---|---|
| `system` | OS speech (macOS `say`, `espeak-ng` on Linux) | Provided by the OS / GPL-3.0 (espeak-ng, invoked as a separate program, not linked) | Built in |
| `kokoro` | Kokoro-82M weights (downloaded on request) | Apache-2.0 | https://huggingface.co/hexgrad/Kokoro-82M |
| `kokoro` | `kokoro-onnx` runtime wrapper (Python dependency) | MIT | https://github.com/thewh1teagle/kokoro-onnx |
| `kokoro` | ONNX Runtime (Python dependency) | MIT | https://github.com/microsoft/onnxruntime |
| `kokoro` | `phonemizer` + `espeakng-loader` for phonemes (Python dependencies, fetched when voxd's runtime is installed) | GPL-3.0 / GPL-3.0 | https://github.com/bootphon/phonemizer · https://github.com/thewh1teagle/espeakng-loader |
| `chatterbox` | Chatterbox weights (ResembleAI/chatterbox, pinned commit; downloaded on request) | MIT | https://huggingface.co/ResembleAI/chatterbox |
| `chatterbox` | `chatterbox-tts` + PyTorch + `resemble-perth` watermarker (installed into an isolated runtime on request) | MIT / BSD-3 / MIT | https://github.com/resemble-ai/chatterbox |
| `whisper` | Whisper weights, CTranslate2 conversions (Systran/faster-whisper-base, -small; dropbox-dash/faster-whisper-large-v3-turbo; pinned commits) | MIT | https://huggingface.co/Systran |
| `whisper` | `faster-whisper` + CTranslate2 + PyAV (FFmpeg, LGPL build) in an isolated runtime | MIT / MIT / BSD (LGPL FFmpeg libs) | https://github.com/SYSTRAN/faster-whisper |
| (dubbing) | Argos Translate packages, 9 languages via English (downloaded on request, SHA-256 pinned) | MIT / CC0 (Argos); trained on OPUS corpora | https://github.com/argosopentech/argos-translate |
| (dubbing) | SentencePiece (in the Whisper runtime) | Apache-2.0 | https://github.com/google/sentencepiece |
| (dubbing) | CAM++ speaker-embedding model from 3D-Speaker (VoxCeleb, ONNX export by sherpa-onnx; downloaded on first use, SHA-256 pinned) | Apache-2.0 | https://github.com/modelscope/3D-Speaker |
| (dubbing) | Hybrid Transformer Demucs weights (`htdemucs`, SHA-256 pinned) + `demucs` 4.0.1 and PyTorch in an isolated runtime, on request | MIT / BSD-3 | https://github.com/facebookresearch/demucs |

> **Note on GPL components:** `phonemizer` and the espeak-ng library are installed into voxd's runtime by `uv` on the user's machine; they are not part of VoxStudio's source or app bundle. If a future release starts **bundling** the Python runtime (M16 packaging), review this — either ship those components' source per GPL-3.0 or switch to a permissively-licensed phonemizer.
