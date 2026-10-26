import unittest
from train_student_speech import summarize, unique_rows


class SpeechExperimentScoringTests(unittest.TestCase):
    def test_repeated_transcripts_do_not_inflate_primary_score(self):
        rows=[{'reference':'x minus two','referenceWords':3,'wordErrors':1,'exact':False,'rawReferenceWords':3,'rawErrors':1,'mathReferenceTokens':3,'mathErrors':1,'generationSeconds':.4,'audioSeconds':1.5}, {'reference':'x minus two','referenceWords':3,'wordErrors':0,'exact':True,'rawReferenceWords':3,'rawErrors':0,'mathReferenceTokens':3,'mathErrors':0,'generationSeconds':.3,'audioSeconds':1.5}]
        scores=summarize(rows)
        self.assertEqual(scores['uniqueTranscript']['clips'],1)
        self.assertEqual(scores['uniqueTranscript']['normalizedWER'],1/3)
        self.assertEqual(scores['allClips']['clips'],2)
        self.assertEqual(scores['allClips']['normalizedWER'],1/6)
        self.assertEqual(scores['allClips']['normalizedExact'],1)

    def test_representative_is_frozen_by_order_not_model_success(self):
        rows=[{'reference':'Undo that.','exact':False},{'reference':'undo that!','exact':True}]
        self.assertEqual(unique_rows(rows),[rows[0]])

    def test_empty_partition_cannot_report_perfect_performance(self):
        with self.assertRaisesRegex(ValueError,'Empty'):
            summarize([])


if __name__=='__main__':unittest.main()
