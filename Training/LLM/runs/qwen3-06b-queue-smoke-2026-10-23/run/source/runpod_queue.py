"""Run the frozen experiment through Runpod's supported queue API.

The local entrypoint is invoked by ``rp flash dev ... --once``; importing this
module never submits work. The caller owns endpoint cleanup and the hard budget
watchdog; cooperative trainer deadlines cannot interrupt a stalled GPU call.
"""
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tarfile

MAX_PAYLOAD_BYTES = 6 * 1024**2
MAX_ARCHIVE_BYTES = 8 * 1024**2
MAX_UNPACKED_BYTES = 128 * 1024**2


def safe_extract(archive, destination, max_archive_bytes=MAX_ARCHIVE_BYTES):
    """Extract bounded regular files/directories after validating every member.

    - Rejects absolute paths, traversal, links, duplicate names and special files.
    - Bounds both compressed and uncompressed size before writing any files.
    - Requires a new empty destination so an existing symlink cannot redirect writes.
    """
    if len(archive) > max_archive_bytes:
        raise ValueError('Compressed archive exceeds size allowance.')
    destination = Path(destination)
    if destination.exists():
        raise ValueError('Extraction destination must not exist.')
    with gzip.GzipFile(fileobj=io.BytesIO(archive)) as compressed:
        unpacked = compressed.read(MAX_UNPACKED_BYTES + 1)
    if len(unpacked) > MAX_UNPACKED_BYTES:
        raise ValueError('Unpacked archive exceeds size allowance.')
    with tarfile.open(fileobj=io.BytesIO(unpacked), mode='r:') as tar:
        members = tar.getmembers()
        names, total = set(), 0
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or '..' in path.parts or '\\' in member.name
                    or not path.parts or ':' in path.parts[0]
                    or not (member.isfile() or member.isdir()) or member.name in names):
                raise ValueError('Unsafe or duplicate archive member.')
            names.add(member.name)
            total += member.size
            if total > MAX_UNPACKED_BYTES:
                raise ValueError('Archive members exceed size allowance.')
        destination.mkdir(parents=True)
        for member in members:
            target = destination.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open('xb') as output:
                    output.write(source.read())


def pack_results(directory):
    """Return a bounded result archive, excluding optimizer/recovery/base weights.

    - Includes adapter weights, frozen source, predictions, curves and failure traces.
    - Rejects symlinks; never includes cached or full base-model weights.
    """
    directory = Path(directory)
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as tar:
        for path in sorted(directory.rglob('*')):
            relative = path.relative_to(directory)
            if path.is_symlink():
                raise ValueError('Result contains a symlink.')
            if (not path.is_file() or 'recovery-adapter' in relative.parts
                    or path.name == 'recovery-state.pt'
                    or (path.suffix in ('.safetensors', '.bin', '.pt')
                        and relative.parts[0] != 'adapter')):
                continue
            tar.add(path, arcname=str(relative), recursive=False)
    archive = stream.getvalue()
    if len(archive) > MAX_ARCHIVE_BYTES:
        raise ValueError('Result archive exceeds 8 MiB allowance.')
    return archive


