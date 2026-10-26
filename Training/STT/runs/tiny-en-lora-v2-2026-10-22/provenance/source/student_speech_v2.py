"""Prepare and freeze a grouped, category-balanced v2 speech demonstration.

Reads immutable v1 fixtures in place and writes only new v2 artifacts. No model or
paid service is called. Split assignment depends on authored programs, never scores.
"""
import argparse
from array import array
from collections import Counter
import concurrent.futures
import hashlib
import json
from pathlib import Path
import random
import re
import shutil
import subprocess
import wave

from prepare_student_audio import VOICE_CYCLE, fingerprint
from speech_normalization import normalize_tokens

ROOT = Path(__file__).resolve().parents[2]
V1 = Path('Evals/inputs/student-conversations-v1')
V2 = Path('Evals/inputs/student-conversations-v2')
SOURCES = [V1 / (name + '.json') for name in ['algebra', 'graphs', 'geometry', 'statistics-and-context']] + [V2 / 'equation-extension.json']
AUDIO_MANIFEST = V2 / 'audio/manifest.json'
SPLIT = Path('Evals/inputs/student-speech-split-v2.json')
SEED = 'mathwave-speech-v2-group-stratified-2026-10-22'
PARTITIONS = {'train': .8, 'val': .1, 'test': .1}


def digest(path):
    """Hash exact file bytes for frozen provenance."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def transcript_key(text):
    """Use exactly the scorer's normalization for overlap and representative selection."""
    return ' '.join(normalize_tokens(text))


def stratum(case):
    """Report old algebra and new equations together without modifying either source."""
    return 'algebra' if case['category'] in {'algebra', 'arithmetic', 'equations'} else case['category']


def load_cases(root=ROOT):
    """Read the five explicit sources, rejecting duplicate IDs or incomplete conversations."""
    cases, hashes, identities = [], {}, set()
    for relative in SOURCES:
        path = root / relative
        hashes[str(relative)] = digest(path)
        rows = json.loads(path.read_text())
        if not isinstance(rows, list):
            raise ValueError(f'Expected a conversation array: {relative}')
        for case in rows:
            if case['id'] in identities or not case.get('turns') or len(case['turns']) < 2:
                raise ValueError(f'Duplicate or incomplete conversation: {case["id"]}')
            identities.add(case['id'])
            cases.append(case)
    return cases, hashes


def program_key(text):
    """Mask numeric literals while retaining signs, names, punctuation, and operation order."""
    return re.sub(r'\s+', '', re.sub(r'(?<![\w.])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', '#', text))


def conversation_groups(cases):
    """Join full-program number variants and the explicit parallel/transversal family.

    A shared first setup alone never joins cases. Turn boundaries, operation order,
    previews, and response status are retained in complete-sequence signatures.
    """
    parents = {case['id']: case['id'] for case in cases}
    def find(key):
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key
    seen = {}
    for case in sorted(cases, key=lambda item: item['id']):
        sequence = [{'status': turn.get('status', 'command'),
                     'programs': [program_key(program) for program in turn['programs']],
                     'previews': [program_key(program) for program in turn.get('previews', [])]}
                    for turn in case['turns']]
        signatures = ['complete:' + json.dumps(sequence, sort_keys=True)]
        if case['category'] == 'geometry' and re.search(r'parallel|transversal|corresponding|alternate|same-side|vertical-angles|linear-pair', case['family']):
            signatures.append('geometry:parallel-transversal-relationships')
        for signature in signatures:
            if signature in seen:
                parents[find(case['id'])] = find(seen[signature])
            seen[signature] = case['id']
    groups = {}
    for case in cases:
        groups.setdefault(find(case['id']), []).append(case['id'])
    return sorted([sorted(group) for group in groups.values()])


