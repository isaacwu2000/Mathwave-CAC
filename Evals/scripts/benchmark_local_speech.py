"""Benchmark frozen synthetic math speech locally; never update model weights."""
import argparse
import gc
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import re
import resource
import time

ROOT = Path(__file__).resolve().parents[2]
NUMBERS = dict(zip('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(), map(str, range(21))))


def tokens(text):
    """Normalize case, punctuation and small spoken numbers while retaining math signs."""
    text = text.lower().replace('−', '-')
    for symbol, word in {'+': ' plus ', '-': ' minus ', '=': ' equals ', '*': ' times ', '×': ' times ', '÷': ' divided by ', '²': ' squared '}.items():
        text = text.replace(symbol, word)
    text = re.sub(r'(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)', ' ', text)
    return [NUMBERS.get(word, word) for word in re.findall(r"[a-z]+(?:'[a-z]+)?|\d+(?:\.\d+)?|[^\w\s.,!?;:\"()]", text)]


def errors(reference, hypothesis):
    """Return word edit distance with insertions, deletions and substitutions costing one."""
    previous = list(range(len(hypothesis) + 1))
    for index, word in enumerate(reference, 1):
        current = [index]
        for column, other in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[column] + 1, previous[column - 1] + (word != other)))
        previous = current
    return previous[-1]


def fixtures():
    """Load all checked-in demo manifests and verify audio hashes before evaluation."""
    rows = []
    for manifest in sorted((ROOT / 'Web/public/demo-voices').rglob('manifest.json')):
        for item in json.loads(manifest.read_text()):
            path = ROOT / 'Web/public' / item['audio'].lstrip('/')
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual != item['sha256']:
                raise ValueError(f'Audio hash mismatch: {path}')
            rows.append({'audio': str(path.relative_to(ROOT)), 'sha256': actual,
                         'reference': item.get('transcript', item.get('text')),
                         'voice': item['voice'], 'source': item['source']})
    return rows


def memory(torch):
    """Report process peak RSS and current Metal allocations separately, in MiB."""
    return {'process_peak_rss_mib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2,
            'mps_allocated_mib': torch.mps.current_allocated_memory() / 1024**2,
            'mps_driver_mib': torch.mps.driver_allocated_memory() / 1024**2}


def benchmark(name, rows):
    """Measure inference and one LoRA backward pass on MPS; perform no optimizer step."""
    import numpy as np
    import soundfile as sf
    import torch
    from scipy.signal import resample_poly
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    from peft import LoraConfig, get_peft_model
    if not torch.backends.mps.is_available():
        raise RuntimeError('Metal GPU is unavailable; benchmark will not silently fall back to CPU.')
    started = time.perf_counter()
    processor = WhisperProcessor.from_pretrained(name)
    model = WhisperForConditionalGeneration.from_pretrained(name, attn_implementation='eager').to('mps').eval()
    load_seconds = time.perf_counter() - started

    def features(row):
        audio, rate = sf.read(ROOT / row['audio'], dtype='float32')
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        duration = len(audio) / rate
        if rate != 16000:
            factor = math.gcd(rate, 16000)
            audio = resample_poly(audio, 16000 // factor, rate // factor).astype(np.float32)
        return processor(audio, sampling_rate=16000, return_tensors='pt').input_features.to('mps'), duration

    inputs, _ = features(rows[0])
    with torch.inference_mode():
        model.generate(inputs, max_new_tokens=96, do_sample=False)
    torch.mps.synchronize()
    results = []
    for row in rows:
        inputs, duration = features(row)
        torch.mps.synchronize()
        started = time.perf_counter()
        with torch.inference_mode():
            output = model.generate(inputs, max_new_tokens=96, do_sample=False)
        torch.mps.synchronize()
        elapsed = time.perf_counter() - started
        text = processor.batch_decode(output, skip_special_tokens=True)[0]
        expected, actual = tokens(row['reference']), tokens(text)
        result = {**row, 'hypothesis': text, 'normalized_reference': expected,
                  'normalized_hypothesis': actual, 'word_errors': errors(expected, actual),
                  'reference_words': len(expected), 'exact': expected == actual,
                  'audio_seconds': duration, 'inference_seconds': elapsed}
        results.append(result)
        print(json.dumps({'model': name, 'clip': row['audio'], 'text': text, 'seconds': round(elapsed, 3)}), flush=True)

    inference_memory = memory(torch)
    adapted = get_peft_model(model, LoraConfig(r=8, lora_alpha=16, target_modules=['q_proj', 'v_proj'], lora_dropout=0, bias='none'))
    trainable = [(key, value) for key, value in adapted.named_parameters() if value.requires_grad]
    assert trainable and all('lora_' in key for key, _ in trainable), 'A base weight was unfrozen'
    adapted.train()
    labels = processor.tokenizer(rows[0]['reference'], return_tensors='pt').input_ids.to('mps')
    inputs, _ = features(rows[0])
    torch.mps.synchronize()
    started = time.perf_counter()
    loss = adapted(input_features=inputs, labels=labels).loss
    loss.backward()
    torch.mps.synchronize()
    probe = {'rank': 8, 'trainable_parameters': sum(value.numel() for _, value in trainable),
             'total_parameters': sum(value.numel() for value in adapted.parameters()),
             'loss': loss.item(), 'forward_backward_seconds': time.perf_counter() - started,
             'optimizer_steps': 0, 'memory': memory(torch)}
    if not math.isfinite(probe['loss']):
        raise RuntimeError('LoRA backward pass produced a nonfinite loss')
    summary = {'model': name, 'revision': getattr(model.config, '_commit_hash', None),
               'load_seconds_including_download': load_seconds, 'clips': len(results),
               'normalized_word_error_rate': sum(row['word_errors'] for row in results) / sum(row['reference_words'] for row in results),
               'normalized_exact_clips': sum(row['exact'] for row in results),
               'total_audio_seconds': sum(row['audio_seconds'] for row in results),
               'total_inference_seconds': sum(row['inference_seconds'] for row in results),
               'inference_memory': inference_memory, 'lora_backward_probe': probe, 'results': results}
    del adapted, model, inputs, labels, loss, output
    gc.collect()
    torch.mps.empty_cache()
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', nargs='+', default=['openai/whisper-tiny.en', 'openai/whisper-base.en'])
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {'platform': platform.platform(), 'device': 'Apple M3 / MPS',
              'lane': 'synthetic recorded speech; no human or iPhone acceptance',
              'normalization': 'case/punctuation/small number words; preserve mathematical symbols',
              'training': 'LoRA backward resource probe only; no weight updates',
              'versions': {key: importlib.metadata.version(key) for key in ['torch', 'transformers', 'peft', 'soundfile', 'scipy']}, 'models': []}
    rows = fixtures()
    for name in args.models:
        try:
            report['models'].append(benchmark(name, rows))
        except Exception as error:
            report['models'].append({'model': name, 'error': repr(error)})
            output.write_text(json.dumps(report, indent=2) + '\n')
            raise
        output.write_text(json.dumps(report, indent=2) + '\n')
