#!/usr/bin/env python3
"""Record a genuine local-model journey without injecting transcript or tool outputs.

Simulator video is silent. Source WAV and actual synthesized readback are retained
separately, with the app's event timeline; neither is presented as physical-mic input.
The caller owns the installed runtimes and model preparation. No downloads occur.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURE = ROOT / 'Evals/inputs/student-conversations-v1/audio/alg-combine-repeated-variable-1-bf897c108b96.wav'
EXPECTED_EXPRESSION = '2 * x + 3 * x - 4 = 11'
TEST = 'MathwaveUITests/MathwaveUITests/testCustomAudioAutomaticallyRunsWithoutCommandEntry'


def command(arguments, log=None, timeout=180):
    """Run one command without shell expansion; preserve logs and fail on nonzero exit."""
    if log is None:
        return subprocess.check_output([str(item) for item in arguments], text=True, timeout=timeout).strip()
    with Path(log).open('w') as handle:
        subprocess.run([str(item) for item in arguments], stdout=handle, stderr=subprocess.STDOUT,
                       check=True, timeout=timeout)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(4*1024**2), b''):
            digest.update(block)
    return digest.hexdigest()


def configure_test_run(source, destination, environment):
    """Copy a generated test plan while preserving its original product paths.

    - Injects only verification environment into the UI-test runner and app.
    - Expands TESTROOT because the copied plan lives in the evidence directory.
    - Refuses plans that do not contain the requested UI-test target.
    """
    source = Path(source).resolve()
    plan = plistlib.loads(source.read_bytes())
    targets = 0

    def visit(value):
        nonlocal targets
        if isinstance(value, str):
            return value.replace('__TESTROOT__', str(source.parent))
        if isinstance(value, list):
            return [visit(item) for item in value]
        if not isinstance(value, dict):
            return value
        result = {key: visit(item) for key, item in value.items()}
        if result.get('BlueprintName') == 'MathwaveUITests' or ('TestBundlePath' in result and 'MathwaveUITests' in result['TestBundlePath']):
            targets += 1
            result['EnvironmentVariables'] = {**result.get('EnvironmentVariables', {}), **environment}
            result['UITargetAppEnvironmentVariables'] = {**result.get('UITargetAppEnvironmentVariables', {}), **environment}
        return result

    updated = visit(plan)
    if not targets:
        raise ValueError('The generated test plan has no MathwaveUITests target.')
    with Path(destination).open('xb') as handle:
        plistlib.dump(updated, handle)


def collect_events(path):
    """Retain every emitted event without guessing missing recognition or inference stages."""
    if not Path(path).exists():
        return []
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]



def verify_models(app):
    """Hash the exact bundled model files before recording, refusing mismatched weights."""
    directory = next((candidate for candidate in (Path(app)/'Models', Path(app)/'Contents/Resources/Models') if (candidate/'manifest.json').exists()), Path(app)/'Models')
    metadata = json.loads((directory/'manifest.json').read_text())
    result = {'manifest': metadata, 'models': {}}
    for kind in ('speech', 'language'):
        entry = metadata[kind]
        filename = entry['file']
        if Path(filename).name != filename or not re.fullmatch(r'[a-fA-F0-9]{64}', entry['sha256']):
            raise ValueError('Invalid bundled model manifest entry.')
        path = directory/filename
        actual = sha256(path)
        if actual.lower() != entry['sha256'].lower():
            raise ValueError(f'{kind} model hash does not match its manifest.')
        result['models'][kind] = {**entry, 'actualSha256':actual, 'bytes':path.stat().st_size}
    return result


def verify_events(events, models, expected_expression, readback, source='recorded-fixture'):
    """Require real custom inference, the selected artifacts and a completed readback file.

    UI screenshots alone cannot prove that custom models ran. Failures remain
    recorded and never become success through deterministic parsing or Apple fallback.
    """
    if source not in ('recorded-fixture', 'microphone'):
        raise ValueError('Require an explicit recorded-fixture or microphone source.')
    failures = []
    by_name = {}
    for event in events:
        by_name.setdefault(event.get('event'), []).append(event)
    required = ('customRecordingStarted', 'customSTTstarted', 'customSTTcompleted',
                'customRunStarted', 'customLLMstarted', 'customLLMcompleted',
                'customRunCompleted', 'voiceCommandAccepted', 'readbackstarted', 'readbackcompleted',
                'speech_inference_finished', 'language_inference_finished')
    for name in required:
        if not by_name.get(name): failures.append('Missing actual event: '+name)
    for kind in ('speech', 'language'):
        loaded = by_name.get(kind+'_model_loaded', [])
        if not any(item.get('sha256', '').lower() == models['models'][kind]['actualSha256'].lower() for item in loaded):
            failures.append(kind+' loaded-model event does not match the verified bundled weights.')
    starts = by_name.get('customRecordingStarted', [])
    if not starts or any(event.get('source') != source for event in starts):
        failures.append('Actual input source differs from the declared '+source+' lane.')
    if not any(event.get('transcript', '').strip() for event in by_name.get('customSTTcompleted', [])):
        failures.append('Custom STT produced no transcript.')
    if not any(event.get('expression') == expected_expression for event in by_name.get('customRunCompleted', [])):
        failures.append('Native result differs from the independent expected expression.')
    if not Path(readback).exists() or Path(readback).stat().st_size <= 44:
        failures.append('Actual synthesized readback WAV is missing or empty.')
    failed_events = [event for event in events if str(event.get('event', '')).lower().endswith('failed')]
    if failed_events: failures.append('The app emitted failed-stage events; inspect the retained timeline.')
    return {'pass':not failures, 'failures':failures,
            'speechInferenceCount':len(by_name.get('speech_inference_finished', [])),
            'languageInferenceCount':len(by_name.get('language_inference_finished', [])),
            'limits':'Mechanical trace checks only; screenshots, video and readback audio still require inspection.'}

def simulator(args, output, report):
    """Run the app's XCTest journey and record only the explicitly selected simulator."""
    derived = Path(args.derived_data).resolve()
    command(['xcrun', 'simctl', 'bootstatus', args.device, '-b'], output/'boot.log')
    if not args.xctestrun:
        command(['xcodebuild', '-project', ROOT/'Native/Mathwave.xcodeproj', '-scheme', 'Mathwave',
                 '-sdk', 'iphonesimulator', '-destination', f'platform=iOS Simulator,id={args.device}',
                 '-derivedDataPath', derived, '-jobs', '2', 'build-for-testing',
                 'CODE_SIGNING_ALLOWED=NO', 'ONLY_ACTIVE_ARCH=YES'], output/'build.log', 1200)
        plans = sorted((derived/'Build/Products').glob('Mathwave_*.xctestrun'), key=lambda path: path.stat().st_mtime)
        if not plans:
            raise RuntimeError('Build produced no XCTest plan.')
        source_plan = plans[-1]
    else:
        source_plan = Path(args.xctestrun).resolve()
    app = Path(args.app).resolve() if args.app else derived/'Build/Products/Debug-iphonesimulator/Mathwave.app'
    bundle = plistlib.loads((app/'Info.plist').read_bytes())['CFBundleIdentifier']
    report['modelArtifacts'] = verify_models(app)
    report['executableSha256'] = sha256(app/'Mathwave')
    command(['xcrun', 'simctl', 'install', args.device, app], output/'install.log')
    # Install the freshly built test host as well as the app being tested.
    runner = app.parent/'MathwaveUITests-Runner.app'
    if runner.is_dir():
        runner_id = plistlib.loads((runner/'Info.plist').read_bytes())['CFBundleIdentifier']
        subprocess.run(['xcrun', 'simctl', 'terminate', args.device, runner_id], capture_output=True)
        command(['xcrun', 'simctl', 'install', args.device, runner], output/'runner-install.log')
        report['testRunnerSha256'] = sha256(runner/'PlugIns/MathwaveUITests.xctest/MathwaveUITests')
    container = Path(command(['xcrun', 'simctl', 'get_app_container', args.device, bundle, 'data']))
    isolated = uuid.uuid4().hex
    relative = Path('Documents/MathwaveVerification')/isolated
    staged = container/relative
    staged.mkdir(parents=True)
    shutil.copyfile(args.fixture, staged/'input.wav')
    environment = {
        'MATH_AUDIO_UI_TEST_ID': isolated,
        'MATHWAVE_VERIFICATION_AUDIO_PATH': str(relative/'input.wav'),
        'MATHWAVE_VERIFICATION_EVENTS_PATH': str(relative/'events.jsonl'),
        'MATHWAVE_VERIFICATION_READBACK_PATH': str(relative/'readback.wav'),
        'MATHWAVE_VERIFICATION_MODEL_MODE': 'custom',
        'MATHWAVE_VERIFICATION_EXPECTED_EXPRESSION': args.expected_expression,
    }
    configure_test_run(source_plan, output/'recording.xctestrun', environment)
    report.update(device=args.device, app=str(app), bundleIdentifier=bundle, test=TEST,
                  isolatedStorageID=isolated, initialAppEvidenceDirectory=str(staged), appEvidenceRelativePath=str(relative),
                  sourceTestPlan=str(source_plan), audioTrack='Simulator screen recording is silent; actual source/readback files are separate.')
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    video_log = (output/'video.log').open('w')
    recorder = subprocess.Popen(['xcrun', 'simctl', 'io', args.device, 'recordVideo', '--codec=h264', str(output/'journey.mp4')], stdout=video_log, stderr=subprocess.STDOUT)
    report['recordingStartRequestedUnix'] = time.time()
    try:
        until = time.monotonic()+15
        while 'Recording started' not in (output/'video.log').read_text():
            if recorder.poll() is not None or time.monotonic() >= until:
                raise RuntimeError('Simulator video did not start; inspect video.log.')
            time.sleep(0.1)
        report['recordingStartedObservedUnix'] = time.time()
        command(['xcodebuild', '-xctestrun', output/'recording.xctestrun', '-destination', f'platform=iOS Simulator,id={args.device}',
                 '-resultBundlePath', output/'journey.xcresult', '-only-testing:'+TEST,
                 'test-without-building', '-parallel-testing-enabled', 'NO', '-collect-test-diagnostics', 'never'],
                output/'journey-test.log', args.max_seconds)
        report['uiTestPassed'] = True
    finally:
        if recorder.poll() is None:
            recorder.send_signal(signal.SIGINT)
            try:
                recorder.wait(timeout=30)
            except subprocess.TimeoutExpired:
                recorder.terminate()
                recorder.wait(timeout=10)
        video_log.close()
        # XCTest can reinstall the app and migrate data to a new container UUID.
        # Resolve the current container instead of reading the initial host path.
        try:
            current = Path(command(['xcrun', 'simctl', 'get_app_container', args.device, bundle, 'data']))/relative
            report['appEvidenceDirectory'] = str(current)
            for name in ('input.wav', 'events.jsonl', 'readback.wav'):
                if (current/name).exists():
                    shutil.copyfile(current/name, output/name)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            report['evidenceCollectionError'] = str(error)
        if (output/'journey.xcresult').exists():
            try:
                command(['xcrun', 'xcresulttool', 'export', 'attachments', '--path', output/'journey.xcresult', '--output-path', output/'attachments'], output/'attachments-export.log', 120)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                report['attachmentExport'] = 'Incomplete; preserve journey.xcresult for inspection.'
        report['events'] = collect_events(output/'events.jsonl')
        report['readbackFile'] = str(output/'readback.wav') if (output/'readback.wav').exists() else None
    report['traceVerification'] = verify_events(report['events'], report['modelArtifacts'], args.expected_expression, output/'readback.wav')
    report['verification'] = 'pending: inspect native backend/model hash events, transcript, final math, readback audio, screenshots and video frames.'
    if not report['traceVerification']['pass']:
        raise RuntimeError('Native inference/readback evidence is incomplete; inspect report.json and events.jsonl.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True, help='Existing iPhone simulator UUID; no runtime is downloaded.')
    parser.add_argument('--output', required=True, help='New evidence directory; existing paths are never overwritten.')
    parser.add_argument('--fixture', default=str(DEFAULT_FIXTURE))
    parser.add_argument('--expected-expression', default=EXPECTED_EXPRESSION)
    parser.add_argument('--derived-data', default=str(ROOT/'Native/build/xcode'))
    parser.add_argument('--xctestrun', help='Reuse an existing build-for-testing plan, skipping compilation.')
    parser.add_argument('--app', help='Built Debug Mathwave.app; defaults to the selected derived-data products.')
    parser.add_argument('--max-seconds', type=int, default=360)
    args = parser.parse_args()
    args.fixture = Path(args.fixture).resolve()
    if args.max_seconds <= 0 or not args.fixture.is_file():
        parser.error('Use a positive duration and an existing recorded WAV.')
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(args.fixture, output/'source-input.wav')
    report = {'startedUTC':datetime.now(timezone.utc).isoformat(), 'lane':'Recorded audio fixture through actual custom native STT and LLM; not a physical microphone test.',
              'fixture':str(args.fixture), 'fixtureSha256':sha256(args.fixture), 'expectedExpression':args.expected_expression,
              'sourceHashes':{str(path.relative_to(ROOT)):sha256(path) for path in [Path(__file__), ROOT/'Native/Tests/MathwaveUITests/MathwaveUITests.swift', ROOT/'Native/Sources/MathAudioApp/CustomModelRuntime.swift', ROOT/'Native/Sources/MathAudioApp/MathAudioApp.swift', ROOT/'Native/Sources/MathAudioApp/AudioController.swift', ROOT/'Native/Sources/MathAudioApp/WorkbenchModel.swift', ROOT/'Native/Sources/MathAudioCore/Resources/workbench.js'] if path.exists()},
              'uiTestPassed':False, 'visualReview':'incomplete', 'videoReview':'incomplete', 'spokenReadbackReview':'incomplete',
              'limits':['No transcript/model output fixture injection.', 'A passing XCTest alone does not establish custom inference; actual app trace must confirm STT and LLM backends/model hashes.', 'Simulator video carries no audio. Separate source/readback WAVs are labeled, not dubbed into the video.']}
    try:
        simulator(args, output, report)
    except Exception as error:
        report['failure']={'type':type(error).__name__, 'message':str(error)}
        raise
    finally:
        report['finishedUTC']=datetime.now(timezone.utc).isoformat()
        (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')


if __name__ == '__main__':
    main()
