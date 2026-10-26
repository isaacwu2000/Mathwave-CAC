import unittest
from split_student_speech import grouped_split, transcript_key


class SpeechSplitTests(unittest.TestCase):
    def test_number_only_family_variants_never_cross_partitions(self):
        cases=[]
        clips=[]
        for i in range(20):
            cases.append({'id':str(i),'family':str(i),'category':'algebra','turns':[{'programs':[f'problem.save(math.equation("x+{i}=20"));']},{'programs':['math.solve(problem.currentEquation());']}]})
            clips.append({'case':str(i),'turn':1,'reference':f'My problem is number {i}.','sha256':str(i)})
        result=grouped_split(cases,clips)
        occupied=[name for name,ids in result['caseAssignments'].items() if ids]
        self.assertEqual(len(occupied),1)

    def test_heldout_transcripts_and_audio_do_not_enter_training(self):
        cases=[]
        clips=[]
        for i in range(30):
            cases.append({'id':str(i),'family':str(i),'category':'algebra','turns':[{'programs':[f'custom{i}();']},{'programs':[f'query{i}();']}]})
            clips.append({'case':str(i),'turn':1,'reference':'Read that back.','sha256':str(i)})
        result=grouped_split(cases,clips)
        self.assertEqual(result['clips']['train'],[])
        self.assertEqual(result['clips']['val'],[])
        self.assertTrue(result['clips']['test'])
        self.assertEqual(transcript_key('Negative three!'),transcript_key('negative three.'))
        self.assertNotEqual(transcript_key('negative three'),transcript_key('three'))


if __name__=='__main__':unittest.main()
