"""Score a recorded pilot with the existing frozen speech normalization rules."""
import json
from pathlib import Path
import sys
from benchmark_local_speech import tokens, errors


def score(path):
    """Write per-request and aggregate results without network calls or altered recordings."""
    ledger = json.loads(path.read_text())
    groups, details = {}, []
    for row in ledger['records']:
        if row['status'] != 'complete':
            continue
        reference, prediction = tokens(row['reference']), tokens(row['transcript'])
        distance = errors(reference, prediction)
        details.append({key: row[key] for key in ['case', 'turn', 'model', 'reference', 'transcript', 'costUsd', 'elapsedMs']} | {'wordErrors': distance, 'referenceWords': len(reference), 'normalizedExact': reference == prediction})
        group = groups.setdefault(row['model'], {'clips': 0, 'wordErrors': 0, 'referenceWords': 0, 'normalizedExact': 0, 'costUsd': 0})
        for key, value in [('clips', 1), ('wordErrors', distance), ('referenceWords', len(reference)), ('normalizedExact', int(reference == prediction)), ('costUsd', row['costUsd'])]:
            group[key] += value
    for group in groups.values():
        group['wordErrorRate'] = group['wordErrors'] / group['referenceWords'] if group['referenceWords'] else None
    report = {'lane': 'Small recorded synthetic speech transcription sample; no context, no math answers, no training.', 'scorer': 'benchmark_local_speech.py tokens/errors: case, punctuation and small number words normalized; math signs retained.', 'limits': 'Eight paired clips from three conversations, two macOS TTS voices. Not human speech, streaming latency, iPhone or broad model quality. Fourth prepared conversation not tested after rate limit.', 'completed': len(details), 'budget': {'capUsd': ledger['capUsd'], 'reportedSpendUsd': ledger['spentUsd'], 'unknownChargeReservationUsd': ledger['reservedUnknownUsd'], 'note': 'Request 17 returned HTTP429 without cost. Stopped without retry/fallback. Reserve is not asserted spent.'}, 'models': groups, 'turns': details, 'visualReview': 'Audio-only lane. Full 400-case actual-app visual acceptance remains incomplete.'}
    path.with_name('transcription-scores.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(groups, indent=2))


if __name__ == '__main__':
    score(Path(sys.argv[1]))
