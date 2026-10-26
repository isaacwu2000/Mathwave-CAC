#!/usr/bin/env python3
"""Record one isolated Mac app window while the real journey is driven through its UI.

No clicks, transcripts or model responses are fabricated. The recording is silent;
actual input/readback WAVs and model events remain separate evidence. This script
never downloads runtimes or records the user's microphone/system audio.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
import plistlib
from pathlib import Path
import shutil
import signal
import subprocess
import time
import uuid

SPEC = importlib.util.spec_from_file_location('record_custom_models', Path(__file__).with_name('record-custom-models.py'))
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)
WINDOWS = '''import CoreGraphics
import Foundation
let pid = Int(CommandLine.arguments[1])!
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
let own = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
print(String(data: try JSONSerialization.data(withJSONObject: own), encoding:.utf8)!)
'''



def bundle_executable(app):
    """Resolve the built app's declared executable rather than assuming its product name."""
    app = Path(app)
    name = plistlib.loads((app/'Contents/Info.plist').read_bytes()).get('CFBundleExecutable')
    if not isinstance(name, str) or not name or Path(name).name != name:
        raise ValueError('The app has no valid CFBundleExecutable.')
    binary = app/'Contents/MacOS'/name
    if not binary.is_file(): raise ValueError('The declared app executable is missing.')
    return binary

def require_recorded_video(video, returncode):
    """A completed inference trace cannot stand in for an actual recording."""
    video = Path(video)
    if returncode not in (0, -signal.SIGINT):
        raise RuntimeError('Window recording failed; inspect video.log.')
    if not video.is_file() or video.stat().st_size == 0:
        raise RuntimeError('Window recording produced no nonempty video; let the timed recording finish and inspect video.log.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, help='Debug Mathwave.app containing the custom runtime and bundled Models.')
    parser.add_argument('--output', required=True, help='New directory inside the current user home.')
    parser.add_argument('--fixture', default=str(COMMON.DEFAULT_FIXTURE))
    parser.add_argument('--expected-expression', default=COMMON.EXPECTED_EXPRESSION)
    parser.add_argument('--duration', type=int, default=120)
    args = parser.parse_args()
    app, output, fixture = Path(args.app).resolve(), Path(args.output).resolve(), Path(args.fixture).resolve()
    if args.duration <= 0 or args.duration > 600 or not fixture.is_file():
        parser.error('Use a 1–600 second duration and an existing recorded WAV.')
    if not output.is_relative_to(Path.home().resolve()):
        parser.error('Debug evidence paths must lie inside the app home directory.')
    binary = bundle_executable(app)
    output.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(fixture, output/'input.wav')
    artifacts = COMMON.verify_models(app)
    report = {'startedUTC':datetime.now(timezone.utc).isoformat(), 'lane':'Actual Mac native app, recorded WAV recognition; UI must be driven separately.',
              'fixture':str(fixture), 'fixtureSha256':COMMON.sha256(fixture), 'modelArtifacts':artifacts, 'executableSha256':COMMON.sha256(binary),
              'expectedExpression':args.expected_expression, 'visualReview':'incomplete', 'videoReview':'incomplete', 'spokenReadbackReview':'incomplete',
              'audioLimit':'Window video is silent. Source WAV and actual synthesized readback are retained separately; not physical microphone evidence.'}
    env = {**os.environ, 'MATH_AUDIO_UI_TEST_ID':uuid.uuid4().hex,
           'MATHWAVE_VERIFICATION_MODEL_MODE':'custom', 'MATHWAVE_VERIFICATION_AUDIO_PATH':str(output/'input.wav'),
           'MATHWAVE_VERIFICATION_EVENTS_PATH':str(output/'events.jsonl'), 'MATHWAVE_VERIFICATION_READBACK_PATH':str(output/'readback.wav')}
    app_log = (output/'app.log').open('w')
    process = subprocess.Popen([str(binary)], env=env, stdout=app_log, stderr=subprocess.STDOUT)
    recorder = None
    try:
        until, windows = time.monotonic()+30, []
        while not windows:
            if process.poll() is not None or time.monotonic() >= until: raise RuntimeError('The isolated app did not open a window.')
            windows = json.loads(COMMON.command(['xcrun', 'swift', '-e', WINDOWS, str(process.pid)], timeout=30))
            if not windows: time.sleep(0.3)
        window = max(windows, key=lambda item: item.get('kCGWindowBounds',{}).get('Width',0)*item.get('kCGWindowBounds',{}).get('Height',0))
        report['window'] = window
        report['recordingStartRequestedUnix'] = time.time()
        report['readbackFile'] = str(output/'readback.wav')
        report['videoFile'] = str(output/'journey.mov')
        with (output/'video.log').open('w') as log:
            recorder = subprocess.Popen(['screencapture','-v','-l',str(window['kCGWindowNumber']),'-V',str(args.duration),str(output/'journey.mov')], stdout=log,stderr=subprocess.STDOUT)
            report['recordingStartedObservedUnix'] = time.time()
            report['recordingClockLimit'] = 'Approximate process-launch time; screencapture provides no confirmed first-frame timestamp.'
            print('Recording isolated Mathwave window. Use Settings → Custom and Spoken responses, then Voice input → stop → automatic result/readback. No keyboard entry or Run.',flush=True)
            try: recorder.wait(timeout=args.duration+30)
            except KeyboardInterrupt:
                recorder.send_signal(signal.SIGINT);recorder.wait(timeout=30)
        report['events'] = COMMON.collect_events(output/'events.jsonl')
        report['traceVerification'] = COMMON.verify_events(report['events'], artifacts, args.expected_expression, output/'readback.wav')
        require_recorded_video(output/'journey.mov', recorder.returncode)
        report['videoFileBytes'] = (output/'journey.mov').stat().st_size
        if not report['traceVerification']['pass']: raise RuntimeError('The actual custom-model journey is incomplete; inspect event trace.')
    except Exception as error:
        report['failure'] = {'type':type(error).__name__,'message':str(error)}
        raise
    finally:
        if recorder and recorder.poll() is None:
            recorder.send_signal(signal.SIGINT)
            try: recorder.wait(timeout=20)
            except subprocess.TimeoutExpired: recorder.terminate();recorder.wait(timeout=10)
        if process.poll() is None:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        app_log.close()
        report['finishedUTC']=datetime.now(timezone.utc).isoformat()
        (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__ == '__main__': main()
