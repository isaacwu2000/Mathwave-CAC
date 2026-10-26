"""Keep the frozen synthetic-voice fingerprint contract shared with v1 recordings."""
import hashlib
import json

VOICE_CYCLE = ['Samantha', 'Daniel', 'Flo (English (US))', 'Eddy (English (US))', 'Karen', 'Reed (English (US))']


def fingerprint(text, voice):
    """Bind exact words, voice, speaking rate and PCM audio format to one digest."""
    payload = {'text': text, 'voice': voice, 'rate': 165, 'format': 'PCM16 mono 16000Hz'}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
