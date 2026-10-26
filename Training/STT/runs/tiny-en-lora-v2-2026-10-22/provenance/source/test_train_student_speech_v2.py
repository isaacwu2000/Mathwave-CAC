"""Check speech result aggregation without running or importing a model runtime."""
import unittest

import train_student_speech_v2 as training


def scored(reference, category, mistakes=0):
    """Make independently counted rows for summary arithmetic and duplicate selection."""
    count = 2 if reference == 'Read two' else 4
    return {'reference':reference, 'category':category, 'referenceWords':count,
            'rawReferenceWords':count, 'mathReferenceTokens':2,
            'wordErrors':mistakes, 'rawErrors':mistakes, 'mathErrors':mistakes,
            'exact':mistakes == 0, 'generationSeconds':1, 'audioSeconds':2}


class SpeechSummaryTests(unittest.TestCase):
    def test_unique_identity_uses_canonical_number_and_operator_spelling(self):
        first = scored('graph x squared', 'graphs')
        duplicate = scored('Graph x^2.', 'geometry', 1)
        rows = training.unique_rows([first, duplicate])
        self.assertEqual(rows, [first])
        self.assertEqual(training.transcript_key('twenty three'), training.transcript_key('23'))
        self.assertNotEqual(training.transcript_key('negative three'), training.transcript_key('three'))

    def test_weighted_aggregate_keeps_full_audio_separate_from_unique_transcripts(self):
        rows = [scored('graph x squared', 'graphs'), scored('Graph x^2.', 'geometry', 1), scored('Read two', 'statistics', 1)]
        result = training.summarize(rows)
        self.assertEqual(result['uniqueTranscript']['clips'], 2)
        self.assertEqual(result['allClips']['clips'], 3)
        self.assertAlmostEqual(result['uniqueTranscript']['normalizedWER'], 1/6)
        self.assertAlmostEqual(result['allClips']['normalizedWER'], 2/10)
        self.assertEqual(result['uniqueTranscript']['normalizedExact'], 1)
        self.assertEqual(result['allClips']['generationSeconds'], 3)

    def test_global_duplicates_are_removed_before_category_scores(self):
        rows = [scored('graph x squared', 'graphs'), scored('Graph x^2.', 'geometry', 1), scored('Read two', 'statistics', 1)]
        result = training.summarize(rows)
        self.assertEqual(set(result['uniqueTranscript']['byCategory']), {'graphs','statistics'})
        self.assertEqual(result['allClips']['byCategory']['geometry']['clips'], 1)
        self.assertEqual(sum(group['clips'] for group in result['uniqueTranscript']['byCategory'].values()), 2)
        self.assertEqual(sum(group['referenceWords'] for group in result['uniqueTranscript']['byCategory'].values()), 6)

    def test_empty_partition_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Empty'):
            training.summarize([])

    def test_zero_math_denominator_is_reported_as_unavailable(self):
        row=scored('Read two', 'statistics')
        row['mathReferenceTokens']=0
        self.assertIsNone(training.summarize([row])['allClips']['mathTokenErrorRate'])

    def test_math_diagnostic_keeps_canonical_operators_signs_and_variable_letters(self):
        self.assertEqual(training.math_tokens(['change','a','3','to','-','3','not','+','3']), ['a','3','-','3','not','+','3'])
        for operator in ['+','-','*','/','^','=','<','>','<=','>=','!=']:
            with self.subTest(operator=operator):
                self.assertIn(operator, training.math_tokens(['x',operator,'3']))


if __name__ == '__main__': unittest.main()
