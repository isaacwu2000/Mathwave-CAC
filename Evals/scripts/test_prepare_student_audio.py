"""Check that prepared training fixtures cannot silently reuse mislabeled audio."""
from array import array
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave
import prepare_student_audio as preparation


class PreparedAudioTests(unittest.TestCase):
    def test_text_and_voice_both_bind_the_recording(self):
        original = preparation.fingerprint('I meant negative three.', 'Samantha')
        self.assertNotEqual(original, preparation.fingerprint('I meant three.', 'Samantha'))
        self.assertNotEqual(original, preparation.fingerprint('I meant negative three.', 'Daniel'))

    def test_identical_words_in_different_files_keep_their_own_checksums(self):
        with tempfile.TemporaryDirectory() as directory:
            frozen = {}
            items = []
            for name, samples in [('first.wav', [0, 100, -100, 0]), ('second.wav', [0, 200, -200, 0])]:
                path = Path(directory) / name
                with wave.open(str(path), 'wb') as recording:
                    recording.setnchannels(1)
                    recording.setsampwidth(2)
                    recording.setframerate(16000)
                    recording.writeframes(array('h', samples).tobytes())
                frozen[(name, 'same words and voice')] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                items.append({'audio': name, 'fingerprint': 'same words and voice'})
            with patch.object(preparation, 'ROOT', Path(directory)), patch.object(preparation.subprocess, 'run', side_effect=AssertionError('Must reuse verified files')):
                for item in items:
                    self.assertEqual(preparation.prepare_clip(item, frozen)['bytes'], (Path(directory) / item['audio']).stat().st_size)

    def test_changed_recording_is_rejected_before_reuse(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'clip.wav'
            path.write_bytes(b'changed recording')
            item = {'audio': 'clip.wav', 'fingerprint': 'source'}
            frozen = {('clip.wav', 'source'): {'sha256': hashlib.sha256(b'original recording').hexdigest()}}
            with patch.object(preparation, 'ROOT', Path(directory)):
                with self.assertRaisesRegex(ValueError, 'damaged'):
                    preparation.prepare_clip(item, frozen)

    def test_verified_hash_does_not_hide_wrong_sample_rate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'clip.wav'
            with wave.open(str(path), 'wb') as recording:
                recording.setnchannels(1)
                recording.setsampwidth(2)
                recording.setframerate(8000)
                recording.writeframes(array('h', [0, 100, -100, 0]).tobytes())
            item = {'audio': 'clip.wav', 'fingerprint': 'source'}
            frozen = {('clip.wav', 'source'): {'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}}
            with patch.object(preparation, 'ROOT', Path(directory)):
                with self.assertRaisesRegex(ValueError, 'Unexpected audio format'):
                    preparation.prepare_clip(item, frozen)


if __name__ == '__main__':
    unittest.main()