def assign_groups(cases, groups, seed=SEED):
    """Assign indivisible groups near 80/10/10 using seeded, category-aware balancing.

    Large groups go first. Seeded ties supply reproducible randomization; the cost
    weights category deviations, nested original algebra/arithmetic categories, and global size. Whole-group improvement moves
    never use model outputs or separate related cases.
    """
    categories = {case['id']: stratum(case) for case in cases}
    totals = Counter(categories.values())
    originals = {case['id']: case['category'] for case in cases if stratum(case) == 'algebra'}
    original_totals = Counter(originals.values())
    original_vectors = [Counter(originals[ident] for ident in group if ident in originals) for group in groups]
    vectors = [Counter(categories[ident] for ident in group) for group in groups]
    rng = random.Random(seed)
    order = list(range(len(groups)))
    rng.shuffle(order)
    order.sort(key=lambda index: -len(groups[index]))
    counts = {name: Counter() for name in PARTITIONS}
    original_counts = {name: Counter() for name in PARTITIONS}
    locations = {}
    def adjust(index, name, direction):
        if direction == 1:
            counts[name].update(vectors[index])
            original_counts[name].update(original_vectors[index])
        else:
            counts[name].subtract(vectors[index])
            original_counts[name].subtract(original_vectors[index])
    def cost():
        value = 0.
        for name, fraction in PARTITIONS.items():
            for category, total in sorted(totals.items()):
                target = total * fraction
                value += (counts[name][category] - target) ** 2 / max(1., target)
            # The combined equation stratum must not hide its smaller arithmetic subgroup.
            for category, total in sorted(original_totals.items()):
                target = total * fraction
                value += (original_counts[name][category] - target) ** 2 / max(1., target)
            target = len(cases) * fraction
            value += .1 * (sum(counts[name].values()) - target) ** 2 / max(1., target)
        return value
    for index in order:
        choices = list(PARTITIONS)
        rng.shuffle(choices)
        scores = {}
        for name in choices:
            adjust(index, name, 1)
            scores[name] = cost()
            adjust(index, name, -1)
        chosen = min(choices, key=lambda name: scores[name])
        adjust(index, chosen, 1)
        locations[index] = chosen
    for _ in range(3):
        changed = False
        for index in order:
            original = locations[index]
            best, best_cost = original, cost()
            adjust(index, original, -1)
            for name in PARTITIONS:
                adjust(index, name, 1)
                score = cost()
                if score < best_cost - 1e-9:
                    best, best_cost = name, score
                adjust(index, name, -1)
            adjust(index, best, 1)
            locations[index] = best
            changed |= best != original
        if not changed:
            break
    assignments = {name: [] for name in PARTITIONS}
    rows = []
    for index, group in enumerate(groups):
        partition = locations[index]
        assignments[partition].extend(group)
        rows.append({'id': hashlib.sha256('\n'.join(group).encode()).hexdigest()[:16],
                     'partition': partition, 'cases': group, 'byCategory': dict(vectors[index])})
    return {name: sorted(ids) for name, ids in assignments.items()}, rows


def grouped_split(cases, clips, seed=SEED):
    """Freeze independent STT partitions and globally nonoverlapping representatives.

    Test has priority over validation, then training. Repeated utterances or identical
    waveforms in lower-priority partitions are excluded, not reassigned. Within a
    partition, a stable case/turn ordering fixes its primary transcript representative.
    """
    assignments, groups = assign_groups(cases, conversation_groups(cases), seed)
    case_map = {case['id']: case for case in cases}
    retained, exclusions, seen_text, seen_audio, primary = {}, [], set(), set(), {}
    for name in ['test', 'val', 'train']:
        identities = set(assignments[name])
        rows = sorted((dict(item, stratum=stratum(case_map[item['case']]), category=stratum(case_map[item['case']]), originalCategory=case_map[item['case']]['category']) for item in clips if item['case'] in identities), key=lambda item: (item['case'], item['turn']))
        kept, representatives, within = [], [], set()
        for row in rows:
            key = transcript_key(row['reference'])
            if key in seen_text or row['sha256'] in seen_audio:
                exclusions.append({'partition': name, 'case': row['case'], 'turn': row['turn'], 'reason': 'Normalized transcript or waveform occurs in a higher-priority partition'})
                continue
            kept.append(row)
            if key not in within:
                representatives.append({'case': row['case'], 'turn': row['turn'], 'sha256': row['sha256'], 'stratum': row['stratum']})
                within.add(key)
        retained[name], primary[name] = kept, representatives
        seen_text.update(transcript_key(row['reference']) for row in kept)
        seen_audio.update(row['sha256'] for row in kept)
    summary = {}
    for name, rows in retained.items():
        categories = sorted({stratum(case) for case in cases})
        original_categories = sorted({case['category'] for case in cases})
        summary[name] = {'conversations': len(assignments[name]), 'retainedClips': len(rows),
                         'uniqueTranscripts': len(primary[name]), 'voices': sorted({row['voice'] for row in rows}),
                         'byCategory': {category: {'conversations': sum(stratum(case_map[ident]) == category for ident in assignments[name]),
                                                   'retainedClips': sum(row['stratum'] == category for row in rows),
                                                   'primaryUniqueTranscripts': sum(row['stratum'] == category for row in primary[name])}
                                        for category in categories},
                         'byOriginalCategory': {category: {'conversations': sum(case_map[ident]['category'] == category for ident in assignments[name]),
                                                           'retainedClips': sum(row['originalCategory'] == category for row in rows),
                                                           'primaryUniqueTranscripts': sum(case_map[row['case']]['category'] == category for row in primary[name])}
                                                for category in original_categories}}
    return {'seed': seed, 'caseAssignments': assignments, 'groups': groups, 'clips': retained,
            'primaryRepresentatives': primary, 'summary': summary, 'exclusions': exclusions}


