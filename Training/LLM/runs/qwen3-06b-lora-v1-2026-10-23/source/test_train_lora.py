"""Check loss masking and held-out partition integrity independently of a GPU."""
import unittest
from train_lora import training_tokens, partition_rows, aggregate_losses

class CharacterTokenizer:
    def apply_chat_template(self, messages, tokenize=False, add_generation_prompt=False, **kwargs):
        text=''.join(f"<{m['role']}>{m['content']}!" for m in messages)
        return text + ('<assistant>' if add_generation_prompt else '')
    def __call__(self, text, **kwargs):
        return {'input_ids':[ord(c) for c in text]}

class TrainingDataTests(unittest.TestCase):
    def test_only_final_answer_is_supervised_and_long_inputs_fail(self):
        row={'id':'one','messages':[{'role':'user','content':'secret prompt'},{'role':'assistant','content':'42'}]}
        item=training_tokens(row,CharacterTokenizer(),100)
        self.assertEqual([x for x in item['labels'] if x!=-100],[ord('4'),ord('2'),ord('!')])
        with self.assertRaisesRegex(ValueError,'exceeds'):
            training_tokens(row,CharacterTokenizer(),8)
    def test_conversation_cannot_cross_partitions(self):
        a={'id':'a','caseId':'same','messages':[]};b={**a,'id':'b'}
        with self.assertRaisesRegex(ValueError,'crosses'):
            partition_rows({'train':[a],'val':[b],'test':[]})
    def test_loss_is_weighted_by_supervised_tokens(self):
        self.assertAlmostEqual(aggregate_losses([(2.,1),(4.,3)]),3.5)
        with self.assertRaises(ValueError): aggregate_losses([])

if __name__=='__main__':unittest.main()
