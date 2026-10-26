"""Check recording evidence boundaries without launching apps, models or simulators."""
import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('record_custom_models', Path(__file__).with_name('record-custom-models.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

MAC_SPEC = importlib.util.spec_from_file_location('record_custom_models_macos', Path(__file__).with_name('record-custom-models-macos.py'))
MAC = importlib.util.module_from_spec(MAC_SPEC)
MAC_SPEC.loader.exec_module(MAC)


class RecordingEvidenceTests(unittest.TestCase):
    def test_copied_plan_preserves_products_and_unrelated_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root/'products/original.xctestrun'
            source.parent.mkdir()
            source.write_bytes(plistlib.dumps({'TestConfigurations':[{'TestTargets':[{
                'BlueprintName':'MathwaveUITests',
                'TestBundlePath':'__TESTROOT__/Debug/MathwaveUITests.xctest',
                'EnvironmentVariables':{'KEEP':'unchanged'},
            }]}]}))
            output = root/'copied.xctestrun'
            MODULE.configure_test_run(source, output, {'MATHWAVE_VERIFICATION_AUDIO_PATH':'Documents/MathwaveVerification/isolated/input.wav'})
            target = plistlib.loads(output.read_bytes())['TestConfigurations'][0]['TestTargets'][0]
            self.assertEqual(target['TestBundlePath'], str(source.resolve().parent/'Debug/MathwaveUITests.xctest'))
            self.assertEqual(target['EnvironmentVariables']['KEEP'], 'unchanged')
            self.assertEqual(target['EnvironmentVariables']['MATHWAVE_VERIFICATION_AUDIO_PATH'], 'Documents/MathwaveVerification/isolated/input.wav')
            self.assertFalse(Path(target['EnvironmentVariables']['MATHWAVE_VERIFICATION_AUDIO_PATH']).is_absolute())
            self.assertEqual(target['UITargetAppEnvironmentVariables']['MATHWAVE_VERIFICATION_AUDIO_PATH'], 'Documents/MathwaveVerification/isolated/input.wav')
            with self.assertRaises(FileExistsError): MODULE.configure_test_run(source, output, {})

    def test_missing_test_target_does_not_write_a_fake_plan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, output = root/'source.xctestrun', root/'copy.xctestrun'
            source.write_bytes(plistlib.dumps({'TestConfigurations':[]}))
            with self.assertRaisesRegex(ValueError, 'no MathwaveUITests'): MODULE.configure_test_run(source, output, {})
            self.assertFalse(output.exists())

    def test_actual_hash_is_verified_before_models_are_claimed(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary)/'Models';app.mkdir()
            (app/'speech.bin').write_bytes(b'abc')
            (app/'language.gguf').write_bytes(b'abc')
            digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
            metadata = {'formatVersion':1, 'speech':{'file':'speech.bin','sha256':digest},'language':{'file':'language.gguf','sha256':digest}}
            (app/'manifest.json').write_text(json.dumps(metadata))
            result = MODULE.verify_models(app.parent)
            self.assertEqual(result['models']['speech']['actualSha256'], digest)
            (app/'language.gguf').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'language model hash'): MODULE.verify_models(app.parent)

    def test_ui_success_without_actual_inference_and_readback_is_incomplete(self):
        with tempfile.TemporaryDirectory() as temporary:
            models = {'models':{kind:{'actualSha256':'0'*64} for kind in ('speech','language')}}
            result = MODULE.verify_events([{'event':'customRunCompleted','expression':'x = 5'}], models, 'x = 5', Path(temporary)/'missing.wav')
            self.assertFalse(result['pass'])
            self.assertEqual(result['languageInferenceCount'],0)
            self.assertTrue(any('customLLMcompleted' in error for error in result['failures']))
            self.assertTrue(any('WAV' in error for error in result['failures']))

    def test_live_source_is_never_accepted_as_a_recorded_fixture(self):
        models = {'models':{kind:{'actualSha256':'0'*64} for kind in ('speech','language')}}
        events = [{'event':'customRecordingStarted', 'source':'microphone'}]
        default = MODULE.verify_events(events, models, 'x = 5', 'missing.wav')
        self.assertTrue(any('source' in error for error in default['failures']))
        live = MODULE.verify_events(events, models, 'x = 5', 'missing.wav', source='microphone')
        self.assertFalse(any('source' in error for error in live['failures']))
        self.assertFalse(live['pass'])
        with self.assertRaises(ValueError):
            MODULE.verify_events(events, models, 'x = 5', 'missing.wav', source='anything')

    def test_mac_recorder_uses_the_bundles_actual_executable(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary)/'Math Audio.app'
            binary = app/'Contents/MacOS/MathAudio'
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b'fixture executable, never launched')
            (app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable':'MathAudio'}))
            self.assertEqual(MAC.bundle_executable(app), binary)
            binary.unlink()
            with self.assertRaisesRegex(ValueError, 'missing'): MAC.bundle_executable(app)

    def test_mac_recording_requires_actual_nonempty_video(self):
        with tempfile.TemporaryDirectory() as temporary:
            video = Path(temporary)/'journey.mov'
            with self.assertRaisesRegex(RuntimeError, 'no nonempty video'):
                MAC.require_recorded_video(video, 0)
            video.touch()
            with self.assertRaisesRegex(RuntimeError, 'no nonempty video'):
                MAC.require_recorded_video(video, -2)
            video.write_bytes(b'recorded output validation fixture')
            MAC.require_recorded_video(video, 0)
            with self.assertRaisesRegex(RuntimeError, 'recording failed'):
                MAC.require_recorded_video(video, 1)


if __name__ == '__main__':
    unittest.main()