def check_waveform(row, root=ROOT):
    """Verify exact text/voice binding, checksum, format and non-silent samples."""
    path = root / row['audio']
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Recording escapes the repository.')
    if fingerprint(row['reference'], row['voice']) != row['fingerprint'] or digest(path) != row['sha256']:
        raise ValueError(f'Changed audio binding: {row["audio"]}')
    with wave.open(str(path), 'rb') as recording:
        if (recording.getnchannels(), recording.getsampwidth(), recording.getframerate()) != (1, 2, 16000):
            raise ValueError('Expected mono PCM16 16kHz audio.')
        samples = array('h', recording.readframes(recording.getnframes()))
        if not samples or not any(samples):
            raise ValueError('Empty or digitally silent recording.')
        if abs(len(samples) / 16000 - row['durationSeconds']) > 1 / 16000:
            raise ValueError('Audio duration changed.')
    if path.stat().st_size != row['bytes']:
        raise ValueError('Audio byte count changed.')


def synthesize_clip(row, previous, root=ROOT):
    """Generate only a new v2-owned fingerprint file, retaining verified restart work."""
    path = root / row['audio']
    expected_parent = (root / V2 / 'audio').resolve()
    if path.resolve().parent != expected_parent:
        raise ValueError('Refusing to generate outside v2 audio directory.')
    frozen = previous.get((row['audio'], row['fingerprint']))
    if path.exists() and frozen:
        check_waveform(frozen, root)
        return frozen
    if path.exists():
        path.unlink()
    if shutil.disk_usage(path.parent).free < 2 * 1024**3:
        raise RuntimeError('Audio preparation requires a 2 GiB free reserve.')
    aiff, transcript = path.with_suffix('.aiff'), path.with_suffix('.txt')
    try:
        transcript.write_text(row['reference'])
        subprocess.run(['say', '-v', row['voice'], '-r', '165', '-f', str(transcript), '-o', str(aiff)], check=True, capture_output=True, timeout=60)
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(aiff), str(path)], check=True, capture_output=True, timeout=30)
        with wave.open(str(path), 'rb') as recording:
            row['durationSeconds'] = recording.getnframes() / 16000
        row.update(sha256=digest(path), bytes=path.stat().st_size)
        check_waveform(row, root)
        return row
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        aiff.unlink(missing_ok=True)
        transcript.unlink(missing_ok=True)


