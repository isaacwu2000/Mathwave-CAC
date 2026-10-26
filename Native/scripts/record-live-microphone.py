#!/usr/bin/env python3
"""Record an isolated simulator while real microphone audio drives the app.

Start/Stop are operated through the app UI. After Start, this helper plays a
synthetic utterance through the host output. It retains the actual microphone
CAF using a hard link before the app deletes its temporary recording. No audio
fixture, transcript or model output is supplied to the app. Host defaults stay
unchanged. Run only with the intended microphone and speakers selected.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import uuid

SPEC = importlib.util.spec_from_file_location('record_custom_models', Path(__file__).with_name('record-custom-models.py'))
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--utterance', required=True)
    parser.add_argument('--device', default='0C1AE2E6-D69E-45D5-A1B7-5FF96E94C667')
    parser.add_argument('--expected-expression', default='2 * x + 3 * x - 4 = 11')
    args = parser.parse_args()
    app, output, utterance = Path(args.app).resolve(), Path(args.output).resolve(), Path(args.utterance).resolve()
    if not utterance.is_file(): raise ValueError('The playback utterance is missing.')
    output.mkdir(parents=True, exist_ok=False)
    models = COMMON.verify_models(app)
    bundle = 'org.example.mathaudio.playground'
    subprocess.run(['xcrun', 'simctl', 'install', args.device, str(app)], check=True)
    container = Path(subprocess.check_output(['xcrun', 'simctl', 'get_app_container', args.device, bundle, 'data'], text=True).strip())
    relative = Path('Documents')/'MathwaveVerification'/('live-'+uuid.uuid4().hex)
    directory = container/relative
    directory.mkdir(parents=True)
    events_path, readback = directory/'events.jsonl', directory/'readback.wav'
    report = {'lane':'Live simulator microphone; synthetic speech played through host speakers.',
      'inputSource':'microphone', 'appExecutableSha256':COMMON.sha256(app/'Mathwave'),
      'modelArtifacts':models, 'utterancePlaybackFile':str(utterance),
      'utterancePlaybackSha256':COMMON.sha256(utterance), 'device':args.device,
      'isolatedNotebook':str(relative), 'limits':['Not physical iPhone hardware or a human speaker.',
        'Original simulator video is silent; microphone and separately synthesized readback can be overlaid with approximate synchronization.',
        'Trace acceptance is separate from visual and audio review.']}
    video = None
    try:
        with (output/'video.log').open('w') as log:
            video = subprocess.Popen(['xcrun', 'simctl', 'io', args.device, 'recordVideo', '--codec=h264', str(output/'journey.mp4')], stdout=log, stderr=log)
            deadline = time.monotonic()+10
            while 'Recording started' not in (output/'video.log').read_text():
                if video.poll() is not None or time.monotonic()>deadline: raise RuntimeError('Video did not start.')
                time.sleep(0.1)
            report['recordingStartedObservedUnix'] = time.time()
            environment = {key:value for key,value in os.environ.items() if not key.startswith('SIMCTL_CHILD_MATHWAVE_')}
            for key,value in {'MATH_AUDIO_UI_TEST_ID':relative.name,
              'MATHWAVE_VERIFICATION_MODEL_MODE':'custom', 'MATHWAVE_TEST_COMMAND_ENTRY':'0',
              'MATHWAVE_VERIFICATION_EVENTS_PATH':str(relative/'events.jsonl'),
              'MATHWAVE_VERIFICATION_READBACK_PATH':str(relative/'readback.wav')}.items():
                environment['SIMCTL_CHILD_'+key] = value
            subprocess.run(['xcrun', 'simctl', 'launch', '--terminate-running-process', args.device, bundle], env=environment, check=True)
            print('READY: use the app UI to enable Spoken responses, then tap Voice input.', flush=True)
            deadline = time.monotonic()+180
            started = False
            while time.monotonic()<deadline:
                events = COMMON.collect_events(events_path)
                recording = next((event for event in events if event['event']=='customRecordingStarted'), None)
                if recording and not started:
                    if recording.get('source') != 'microphone': raise RuntimeError('App bypassed live microphone capture.')
                    candidates = [path for path in (container/'tmp').glob('mathwave-*.caf') if path.stat().st_mtime>=report['recordingStartedObservedUnix']]
                    if not candidates:
                        time.sleep(0.1)
                        continue
                    source = max(candidates, key=lambda path:path.stat().st_mtime)
                    os.link(source, output/'microphone.caf')
                    started = True
                    report['playbackStartedUnix'] = time.time()
                    subprocess.run(['afplay', str(utterance)], check=True)
                    report['playbackFinishedUnix'] = time.time()
                    print('PLAYBACK_FINISHED: tap Stop recording in the app UI.', flush=True)
                if any(event['event'].lower().endswith('failed') for event in events):
                    raise RuntimeError('The app emitted a failed-stage event.')
                if any(event['event']=='customRunCompleted' for event in events) and any(event['event']=='readbackcompleted' for event in events):
                    # Retain the visible result and allow audible readback to finish.
                    time.sleep(8)
                    break
                time.sleep(0.2)
            else: raise RuntimeError('Live capture did not finish within the bounded recording window.')
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        if video and video.poll() is None:
            video.send_signal(signal.SIGINT)
            video.wait(timeout=15)
        events = COMMON.collect_events(events_path)
        report['events'] = events
        (output/'events.jsonl').write_text('\n'.join(json.dumps(event) for event in events)+'\n')
        if readback.exists():
            (output/'readback.wav').write_bytes(readback.read_bytes())
        report['readbackFile'] = str(output/'readback.wav')
        captured = output/'microphone.caf'
        if captured.exists(): report['capturedInputSha256'] = COMMON.sha256(captured)
        report['traceVerification'] = COMMON.verify_events(events, models, args.expected_expression, output/'readback.wav', source='microphone')
        if not captured.exists() or captured.stat().st_size<=44:
            report['traceVerification']['pass'] = False
            report['traceVerification']['failures'].append('Actual microphone recording was not retained.')
        if report.get('failure') or not video or video.returncode not in (0, -signal.SIGINT):
            report['traceVerification']['pass'] = False
        (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    if not report['traceVerification']['pass']: raise RuntimeError('The live trace did not pass.')
    subprocess.run(['xcrun', 'simctl', 'io', args.device, 'screenshot', str(output/'result.png')], check=True)
    print('LIVE_TRACE_PASSED: inspect the recording and retained audio before acceptance.', flush=True)


if __name__ == '__main__':
    main()