def run_experiment(payload_b64, payload_sha256, phase='smoke'):
    """Validate the frozen payload, run pinned CUDA LoRA, and return evidence.

    - No transcript/data/prompt mutation or held-out-result selection occurs here.
    - Exceptions retain the report and traceback inside the returned archive.
    - Cost is unknown until the caller reconciles actual Runpod usage.
    """
    import importlib.util
    import tempfile
    import time
    import traceback
    started = time.monotonic()
    if phase not in ('smoke', 'train'):
        raise ValueError('Phase must be smoke or train.')
    archive = base64.b64decode(payload_b64, validate=True)
    if len(archive) > MAX_PAYLOAD_BYTES:
        raise ValueError('Payload exceeds size allowance.')
    if hashlib.sha256(archive).hexdigest() != payload_sha256:
        raise ValueError('Payload SHA256 mismatch.')
    with tempfile.TemporaryDirectory(prefix='mathwave-queue-') as temporary:
        root = Path(temporary)
        output = root / 'run'
        error = None
        try:
            from huggingface_hub import snapshot_download
            safe_extract(archive, root / 'payload', MAX_PAYLOAD_BYTES)
            trainer_path = root / 'payload/scripts/train_lora.py'
            spec = importlib.util.spec_from_file_location('mathwave_frozen_trainer', trainer_path)
            trainer = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(trainer)
            snapshot_download(repo_id=trainer.MODEL, revision=trainer.REVISION)
            trainer.main(str(root / 'payload/data'), str(output), smoke=phase == 'smoke',
                         device='cuda', skip_grading=True,
                         max_seconds=540 if phase == 'smoke' else 6600)
        except Exception as failure:
            error = {'type': type(failure).__name__, 'message': str(failure)}
            output.mkdir(parents=True, exist_ok=True)
            (output / 'queue-failure.txt').write_text(traceback.format_exc())
            report_path = output / 'report.json'
            report = json.loads(report_path.read_text()) if report_path.exists() else {}
            report['failure'] = {**error, 'atUnix': time.time(), 'lastProgress': report.get('progress')}
            report['progress'] = {'stage': 'failed'}
            report_path.write_text(json.dumps(report, indent=2) + '\n')
        result_archive = pack_results(output)
        metadata = {'phase': phase, 'elapsedSeconds': time.monotonic() - started,
                    'paidComputeUsd': None, 'payloadSha256': payload_sha256,
                    'archiveBytes': len(result_archive), 'error': error}
        result = {**metadata, 'archive_b64': base64.b64encode(result_archive).decode('ascii'),
                  'archive_sha256': hashlib.sha256(result_archive).hexdigest()}
        # The SDK pickles then base64-encodes results; reserve that additional envelope.
        if len(json.dumps(result).encode()) * 4 / 3 + 65536 > 20 * 1024**2:
            raise ValueError('Result exceeds encoded queue response allowance.')
        return result


# Optional import keeps archive unit tests runnable without the queue SDK.
try:
    from runpod import App, GpuType, local_entrypoint
except ImportError:
    app = None
else:
    app = App('mathwave-qwen-lora-20261023')
    queued_experiment = app.queue(
        name='frozen-lora', gpu=GpuType.NVIDIA_RTX_A5000, gpu_count=1,
        workers=(0, 1), idle_timeout=5, max_concurrency=1,
        execution_timeout_ms=600000 if os.environ.get('MATHWAVE_QUEUE_PHASE', 'smoke') == 'smoke' else 7200000,
        dependencies=['transformers==5.20.2', 'peft==0.21.2', 'numpy==2.5.4',
                      'safetensors==0.8.0', 'matplotlib==3.11.2'],
        container_disk_gb=20,
    )(run_experiment)

    @local_entrypoint
    def main():
        """Submit once, save verified evidence, and print only a small summary.

        - Refuses existing result directories and records job ID before waiting.
        - Cancels on local failure; ``--once`` and the caller's watchdog own cleanup.
        """
        phase = os.environ.get('MATHWAVE_QUEUE_PHASE', 'smoke')
        if phase not in ('smoke', 'train'):
            raise ValueError('Phase must be smoke or train.')
        payload = Path(os.environ['MATHWAVE_PAYLOAD_PATH']).read_bytes()
        if len(payload) > MAX_PAYLOAD_BYTES:
            raise ValueError('Payload exceeds size allowance.')
        output = Path(os.environ['MATHWAVE_QUEUE_RESULTS'])
        output.mkdir(parents=True, exist_ok=False)
        payload_b64 = base64.b64encode(payload).decode('ascii')
        if len(json.dumps([payload_b64]).encode()) * 4 / 3 + 65536 > 10 * 1024**2:
            raise ValueError('Encoded request exceeds 10 MiB allowance.')
        job = queued_experiment.spawn(payload_b64, hashlib.sha256(payload).hexdigest(), phase)
        (output / 'job.json').write_text(json.dumps({'id': job.id, 'phase': phase}) + '\n')
        try:
            result = job.result(timeout=900 if phase == 'smoke' else 7500)
            archive = base64.b64decode(result['archive_b64'], validate=True)
            if hashlib.sha256(archive).hexdigest() != result['archive_sha256']:
                raise ValueError('Result SHA256 mismatch.')
            (output / 'result.tar.gz').write_bytes(archive)
            safe_extract(archive, output / 'run')
            summary = {key: value for key, value in result.items() if key != 'archive_b64'}
            (output / 'queue-result.json').write_text(json.dumps(summary, indent=2) + '\n')
            print(json.dumps(summary), flush=True)
        except Exception:
            job.cancel()
            raise