def prepare(root=ROOT, workers=4):
    """Merge verified v1 audio by reference and generate only the 100-case extension."""
    cases, hashes = load_cases(root)
    if len(cases) != 500:
        raise ValueError('Wait for the complete 500-case corpus before preparation.')
    old_path = root / V1 / 'audio/manifest.json'
    old = json.loads(old_path.read_text())
    if old['status'] != 'complete' or any(digest(root / V1 / name) != sha for name, sha in old['corpusSha256'].items()):
        raise ValueError('Frozen v1 audio/source provenance changed.')
    output = root / AUDIO_MANIFEST
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError('Refusing to overwrite a complete v2 manifest; use audit.')
    pending = output.with_name('preparation.json')
    prior = json.loads(pending.read_text()).get('clips', []) if pending.exists() else []
    previous = {(row['audio'], row['fingerprint']): row for row in prior}
    originals = {(row['case'], row['turn']): row for row in old['clips']}
    reused, jobs = [], []
    for case in cases:
        voice = VOICE_CYCLE[int(hashlib.sha256(case['family'].encode()).hexdigest()[:8], 16) % len(VOICE_CYCLE)]
        for number, turn in enumerate(case['turns'], 1):
            frozen = originals.get((case['id'], number))
            if frozen is not None:
                if (frozen['family'], frozen['reference']) != (case['family'], turn['student']):
                    raise ValueError('A v1 turn changed; do not replace frozen audio.')
                check_waveform(frozen, root)
                reused.append(dict(frozen, category=stratum(case), originalCategory=case['category']))
                continue
            mark = fingerprint(turn['student'], voice)
            path = V2 / 'audio' / f'{case["id"]}-{number}-{mark[:12]}.wav'
            jobs.append({'case': case['id'], 'family': case['family'], 'turn': number, 'reference': turn['student'],
                         'voice': voice, 'fingerprint': mark, 'audio': str(path),
                         'category': stratum(case), 'originalCategory': case['category'],
                         'source': 'macOS say synthetic voice, 165 words/minute; no human student recording', 'generationCostUsd': 0})
    estimate = sum(len(row['reference'].split()) for row in jobs) / 2.75 * 32000
    if estimate + 2 * 1024**3 > shutil.disk_usage(output.parent).free:
        raise RuntimeError('Insufficient disk for estimated new audio and a 2 GiB reserve.')
    report = {'status': 'preparing', 'corpusSha256': hashes, 'synthetic': True,
              'format': {'sampleRate': 16000, 'channels': 1, 'sampleBytes': 2},
              'sourceAudioManifest': str(old_path.relative_to(root)), 'sourceAudioManifestSha256': digest(old_path),
              'scope': 'One synthetic clip per turn; v1 files referenced in place, not copied. Not model or human-student acceptance.',
              'generationCostUsd': 0, 'expectedClips': len(reused) + len(jobs), 'clips': list(reused)}
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(synthesize_clip, row, previous, root) for row in jobs]
            for future in concurrent.futures.as_completed(futures):
                report['clips'].append(future.result())
                if len(report['clips']) % 25 == 0:
                    pending.write_text(json.dumps(report, indent=2) + '\n')
                    print(f'Prepared {len(report["clips"])}/{report["expectedClips"]}', flush=True)
    finally:
        pending.write_text(json.dumps(report, indent=2) + '\n')
    report['clips'].sort(key=lambda row: (row['case'], row['turn']))
    report.update(status='complete', reusedV1Clips=len(reused), generatedV2Clips=len(jobs),
                  totalBytes=sum(row['bytes'] for row in report['clips']),
                  totalDurationSeconds=sum(row['durationSeconds'] for row in report['clips']))
    output.write_text(json.dumps(report, indent=2) + '\n')
    pending.unlink(missing_ok=True)
    return report


def audit(cases, manifest, split=None, root=ROOT, verify_audio=True):
    """Reject missing turns, mixed voices, leaking partitions, or noncanonical representatives."""
    expected = {(case['id'], number): (case['family'], turn['student']) for case in cases for number, turn in enumerate(case['turns'], 1)}
    actual, voices = {}, {}
    for row in manifest['clips']:
        key = row['case'], row['turn']
        if key in actual or expected.get(key) != (row['family'], row['reference']):
            raise ValueError('Duplicate, missing-source or mislabeled clip.')
        actual[key] = row
        voices.setdefault(row['case'], set()).add(row['voice'])
        if verify_audio:
            check_waveform(row, root)
    if set(actual) != set(expected) or any(len(values) != 1 for values in voices.values()):
        raise ValueError('Missing turns or inconsistent conversation voice.')
    if split is not None:
        recomputed = grouped_split(cases, manifest['clips'], split['seed'])
        for field in ['caseAssignments', 'groups', 'clips', 'primaryRepresentatives', 'summary', 'exclusions']:
            if split[field] != recomputed[field]:
                raise ValueError(f'Frozen split differs from its deterministic audit: {field}')
        occupied_text, occupied_audio = set(), set()
        for name in ['test', 'val', 'train']:
            texts = {transcript_key(row['reference']) for row in split['clips'][name]}
            waves = {row['sha256'] for row in split['clips'][name]}
            if texts & occupied_text or waves & occupied_audio:
                raise ValueError('Held-out normalized transcript or waveform overlap.')
            occupied_text.update(texts)
            occupied_audio.update(waves)
    return {'conversations': len(cases), 'clips': len(actual), 'waveformsVerified': verify_audio,
            'partitionAudit': split is not None, 'generationCostUsd': 0,
            'limits': 'Synthetic speech and known v1 cases; not unseen students or real-world generalization.'}


