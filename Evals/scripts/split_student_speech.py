"""Freeze grouped speech splits before looking at any model predictions."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / 'Evals/inputs/student-conversations-v1'
SEED = 'mathwave-speech-lora-v1-2026-10-22'


def transcript_key(text):
    """Normalize superficial speech spelling, retaining signs and number identities."""
    return ' '.join(re.findall(r"[a-z]+(?:'[a-z]+)?|\d+(?:\.\d+)?|[-+*/^=]", text.lower().replace('−', '-')))


def program_key(text):
    """Group number-only setup variations without changing operation order or signs."""
    return re.sub(r'\s+', '', re.sub(r'\b\d+(?:\.\d+)?\b', '#', text))


def grouped_split(cases, clips):
    """Assign whole related conversations, then exclude overlapping independent STT clips.

    Complete conversation records retain their partition even when a repeated turn is
    excluded from audio training. Test data has priority over validation, then training.
    """
    parents = {case['id']: case['id'] for case in cases}
    def find(key):
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key
    def join(first, second):
        parents[find(first)] = find(second)
    seen = {}
    for case in cases:
        turns = case['turns']
        first = '\n'.join(turns[0]['programs'])
        following = '\n'.join(turns[1]['programs'] + turns[1].get('previews', []))
        # A graph's next operation distinguishes a shared blank parabola from its task.
        intent = ','.join(re.findall(r'\b(?:graph|view)\.\w+', following)) if case['category'] == 'graphs' else ''
        signatures = ['setup:' + program_key(first) + ':' + intent,
                      'sequence:' + program_key('\n'.join(str(turn.get('status', 'command')) + '\n' + '\n'.join(turn['programs'] + turn.get('previews', [])) for turn in turns))]
        if case['category'] == 'geometry' and re.search(r'parallel|transversal|corresponding|alternate|same-side|vertical-angles|linear-pair', case['family']):
            signatures.append('geometry:parallel-transversal-relationships')
        for signature in signatures:
            if signature in seen:
                join(case['id'], seen[signature])
            seen[signature] = case['id']
    groups = {}
    for case in cases:
        groups.setdefault(find(case['id']), []).append(case['id'])
    ordered = sorted(groups.values(), key=lambda group: (-len(group), hashlib.sha256((SEED + ':'.join(sorted(group))).encode()).hexdigest()))
    targets = {'train': len(cases)*.8, 'val': len(cases)*.1, 'test': len(cases)*.1}
    assignments = {name: [] for name in targets}
    group_rows = []
    for group in ordered:
        partition = max(targets, key=lambda name: (targets[name]-len(assignments[name])) / targets[name])
        assignments[partition].extend(sorted(group))
        group_rows.append({'id': hashlib.sha256('\n'.join(sorted(group)).encode()).hexdigest()[:16], 'partition': partition, 'cases': sorted(group)})
    included, excluded, prior_text, prior_audio = {}, [], set(), set()
    for partition in ['test', 'val', 'train']:
        rows = sorted((item for item in clips if item['case'] in assignments[partition]), key=lambda item: (item['case'], item['turn']))
        kept = []
        for item in rows:
            key = transcript_key(item['reference'])
            if key in prior_text or item['sha256'] in prior_audio:
                excluded.append({'partition': partition, 'case': item['case'], 'turn': item['turn'], 'reason': 'Transcript or waveform occurs in a higher-priority held-out partition'})
            else:
                kept.append(item)
        included[partition] = kept
        prior_text.update(transcript_key(item['reference']) for item in kept)
        prior_audio.update(item['sha256'] for item in kept)
    return {'seed': SEED, 'caseAssignments': assignments, 'groups': group_rows, 'clips': included, 'exclusions': excluded}


def main(output):
    """Write an immutable split manifest with corpus/audio provenance and an overlap audit."""
    output = Path(output)
    if output.exists():
        raise ValueError('Refusing to replace a frozen split.')
    cases = []
    source_hashes = {}
    for source in sorted(CORPUS.glob('*.json')):
        source_hashes[source.name] = hashlib.sha256(source.read_bytes()).hexdigest()
        cases.extend(json.loads(source.read_text()))
    audio_path = CORPUS / 'audio/manifest.json'
    audio = json.loads(audio_path.read_text())
    if audio['status'] != 'complete' or audio['corpusSha256'] != source_hashes:
        raise ValueError('Audio does not match current corpus.')
    result = grouped_split(cases, audio['clips'])
    result.update({'corpusSha256': source_hashes, 'audioManifestSha256': hashlib.sha256(audio_path.read_bytes()).hexdigest(), 'policy': 'Target 80/10/10 by whole related-conversation group. Exact normalized transcript/audio overlap removed from lower-priority partitions. Filtered independent STT clips, not complete-conversation LLM training. All six synthetic voices may recur across partitions; no unseen-speaker claim.', 'primaryScore': 'One deterministic representative per normalized transcript within each partition; full retained clip score secondary.'})
    result['summary'] = {name: {'conversations': len(result['caseAssignments'][name]), 'retainedClips': len(rows), 'uniqueTranscripts': len({transcript_key(item['reference']) for item in rows}), 'voices': sorted({item['voice'] for item in rows})} for name, rows in result['clips'].items()}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'summary': result['summary'], 'groups':len(result['groups']), 'largestGroup':max(len(group['cases']) for group in result['groups']), 'excluded':len(result['exclusions'])},indent=2))


if __name__ == '__main__':
    import sys
    main(sys.argv[1])
