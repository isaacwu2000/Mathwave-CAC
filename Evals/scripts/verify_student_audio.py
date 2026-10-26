"""Verify the complete prepared corpus without synthesizing or invoking a model."""
from array import array
import hashlib
import json
from pathlib import Path
import sys
import wave
from prepare_student_audio import fingerprint

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / 'Evals/inputs/student-conversations-v1'
REPORTS = ROOT / 'Evals/evaluations/student-conversations-v1-2026-10-22'


def verify():
    """Check every transcript binding, source/review hash, waveform and conversation voice."""
    manifest = json.loads((CORPUS / 'audio/manifest.json').read_text())
    if manifest['status'] != 'complete':
        raise ValueError('Audio preparation is incomplete.')
    expected, reviewed = {}, set()
    for source in sorted(CORPUS.glob('*.json')):
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if manifest['corpusSha256'].get(source.name) != digest:
            raise ValueError(f'Audio manifest source changed: {source.name}')
        review = json.loads((REPORTS / 'reviews' / source.name).read_text())
        if not review.get('authorAgent') or review['authorAgent'] == review['reviewer']:
            raise ValueError(f'Review must be independent from author: {source.name}')
        if review.get('sourceSha256') != digest:
            raise ValueError(f'Individual reviews refer to different content: {source.name}')
        for row in review['cases']:
            if row['id'] in reviewed or row['verdict'] != 'pass' or not row['notes']:
                raise ValueError(f'Duplicate or incomplete individual review: {row["id"]}')
            reviewed.add(row['id'])
        for case in json.loads(source.read_text()):
            for number, turn in enumerate(case['turns'], 1):
                expected[(case['id'], number)] = (case['family'], turn['student'])
    if reviewed != {key[0] for key in expected}:
        raise ValueError('Not every conversation has exactly one independent review.')
    actual, voices, case_voices, durations = set(), {}, {}, []
    total_bytes = 0
    for clip in manifest['clips']:
        key = (clip['case'], clip['turn'])
        if key in actual or expected.get(key) != (clip['family'], clip['reference']):
            raise ValueError(f'Duplicate or mislabeled recording: {key}')
        actual.add(key)
        if fingerprint(clip['reference'], clip['voice']) != clip['fingerprint']:
            raise ValueError(f'Text/voice/settings binding changed: {key}')
        path = ROOT / clip['audio']
        if path.resolve().parent != (CORPUS / 'audio').resolve():
            raise ValueError(f'Audio outside corpus: {key}')
        if hashlib.sha256(path.read_bytes()).hexdigest() != clip['sha256']:
            raise ValueError(f'Audio checksum changed: {key}')
        with wave.open(str(path), 'rb') as recording:
            if (recording.getframerate(), recording.getnchannels(), recording.getsampwidth()) != (16000, 1, 2):
                raise ValueError(f'Incorrect audio format: {key}')
            frames = recording.getnframes()
            samples = array('h', recording.readframes(frames))
            if sys.byteorder != 'little':
                samples.byteswap()
            if not samples or not any(sample != 0 for sample in samples):
                raise ValueError(f'Empty or silent audio: {key}')
            duration = frames / 16000
            if abs(duration - clip['durationSeconds']) > 1 / 16000:
                raise ValueError(f'Audio duration mismatch: {key}')
            durations.append(duration)
        if clip['bytes'] != path.stat().st_size:
            raise ValueError(f'Audio size mismatch: {key}')
        total_bytes += clip['bytes']
        case_voices.setdefault(clip['case'], set()).add(clip['voice'])
        voices[clip['voice']] = voices.get(clip['voice'], 0) + 1
    if len(voices) != 6:
        raise ValueError('Expected six distinct prepared voices.')
    if actual != set(expected) or any(len(items) != 1 for items in case_voices.values()):
        raise ValueError('Missing audio or inconsistent student voice within a conversation.')
    report = {'lane': 'Complete corpus recording integrity, not STT/model or listening acceptance.', 'conversations': len(reviewed), 'individuallyReviewed': len(reviewed), 'clips': len(actual), 'voices': voices, 'totalBytes': total_bytes, 'totalDurationSeconds': sum(durations), 'minDurationSeconds': min(durations), 'maxDurationSeconds': max(durations), 'checks': ['every ordered student turn covered exactly once', 'exact transcript/family bindings', 'six-voice manifest with consistent voice per conversation', 'all source and individual review hashes', 'all audio SHA256, sample formats, frame counts, durations and sizes', 'all waveforms nonempty and not digital silence'], 'generationApiCostUsd': 0, 'limits': 'Synthetic macOS voices; not real student speech. Recordings were not all listened to or transcribed. Full app visual acceptance is incomplete.'}
    (REPORTS / 'audio-preparation-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    verify()