def freeze_split(root=ROOT, output=SPLIT, seed=SEED):
    """Freeze the v2 split once, binding source, audio, normalizer, and splitter bytes."""
    cases, hashes = load_cases(root)
    path, manifest_path = root / output, root / AUDIO_MANIFEST
    if path.exists():
        raise ValueError('Refusing to overwrite a frozen split.')
    manifest = json.loads(manifest_path.read_text())
    if manifest['status'] != 'complete' or manifest['corpusSha256'] != hashes:
        raise ValueError('V2 audio does not match the five current sources.')
    if digest(root / manifest['sourceAudioManifest']) != manifest['sourceAudioManifestSha256']:
        raise ValueError('Referenced v1 audio manifest changed after v2 preparation.')
    audit(cases, manifest, root=root)
    result = grouped_split(cases, manifest['clips'], seed)
    result.update(corpusSha256=hashes, audioManifest=str(AUDIO_MANIFEST), audioManifestSha256=digest(manifest_path),
                  normalizerSha256=digest(Path(__file__).with_name('speech_normalization.py')),
                  splitterSha256=digest(__file__),
                  policy='Seeded whole-group category balancing targets 80/10/10 approximately, with equal-weight secondary balancing of original algebra/arithmetic subcategories inside the combined algebra stratum. Complete number-masked program/status/preview sequences and the parallel/transversal group stay intact. No first-setup grouping. Held-out normalized transcript and waveform overlap excluded test>val>train. All synthetic voices may recur; no unseen-speaker claim. V2 repartitions known v1 cases; old split membership is not retained.',
                  primaryScore='Globally nonoverlapping normalized transcript representatives selected in stable case/turn order before inference; full retained clips secondary.')
    audit(cases, manifest, result, root, verify_audio=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    """Expose bounded local preparation, immutable splitting, and read-only audits."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'split', 'audit'])
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.workers <= 6:
        parser.error('--workers must be between one and six')
    if args.command == 'prepare':
        result = prepare(workers=args.workers)
        result = {key: result[key] for key in ['expectedClips', 'reusedV1Clips', 'generatedV2Clips', 'generationCostUsd']}
    elif args.command == 'split':
        frozen = freeze_split()
        result = {'summary': frozen['summary'], 'groups': len(frozen['groups']), 'largestGroup': max(len(group['cases']) for group in frozen['groups']), 'exclusions': len(frozen['exclusions'])}
    else:
        cases, hashes = load_cases()
        manifest = json.loads((ROOT / AUDIO_MANIFEST).read_text())
        split = json.loads((ROOT / SPLIT).read_text())
        if manifest['status'] != 'complete' or manifest['corpusSha256'] != hashes or split['corpusSha256'] != hashes:
            raise ValueError('Corpus or manifest provenance changed.')
        if digest(ROOT / AUDIO_MANIFEST) != split['audioManifestSha256'] or digest(Path(__file__).with_name('speech_normalization.py')) != split['normalizerSha256']:
            raise ValueError('Audio manifest or normalizer bytes changed after split freeze.')
        if digest(__file__) != split['splitterSha256']:
            raise ValueError('Splitter source changed after split freeze.')
        if digest(ROOT / manifest['sourceAudioManifest']) != manifest['sourceAudioManifestSha256']:
            raise ValueError('Referenced v1 audio manifest changed.')
        result = audit(cases, manifest, split)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
