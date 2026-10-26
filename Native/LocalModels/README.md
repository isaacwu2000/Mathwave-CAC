# Native custom models

This bridge runs the trained speech and language models inside the app process.
Inference loads local files and makes no network requests. Python is used only
for exporting the training adapters, never by the app.

## Files and builds

- `mathwave_models.h`: the C interface imported by Swift. Each returned text or
  error string must be released with `mw_string_free`.
- `mathwave_models.cpp`: opaque model handles, English speech recognition, greedy
  language decoding, cancellation and per-request state clearing.
- `build-runtime.sh`: one shared tensor library for both engines, with embedded
  Metal source. Sources, object files and archives stay in ignored `work/`.
- `export-models.py`: merges the selected trained adapters into the pinned cached
  bases, invokes official converters and removes intermediate full models.
- `bridge-test.cpp`: public-interface invalid-input checks and optional actual
  local-model inference. It does not establish application or held-out accuracy.

Run builds from the repository root:

```sh
bash Native/LocalModels/build-runtime.sh macos
bash Native/LocalModels/build-runtime.sh simulator
bash Native/LocalModels/build-runtime.sh device
```

The script accepts `CMAKE=/absolute/path/to/cmake`. All app build paths use the
fixed ignored `work/mathwave-local-runtime` cache. CMake 3.20 or newer and Xcode's
Apple SDKs are required. The existing isolated build environment currently has
CMake 3.31.6. No Metal toolchain download is needed: the official embedded-source
path compiles shader source locally when a model first uses it.

Link `work/mathwave-local-runtime/build-PLATFORM/libmathwave-local-models.a`
with `-lc++ -framework Foundation -framework Metal -framework MetalKit
-framework Accelerate`. Import `mathwave_models.h` using a Clang module or
Swift's `-import-objc-header` option. The static library and framework flags must
match the target platform; an iOS simulator archive cannot link into a device app.
The build compiles one copy of ggml, the numerical tensor library, so the two
engines do not introduce conflicting copies of the same global symbols.

## Export

Use the existing PyTorch/Hugging Face environment with `sentencepiece==0.2.1`
installed for the official language converter:

```sh
Training/STT/.venv/bin/python Native/LocalModels/export-models.py \
  --output work/mathwave-local-runtime/models
```

The output directory must be new. `--only llm` or `--only stt` exports one model;
`--language-format f16` avoids the default Q8_0 language quantization. Q8_0 stores
most weights in eight bits, reducing the language model to about 610 MiB. Speech
uses float16 weights, about 74 MiB. These conversions can change outputs; the
original training scores are not scores for this native runtime.

The export uses selected adapters from:

- `Training/LLM/runs/qwen3-06b-queue-lora-v1-2026-10-23/run/adapter`
- `Training/STT/runs/tiny-en-lora-v2-2026-10-22/adapter`

The `manifest.json` contains SHA256 hashes, source pins and adapter identities.
The app bundle should copy `language.gguf`, `speech.bin`, that manifest and
`MODEL-LICENSES.txt` into its `Models` directory. The base language weights are
Apache 2.0 licensed; the Whisper weights are MIT licensed. These model licenses
remain separate from the app's root MIT license.

The exported weights, manifest and license notices are committed in `Native/Models`.
Install [Git LFS](https://git-lfs.com/) before cloning, then run `git lfs install`
and `git lfs pull` from the repository root to download the weights if needed.
Both `language.gguf` and `speech.bin` use Git LFS. Verify their SHA256 hashes
against `manifest.json` before bundling. Keep downloaded base weights and
intermediate build caches local. To rebuild exports, base weights must already
be cached locally. The only optional export-time download
is OpenAI's small, pinned and SHA256-checked speech mel-filter asset, which maps
frequency measurements into the representation expected by Whisper.

## Runtime contract

Create model handles lazily on a background executor. For language inference,
pass the complete Qwen chat prompt, including the same non-thinking assistant
prefix used during training:

```text
<|im_start|>system
SYSTEM INSTRUCTIONS<|im_end|>
<|im_start|>user
REQUEST JSON<|im_end|>
<|im_start|>assistant
<think>

</think>

```

An 8192-token context and 512 output tokens fit the current app configuration.
Each call clears the previous request's model memory. It refuses excess context
instead of silently truncating instructions. Output ends at a balanced JSON
container or an end token; the existing shared engine must still parse, validate
and execute the proposed DSL. The bridge never applies a mathematical action.

Speech accepts mono 16000 Hz float32 samples for 0.1–30 seconds, English only,
without previous-transcript context. Resample captured audio before calling it.
A handle accepts one inference at a time; concurrent inference returns an error.
iOS Simulator uses CPU inference for both models, even if a caller requests GPU.
Its Metal device can run simple shaders, but the model buffer path traps and its
attention features are incomplete. The simulator uses 512-token physical prompt
batches and ordinary attention to use Accelerate efficiently. Mac and physical
iPhone keep Metal inference with the original 128-token physical batches.

Cancellation may run from another thread. Wait for inference to return before
destroying its handle. Cancellation returns an error rather than partial output.
Metal may finish its current operation before observing cancellation.

## Official source pins

- [llama.cpp](https://github.com/ggml-org/llama.cpp/tree/7894e8b92481a8bb8ffe94f73b656ffe0dd01e10),
  including [the C API](https://github.com/ggml-org/llama.cpp/blob/7894e8b92481a8bb8ffe94f73b656ffe0dd01e10/include/llama.h)
  and [HF converter](https://github.com/ggml-org/llama.cpp/blob/7894e8b92481a8bb8ffe94f73b656ffe0dd01e10/convert_hf_to_gguf.py).
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp/tree/231638a0717b7822784297e5980965ffcec05810),
  including [the C API](https://github.com/ggml-org/whisper.cpp/blob/231638a0717b7822784297e5980965ffcec05810/include/whisper.h)
  and [HF converter](https://github.com/ggml-org/whisper.cpp/blob/231638a0717b7822784297e5980965ffcec05810/models/convert-h5-to-ggml.py).
- [OpenAI Whisper filters](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/assets/mel_filters.npz).

Both upstream engines are MIT licensed. Their fetched source caches include
upstream license files; include those licenses when distributing app binaries.
