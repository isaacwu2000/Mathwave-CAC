"""Pre-generate one offline, checksum-bound synthetic recording per student turn."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / 'Evals/inputs/student-conversations-v1'
OUTPUT = CORPUS / 'audio'
VOICE_CYCLE = ['Samantha', 'Daniel', 'Flo (English (US))', 'Eddy (English (US))', 'Karen', 'Reed (English (US))']


def fingerprint(text, voice):
    """Bind a recording to exact words, voice, rate, and sample format."""
    payload = {'text': text, 'voice': voice, 'rate': 165, 'format': 'PCM16 mono 16000Hz'}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def prepare_clip(item, previous):
    """Reuse only verified matching audio; generate a new file when its source changes."""
    path = ROOT / item['audio']
    frozen = previous.get((item['audio'], item['fingerprint']))
    # A prior interrupted job may have finished a file before journaling its checksum.
    # Regenerate this owned fingerprint-named file rather than trust unverified audio.
    if path.exists() and not frozen:
        path.unlink()
    if path.exists():
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if not frozen or frozen['sha256'] != actual:
            raise ValueError(f'Unverified or damaged existing recording: {path.name}')
    else:
        if shutil.disk_usage(OUTPUT).free < 2 * 1024**3:
            raise RuntimeError('Stopped before audio generation could reduce free disk below 2 GiB.')
        aiff = path.with_suffix('.aiff')
        transcript = path.with_suffix('.txt')
        try:
            transcript.write_text(item['reference'])
            subprocess.run(['say', '-v', item['voice'], '-r', '165', '-f', str(transcript), '-o', str(aiff)], check=True, capture_output=True, timeout=60)
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(aiff), str(path)], check=True, capture_output=True, timeout=30)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            aiff.unlink(missing_ok=True)
            transcript.unlink(missing_ok=True)
    with wave.open(str(path), 'rb') as recording:
        if (recording.getnchannels(), recording.getsampwidth(), recording.getframerate()) != (1, 2, 16000):
            raise ValueError(f'Unexpected audio format: {path.name}')
        item['durationSeconds'] = recording.getnframes() / 16000
        if recording.getnframes() == 0:
            raise ValueError(f'Empty recording: {path.name}')
    item['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    item['bytes'] = path.stat().st_size
    return item


def main():
    """Prepare all turns with six bounded local workers; never call a paid provider."""
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = OUTPUT / 'manifest.json'
    pending = OUTPUT / 'preparation.json'
    old = {'clips': []}
    for source in [manifest, pending]:
        if source.exists():
            old['clips'].extend(json.loads(source.read_text())['clips'])
    previous = {(item['audio'], item['fingerprint']): item for item in old['clips']}
    source_hashes = {}
    cases = []
    for source in sorted(CORPUS.glob('*.json')):
        source_hashes[source.name] = hashlib.sha256(source.read_bytes()).hexdigest()
        cases.extend(json.loads(source.read_text()))
    jobs = []
    for scenario in cases:
        voice = VOICE_CYCLE[int(hashlib.sha256(scenario['family'].encode()).hexdigest()[:8], 16) % len(VOICE_CYCLE)]
        for number, turn in enumerate(scenario['turns'], 1):
            digest = fingerprint(turn['student'], voice)
            filename = f"{scenario['id']}-{number}-{digest[:12]}.wav"
            jobs.append({'case': scenario['id'], 'family': scenario['family'], 'turn': number, 'reference': turn['student'], 'voice': voice, 'fingerprint': digest, 'audio': str((OUTPUT / filename).relative_to(ROOT)), 'source': 'macOS say synthetic voice, 165 words/minute; no human student recording', 'generationCostUsd': 0})
    estimated = sum(len(item['reference'].split()) for item in jobs) / 2.75 * 32000
    missing_fraction = sum(not (ROOT / item['audio']).exists() for item in jobs) / max(1, len(jobs))
    if estimated * missing_fraction + 2 * 1024**3 > shutil.disk_usage(OUTPUT).free:
        raise RuntimeError('Not enough free disk for estimated audio plus a 2 GiB reserve.')
    report = {'status': 'preparing', 'corpusSha256': source_hashes, 'synthetic': True, 'format': {'sampleRate':16000,'channels':1,'sampleBytes':2}, 'scope': 'One clip per student turn. All dependent turns remain grouped by conversation. Prepared audio is not an STT or usability score.', 'generationCostUsd':0, 'expectedClips':len(jobs), 'clips':[]}
    # Keep a resumable verified manifest without exposing partial files as complete fixtures.
    pending = OUTPUT / 'preparation.json'
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(prepare_clip, item, previous): item for item in jobs}
        for future in concurrent.futures.as_completed(futures):
            report['clips'].append(future.result())
            if len(report['clips']) % 100 == 0:
                pending.write_text(json.dumps(report, indent=2) + '\n')
                print(f"Prepared {len(report['clips'])}/{len(jobs)} clips", flush=True)
    report['clips'].sort(key=lambda item: (item['case'], item['turn']))
    report['status'] = 'complete'
    report['totalBytes'] = sum(item['bytes'] for item in report['clips'])
    report['totalDurationSeconds'] = sum(item['durationSeconds'] for item in report['clips'])
    manifest.write_text(json.dumps(report, indent=2) + '\n')
    pending.unlink(missing_ok=True)
    # Only remove superseded files owned by the prior corpus manifest, after the new set is complete.
    keep = {item['audio'] for item in report['clips']}
    for item in old['clips']:
        if item['audio'] not in keep and (ROOT / item['audio']).parent == OUTPUT:
            (ROOT / item['audio']).unlink(missing_ok=True)
    print(json.dumps({key:report[key] for key in ['status','expectedClips','totalBytes','totalDurationSeconds','generationCostUsd']}), flush=True)


if __name__ == '__main__':
    main()
