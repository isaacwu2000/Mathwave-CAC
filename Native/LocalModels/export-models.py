"""Merge the trained adapters and run the pinned official native converters.

Exports live in ignored work/. Training artifacts and cached base weights remain
unchanged. Intermediate merged Hugging Face weights are removed after conversion.
"""
import argparse
import gc
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LLAMA_REVISION = '7894e8b92481a8bb8ffe94f73b656ffe0dd01e10'
WHISPER_REVISION = '231638a0717b7822784297e5980965ffcec05810'
MEL_REVISION = '86098128c0b4f24f0e2aa2994de830614b474227'
MEL_SHA256 = '7450ae70723a5ef9d341e3cee628c7cb0177f36ce42c44b7ed2bf3325f0f6d4c'
MODELS = {
    'llm': ('Qwen/Qwen3-0.6B', 'c1899de289a04d12100db370d81485cdf75e47ca',
            ROOT/'Training/LLM/runs/qwen3-06b-queue-lora-v1-2026-10-23/run/adapter'),
    'stt': ('openai/whisper-tiny.en', '87c7102498dcde7456f24cfd30239ca606ed9063',
            ROOT/'Training/STT/runs/tiny-en-lora-v2-2026-10-22/adapter'),
}


def digest(path):
    """Hash file bytes in bounded chunks without loading model weights into memory."""
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024*1024), b''):
            value.update(chunk)
    return value.hexdigest()


def export_models(output_directory, cache_directory, only='both', language_format='q8_0'):
    """Export existing trained weights without training or modifying a base cache.

    - Requires exact official source pins and previously cached pinned base models.
    - Merges each adapter separately on CPU; removes its intermediate full weights.
    - Records source/model hashes and conversion precision; refuses output replacement.
    """
    import torch
    from huggingface_hub import hf_hub_download
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, WhisperForConditionalGeneration, WhisperProcessor
    output, cache = Path(output_directory), Path(cache_directory)
    output.mkdir(parents=True, exist_ok=False)
    if shutil.disk_usage(output).free < 4*1024**3:
        raise RuntimeError('Keep at least 4 GiB free before native model export.')
    for name, revision in [('llama.cpp', LLAMA_REVISION), ('whisper.cpp', WHISPER_REVISION)]:
        actual = subprocess.check_output(['git','-C',str(cache/name),'rev-parse','HEAD'],text=True).strip()
        if actual != revision:
            raise RuntimeError(f'{name} differs from pinned native converter revision.')
    report = {'formatVersion': 1, 'startedAtUnix': time.time(), 'llamaRevision': LLAMA_REVISION,
              'whisperRevision': WHISPER_REVISION, 'exports': {},
              'limitations': ['Q8_0 language weights are quantized; previous training metrics do not establish native runtime accuracy.',
                              'Whisper export uses float16 native weights; no audio/quality acceptance implied by conversion.']}
    (output/'export-models.py').write_bytes(Path(__file__).read_bytes())
    shutil.copyfile(ROOT/'Native/LocalModels/MODEL-LICENSES.txt', output/'MODEL-LICENSES.txt')
    try:
        for kind in ('llm','stt'):
            if only not in ('both', kind):
                continue
            model_id, revision, adapter = MODELS[kind]
            config = json.loads((adapter/'adapter_config.json').read_text())
            if config['base_model_name_or_path'] != model_id:
                raise RuntimeError(f'Adapter base mismatch for {kind}.')
            loader = AutoModelForCausalLM if kind == 'llm' else WhisperForConditionalGeneration
            base = loader.from_pretrained(model_id, revision=revision, local_files_only=True, dtype=torch.float16)
            adapted = PeftModel.from_pretrained(base, str(adapter), is_trainable=False)
            merged = adapted.merge_and_unload(safe_merge=True)
            with tempfile.TemporaryDirectory(prefix=f'merged-{kind}-',dir=output) as temporary:
                merged_path = Path(temporary)
                merged.save_pretrained(merged_path, safe_serialization=True)
                if kind == 'llm':
                    tokenizer = AutoTokenizer.from_pretrained(model_id,revision=revision,local_files_only=True)
                    tokenizer.save_pretrained(merged_path)
                else:
                    processor = WhisperProcessor.from_pretrained(model_id,revision=revision,local_files_only=True)
                    processor.save_pretrained(merged_path)
                    # The official converter reads the original byte-token vocabulary;
                    # newer HF serializers may only write tokenizer.json.
                    for filename in ('vocab.json', 'merges.txt'):
                        cached = hf_hub_download(model_id,filename,revision=revision,local_files_only=True)
                        shutil.copyfile(cached,merged_path/filename)
                    if not (merged_path/'added_tokens.json').exists():
                        (merged_path/'added_tokens.json').write_text(json.dumps(processor.tokenizer.get_added_vocab()))
                del merged, adapted, base
                gc.collect()
                if kind == 'llm':
                    artifact = output/'language.gguf'
                    converter = cache/'llama.cpp/convert_hf_to_gguf.py'
                    subprocess.run([sys.executable,str(converter),str(merged_path),'--outfile',str(artifact),
                                    '--outtype',language_format],check=True)
                else:
                    mel = cache/'openai-whisper/whisper/assets/mel_filters.npz'
                    if not mel.exists():
                        mel.parent.mkdir(parents=True,exist_ok=True)
                        url = f'https://raw.githubusercontent.com/openai/whisper/{MEL_REVISION}/whisper/assets/mel_filters.npz'
                        with urllib.request.urlopen(url,timeout=30) as response:
                            mel.write_bytes(response.read(1024*1024))
                    if digest(mel) != MEL_SHA256:
                        raise RuntimeError('Official Whisper mel-filter asset hash differs.')
                    converter = cache/'whisper.cpp/models/convert-h5-to-ggml.py'
                    subprocess.run([sys.executable,str(converter),str(merged_path),str(cache/'openai-whisper'),str(output)],check=True)
                    artifact = output/'speech.bin'
                    (output/'ggml-model.bin').rename(artifact)
                report['exports'][kind] = {'model':model_id,'revision':revision,'adapter':str(adapter.relative_to(ROOT)),
                    'adapterSha256':digest(adapter/'adapter_model.safetensors'),
                    'converterSha256':digest(converter),'file':artifact.name, 'bytes':artifact.stat().st_size,
                    'sha256':digest(artifact), 'format':language_format if kind=='llm' else 'f16',
                    'mergedAdapter':True}
                report['language' if kind == 'llm' else 'speech'] = {
                    'file': artifact.name, 'sha256': digest(artifact), 'base': model_id,
                    'adapter': str(adapter.relative_to(ROOT)),
                    'quantization': language_format if kind == 'llm' else 'f16'}
                (output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
        report['completedAtUnix'] = time.time()
    except Exception as failure:
        report['failure'] = {'type':type(failure).__name__, 'message':str(failure)}
        raise
    finally:
        (output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',required=True)
    parser.add_argument('--cache',default=str(ROOT/'work/mathwave-local-runtime'))
    parser.add_argument('--only',choices=('llm','stt','both'),default='both')
    parser.add_argument('--language-format',choices=('q8_0','f16'),default='q8_0')
    args=parser.parse_args()
    print(json.dumps(export_models(args.output,args.cache,args.only,args.language_format),indent=2))
