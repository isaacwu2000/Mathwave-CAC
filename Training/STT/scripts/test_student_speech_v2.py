"""Exercise split leakage, related-task grouping, balance, and audio-file ownership."""
from collections import Counter
import copy
import json
from pathlib import Path
import tempfile
import unittest

from student_speech_v2 import (
    assign_groups, audit, conversation_groups, grouped_split,
    load_cases, stratum, synthesize_clip, transcript_key,
)


def suffix(index):
    """Produce unique letter-only tool names that numeric masking cannot merge."""
    return chr(97 + index // 26) + chr(97 + index % 26)


def fixtures(counts):
    """Give unrelated tasks a common setup but distinct complete query sequences."""
    cases, clips = [], []
    for category, count in counts.items():
        for number in range(count):
            ident = category + '-' + str(number)
            case = {'id': ident, 'family': ident, 'category': category,
                    'turns': [{'student': 'Start ' + ident, 'programs': ['problem.save(math.equation("x+3=5"));']},
                              {'student': 'Read ' + ident, 'programs': ['task.' + category.replace('-', '') + suffix(number) + '();']}]}
            cases.append(case)
            for turn, item in enumerate(case['turns'], 1):
                clips.append({'case': ident, 'family': ident, 'turn': turn, 'reference': item['student'],
                              'sha256': 'wave-' + ident + '-' + str(turn), 'voice': 'Samantha'})
    return cases, clips


class StudentSpeechV2Tests(unittest.TestCase):
    def test_shared_first_equation_does_not_merge_different_tasks(self):
        cases, _ = fixtures({'algebra': 30})
        groups = conversation_groups(cases)
        self.assertEqual(len(groups), 30)

    def test_complete_number_variants_stay_together(self):
        cases = []
        for number in [2, 3, 5]:
            cases.append({'id': str(number), 'family': str(number), 'category': 'algebra', 'turns': [
                {'programs': [f'problem.save(math.equation("{number}*x+1=7"));']},
                {'programs': [f'problem.save(math.divideBothSides(problem.currentEquation(),{number}));']}]})
        self.assertEqual(conversation_groups(cases), [['2', '3', '5']])
        assignments, _ = assign_groups(cases, conversation_groups(cases))
        self.assertEqual(sum(bool(ids) for ids in assignments.values()), 1)

    def test_preview_status_and_turn_boundaries_distinguish_sequences(self):
        original = {'id': 'base', 'family': 'base', 'category': 'algebra', 'turns': [
            {'programs': ['problem.save(math.expression("x+2"));']},
            {'programs': ['math.read(problem.currentEquation());']}]}
        variants = [original]
        for label in ['preview', 'status', 'boundary']:
            case = copy.deepcopy(original)
            case['id'] = label
            if label == 'preview':
                case['turns'][1]['previews'] = case['turns'][1]['programs']
                case['turns'][1]['programs'] = []
            elif label == 'status':
                case['turns'][1]['status'] = 'explanation'
            else:
                case['turns'][0]['programs'].extend(case['turns'][1]['programs'])
                case['turns'][1]['programs'] = []
            variants.append(case)
        self.assertEqual(len(conversation_groups(variants)), 4)

    def test_six_strata_balance_with_indivisible_parallel_group(self):
        cases, clips = fixtures({'algebra': 185, 'arithmetic': 15, 'graphs': 100, 'geometry': 100,
                                 'statistics': 50, 'cross-topic': 25, 'history-and-diagrams': 25})
        for case in cases:
            if case['category'] == 'geometry' and int(case['id'].split('-')[-1]) < 24:
                case['family'] = 'parallel-' + case['id']
        result = grouped_split(cases, clips)
        self.assertEqual(result, grouped_split(list(reversed(cases)), list(reversed(clips))))
        # Whole-group placement may differ by a few cases, but every stratum gets a holdout.
        totals = Counter(stratum(case) for case in cases)
        self.assertEqual(len(totals), 6)
        for name, fraction in [('train', .8), ('val', .1), ('test', .1)]:
            for category, total in totals.items():
                count = result['summary'][name]['byCategory'][category]['conversations']
                self.assertLessEqual(abs(count - total * fraction), 2)
                self.assertGreater(count, 0)
        for name in ['val', 'test']:
            self.assertGreaterEqual(result['summary'][name]['byOriginalCategory']['arithmetic']['conversations'], 1)
        parallel = {case['id'] for case in cases if case['family'].startswith('parallel-')}
        owners = [name for name, ids in result['caseAssignments'].items() if parallel.intersection(ids)]
        self.assertEqual(len(owners), 1)
        self.assertEqual(len(parallel), 24)

    def test_actual_corpus_keeps_arithmetic_in_both_holdouts(self):
        cases, _ = load_cases()
        assignments, _ = assign_groups(cases, conversation_groups(cases))
        originals = {case['id']: case['category'] for case in cases}
        arithmetic = {name: sum(originals[ident] == 'arithmetic' for ident in ids)
                      for name, ids in assignments.items()}
        self.assertEqual(arithmetic['train'], 12)
        self.assertEqual(sorted([arithmetic['val'], arithmetic['test']]), [1, 2])
        for name, target in [('train', 160), ('val', 20), ('test', 20)]:
            combined = sum(originals[ident] in {'algebra', 'arithmetic', 'equations'}
                           for ident in assignments[name])
            self.assertEqual(combined, target)

    def test_normalized_text_and_waveforms_excluded_with_heldout_priority(self):
        cases, clips = fixtures({'algebra': 40})
        first = grouped_split(cases, clips)
        test = first['caseAssignments']['test'][0]
        val = first['caseAssignments']['val'][0]
        train = first['caseAssignments']['train'][0]
        for row in clips:
            if row['turn'] == 1 and row['case'] in [test, val, train]:
                row['reference'] = {'test': 'twenty-one', 'val': '21', 'train': 'twenty one'}[
                    'test' if row['case'] == test else 'val' if row['case'] == val else 'train']
            if row['case'] in [test, train] and row['turn'] == 2:
                row['sha256'] = 'shared-wave'
        result = grouped_split(cases, clips)
        excluded = {(row['case'], row['turn']) for row in result['exclusions']}
        self.assertTrue({(val, 1), (train, 1), (train, 2)}.issubset(excluded))
        self.assertIn((test, 1), {(row['case'], row['turn']) for row in result['clips']['test']})
        self.assertEqual(transcript_key('twenty-one'), transcript_key('21'))
        self.assertNotEqual(transcript_key('negative twenty-one'), transcript_key('21'))

    def test_primary_representatives_are_fixed_once_across_categories(self):
        cases, clips = fixtures({'algebra': 40, 'graphs': 40})
        assigned = grouped_split(cases, clips)['caseAssignments']
        ids = assigned['test'][:2]
        for row in clips:
            if row['case'] in ids and row['turn'] == 1:
                row['reference'] = 'Read the last step.'
        result = grouped_split(cases, clips)
        rows = result['clips']['test']
        expected = sorted((row for row in rows if row['reference'] == 'Read the last step.'), key=lambda row: (row['case'], row['turn']))[0]
        chosen = [row for row in result['primaryRepresentatives']['test'] if row['case'] in ids and row['turn'] == 1]
        self.assertEqual([(row['case'], row['turn']) for row in chosen], [(expected['case'], 1)])

    def test_audit_detects_missing_turn_and_modified_partition(self):
        cases, clips = fixtures({'algebra': 30})
        manifest = {'clips': clips}
        result = grouped_split(cases, clips)
        self.assertEqual(audit(cases, manifest, result, verify_audio=False)['conversations'], 30)
        with self.assertRaisesRegex(ValueError, 'Missing turns'):
            audit(cases, {'clips': clips[:-1]}, verify_audio=False)
        result['caseAssignments']['train'].pop()
        with self.assertRaisesRegex(ValueError, 'caseAssignments'):
            audit(cases, manifest, result, verify_audio=False)

    def test_audio_generation_cannot_touch_v1_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'Evals/inputs/student-conversations-v1/audio/old.wav'
            target.parent.mkdir(parents=True)
            target.write_bytes(b'frozen evidence')
            with self.assertRaisesRegex(ValueError, 'outside v2'):
                synthesize_clip({'audio': str(target.relative_to(root))}, {}, root)
            self.assertEqual(target.read_bytes(), b'frozen evidence')

    def test_load_cases_preserves_original_categories_and_rejects_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            from student_speech_v2 import SOURCES
            for index, relative in enumerate(SOURCES):
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps([{'id': str(index), 'category': 'arithmetic', 'turns': [{}, {}]}]))
            cases, hashes = load_cases(root)
            self.assertEqual(len(cases), 5)
            self.assertEqual(cases[0]['category'], 'arithmetic')
            self.assertEqual(stratum(cases[0]), 'algebra')
            self.assertEqual(set(hashes), {str(path) for path in SOURCES})
            (root / SOURCES[-1]).write_text((root / SOURCES[0]).read_text())
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                load_cases(root)


if __name__ == '__main__':
    unittest.main()
