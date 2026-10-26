import unittest
from benchmark_local_speech import tokens, errors


class TranscriptScoringTests(unittest.TestCase):
    def test_number_formatting_does_not_count_as_a_speech_error(self):
        self.assertEqual(tokens('Write two x plus three equals eleven.'), tokens('Write 2x + 3 = 11.'))

    def test_wrong_sign_and_wrong_number_remain_errors(self):
        self.assertEqual(errors(tokens('x plus three'), tokens('x minus five')), 2)

    def test_missing_and_extra_words_are_counted(self):
        self.assertEqual(errors(['subtract', '3', 'from', 'both', 'sides'], ['subtract', '3', 'from', 'the', 'left', 'side']), 3)


if __name__ == '__main__':
    unittest.main()
