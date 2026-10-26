"""Normalize math speech without evaluating arithmetic or dropping ordinary words.

Cardinals through millions and digit-by-digit decimals have exact numeric spelling.
Operators retain their identities; parentheses and ratio colons remain tokens.
Literal and spoken commas are ignored so punctuation choices do not affect WER.
Ordinals and fraction words remain words. Common pronoun uses of "one" stay words.
Ambiguous standalone "point five", homophones such as pie/pi, malformed numbers,
and number names beyond million are deliberately not inferred.
"""
from decimal import Decimal, InvalidOperation
import re

_SMALL = dict(zip('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(), range(20)))
_TENS = dict(zip('twenty thirty forty fifty sixty seventy eighty ninety'.split(), range(20, 100, 10)))
_SCALES = {'thousand': 1000, 'million': 1000000}
_DIGITS = {word: str(value) for word, value in _SMALL.items() if value < 10}
_NUMBER = re.compile(r'(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?\Z', re.I)
_TOKEN = re.compile(r'(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+(?:\'[a-z]+)?|<=|>=|!=|[^\w\s.!?\"]', re.I)
_COMPOUND = re.compile(r'\b(' + '|'.join(_TENS) + r')-(' + '|'.join(word for word, value in _SMALL.items() if 0 < value < 10) + r')\b')
_PHRASES = [
    (('raised', 'to', 'the', 'power', 'of'), ('^',)),
    (('greater', 'than', 'or', 'equal', 'to'), ('>=',)),
    (('less', 'than', 'or', 'equal', 'to'), ('<=',)),
    (('to', 'the', 'power', 'of'), ('^',)),
    (('greater', 'than', 'or', 'equal'), ('>=',)),
    (('less', 'than', 'or', 'equal'), ('<=',)),
    (('not', 'equal', 'to'), ('!=',)),
    (('to', 'the', 'power'), ('^',)),
    (('open', 'parenthesis'), ('(',)),
    (('close', 'parenthesis'), (')',)),
    (('greater', 'than'), ('>',)),
    (('less', 'than'), ('<',)),
    (('divided', 'by'), ('/',)),
    (('equal', 'to'), ('=',)),
]
_WORD_OPERATORS = {'plus': '+', 'minus': '-', 'negative': '-', 'times': '*', 'equals': '=', 'squared': '^ 2', 'cubed': '^ 3', 'comma': '', ',': ''}
_PRONOUN_BEFORE = {'that', 'this', 'which', 'each', 'another', 'first', 'second', 'third', 'last', 'the', 'other'}


def _under_hundred(words, start):
    """Read one well-formed cardinal below one hundred, without joining a list."""
    if start >= len(words):
        return None
    word = words[start]
    if word in _SMALL:
        return _SMALL[word], start + 1
    if word in _TENS:
        value, end = _TENS[word], start + 1
        if end < len(words) and 0 < _SMALL.get(words[end], 0) < 10:
            value += _SMALL[words[end]]
            end += 1
        return value, end
    return None


def _under_thousand(words, start):
    """Accept an explicit one-to-nine hundred prefix and an optional final group."""
    first = _under_hundred(words, start)
    if first is None:
        return None
    value, end = first
    if 0 < value < 10 and end < len(words) and words[end] == 'hundred':
        value *= 100
        end += 1
        tail_start = end + 1 if end < len(words) and words[end] == 'and' else end
        tail = _under_hundred(words, tail_start)
        if tail is not None:
            value += tail[0]
            end = tail[1]
    return value, end


def _cardinal(words, start):
    """Join descending million/thousand groups; preserve unrelated conjunctions."""
    total, position, previous_scale = 0, start, 1000000000
    while True:
        group = _under_thousand(words, position)
        if group is None:
            return (total, position) if position != start else None
        value, end = group
        scale = _SCALES.get(words[end]) if end < len(words) else None
        if scale is None:
            return total + value, end
        if value == 0 or scale >= previous_scale:
            return (total, position) if position != start else group
        total += value * scale
        position, previous_scale = end + 1, scale
        # A conjunction joins groups only after an explicit large scale.
        # Ordinary small-number lists such as "one and two" remain separate.
        if position < len(words) and words[position] == 'and':
            tail = _under_thousand(words, position + 1)
            next_scale = _SCALES.get(words[tail[1]]) if tail is not None and tail[1] < len(words) else None
            if tail is not None and (next_scale is None or next_scale < previous_scale):
                position += 1
                continue
            return total, position


def _numeric_spelling(value):
    """Remove redundant decimal zeros without floating-point rounding or huge expansion."""
    try:
        number = Decimal(value)
        if not number.is_finite() or abs(number.adjusted()) > 512:
            return value.lower()
        result = format(number, 'f')
        return result.rstrip('0').rstrip('.') if '.' in result else result
    except InvalidOperation:
        return value.lower()


def normalize_tokens(text: str) -> list[str]:
    """Return canonical tokens for math speech; preserve commands and error-bearing words.

    Equivalent numeric and operator spellings share tokens. This does not infer
    missing parentheses, resolve homophones, simplify expressions, or remove fillers.
    Pronoun "one" is retained after common selectors and before "of".
    """
    text = text.lower().replace('−', '-').replace('–', '-').replace('×', '*').replace('÷', '/').replace('≤', '<=').replace('≥', '>=').replace('≠', '!=').replace('²', '^2').replace('³', '^3')
    words = _TOKEN.findall(_COMPOUND.sub(r'\1 \2', text))
    result, index = [], 0
    while index < len(words):
        matched = False
        for phrase, replacement in _PHRASES:
            if tuple(words[index:index + len(phrase)]) == phrase:
                result.extend(replacement)
                index += len(phrase)
                matched = True
                break
        if matched:
            continue
        word = words[index]
        pronoun = word == 'one' and ((index > 0 and words[index - 1] in _PRONOUN_BEFORE) or (index + 1 < len(words) and words[index + 1] == 'of')) and not (index + 1 < len(words) and words[index + 1] in {'hundred', 'thousand', 'million', 'point'})
        number = None if pronoun else _cardinal(words, index)
        if number is not None or _NUMBER.fullmatch(word):
            value, end = number if number is not None else (word, index + 1)
            # Decimal fractions use individual spoken digits, preserving leading zeros.
            if end < len(words) and words[end] == 'point':
                fraction, position = [], end + 1
                while position < len(words):
                    token = words[position]
                    digit = _DIGITS.get(token, token if token.isascii() and token.isdigit() else None)
                    if digit is None:
                        break
                    fraction.append(digit)
                    position += 1
                if fraction and '.' not in str(value) and 'e' not in str(value):
                    value, end = str(value) + '.' + ''.join(fraction), position
            result.append(_numeric_spelling(str(value)))
            index = end
            continue
        result.extend(_WORD_OPERATORS.get(word, word).split())
        index += 1
    return result


def word_errors(reference: list[str], hypothesis: list[str]) -> int:
    """Return token edit distance with insertion, deletion and substitution cost one."""
    previous = list(range(len(hypothesis) + 1))
    for row, expected in enumerate(reference, 1):
        current = [row]
        for column, actual in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[column] + 1, previous[column - 1] + (expected != actual)))
        previous = current
    return previous[-1]
