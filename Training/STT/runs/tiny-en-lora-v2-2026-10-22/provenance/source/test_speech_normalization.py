"""Check speech equivalence without hiding mathematical or correction errors."""
import unittest

from speech_normalization import normalize_tokens, word_errors


class SpeechNormalizationTests(unittest.TestCase):
    def assert_equivalent(self, first, second):
        self.assertEqual(normalize_tokens(first), normalize_tokens(second))

    def test_cardinals_and_hyphenated_compounds(self):
        for words, digits in [('zero', '0'), ('nineteen', '19'), ('twenty three', '23'), ('twenty-three', '23'), ('ninety nine', '99'), ('one hundred and five', '105'), ('two hundred thirty six', '236'), ('one thousand and nine', '1009'), ('one thousand and two hundred', '1200'), ('one million and two hundred thousand and three', '1200003'), ('twelve thousand three hundred forty five', '12345'), ('one million two hundred thirty four thousand five hundred six', '1234506')]:
            with self.subTest(words=words):
                self.assert_equivalent('Graph ' + words, 'Graph ' + digits)

    def test_and_separates_a_list_except_inside_explicit_large_numbers(self):
        self.assertEqual(normalize_tokens('one and two'), ['1', 'and', '2'])
        self.assertEqual(normalize_tokens('one hundred and two and five'), ['102', 'and', '5'])
        self.assertEqual(normalize_tokens('one, two, three'), ['1', '2', '3'])
        self.assertEqual(normalize_tokens('two four six'), ['2', '4', '6'])
        self.assertEqual(normalize_tokens('twenty, three'), ['20','3'])

    def test_decimals_keep_leading_fractional_zeros(self):
        for words, digits in [('zero point zero five','0.05'), ('twenty-three point five','23.5'), ('negative zero point zero five','-0.05'), ('minus two point five','-2.5'), ('one point two zero','1.20')]:
            with self.subTest(words=words): self.assert_equivalent(words, digits)
        self.assert_equivalent('.5', 'zero point five')

    def test_basic_math_notation(self):
        pairs = [('x squared plus three equals eleven','x^2+3=11'), ('y cubed minus x squared','y³ − x²'), ('two times x divided by three','2*x/3'), ('two times x divided by three','2 × x ÷ 3'), ('x to the power of four','x^4'), ('x raised to the power of four','x^4')]
        for first, second in pairs:
            with self.subTest(first=first): self.assert_equivalent(first, second)

    def test_inequalities_and_coordinates(self):
        for first, second in [('x less than or equal to negative three','x<=-3'), ('y greater than five','y>5'), ('x greater than or equal to zero','x≥0'), ('x is not equal to two','x is ≠ 2'), ('open parenthesis negative two comma three close parenthesis','(-2,3)')]:
            with self.subTest(first=first): self.assert_equivalent(first, second)

    def test_preserves_commands_corrections_and_pronouns(self):
        self.assertEqual(normalize_tokens('Wait, change a three to negative three.'), ['wait', 'change', 'a', '3', 'to', '-', '3'])
        self.assertEqual(normalize_tokens('Read that one first.'), ['read','that','one','first'])
        self.assertEqual(normalize_tokens('The first one, not the second one.'), ['the','first','one','not','the','second','one'])
        self.assertEqual(normalize_tokens('Draw a half circle.'), ['draw','a','half','circle'])
        self.assertEqual(normalize_tokens('I meant pi, not pie.'), ['i','meant','pi','not','pie'])
        self.assertNotEqual(normalize_tokens('um graph x'), normalize_tokens('graph x'))

    def test_hard_negatives_remain_different(self):
        pairs=[('x minus three','x plus three'), ('zero point zero five','zero point five'), ('twenty three','twenty minus three'), ('twenty-three','twenty - three'), ('change a three to negative three','change a three to three'), ('make it half as big','make it double as big'), ('x less than three','x less than or equal to three'), ('x squared','x cubed'), ('(2,3)','(3,2)'), ('one thousand and two','one thousand and twenty'), ('I said three, not four','I said four, not three')]
        for first,second in pairs:
            with self.subTest(first=first): self.assertNotEqual(normalize_tokens(first),normalize_tokens(second))

    def test_fraction_words_are_preserved_without_arithmetic(self):
        self.assertEqual(normalize_tokens('one half plus three quarters'), ['1','half','+','3','quarters'])

    def test_underspecified_number_sequences_do_not_merge(self):
        self.assertEqual(normalize_tokens('twenty thirteen'), ['20','13'])
        self.assertEqual(normalize_tokens('zero hundred'), ['0','hundred'])
        self.assertEqual(normalize_tokens('hundred'), ['hundred'])
        self.assertEqual(normalize_tokens('one thousand thousand'), ['1000','thousand'])

    def test_comma_punctuation_does_not_change_word_score(self):
        self.assert_equivalent('Wait, change three to negative three.', 'Wait change three to negative three')
        self.assert_equivalent('(2,3)', '(2 3)')
        self.assert_equivalent('open parenthesis two comma three close parenthesis', '(2,3)')
        self.assertNotEqual(normalize_tokens('(2,3)'), normalize_tokens('(3,2)'))

    def test_numeric_spelling_and_sentence_punctuation(self):
        self.assert_equivalent('Graph 1.500!', 'graph one point five.')
        self.assertEqual(normalize_tokens('X = 1e-3'), ['x','=','0.001'])
        self.assertEqual(normalize_tokens('At point A, stop.'), ['at','point','a','stop'])

    def test_word_edit_distance(self):
        self.assertEqual(word_errors(['x','-','3'],['x','+','3']),1)
        self.assertEqual(word_errors([],['x']),1)
        self.assertEqual(word_errors(['x'],[]),1)
        self.assertEqual(word_errors(['x','3'],['x','3']),0)


if __name__ == '__main__': unittest.main()
