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

> **Note on GPL components:** `phonemizer` and the espeak-ng library are installed into voxd's runtime by `uv` on the user's machine; they are not part of VoxStudio's source or app bundle. If a future release starts **bundling** the Python runtime (M16 packaging), review this — either ship those components' source per GPL-3.0 or switch to a permissively-licensed phonemizer.
