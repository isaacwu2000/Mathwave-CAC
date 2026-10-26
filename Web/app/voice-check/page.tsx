'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  recognizeRecording,
  NoRecordingTranscript,
} from '../../src/modules/voice/index.ts';
import {
  speechLanguage,
  speechLanguages,
  recordingLanguage,
  type SpeechLanguage,
} from '../../src/modules/voice/index.ts';
import {
  evaluateRecording,
  type Recording,
  type RecordingResult,
} from '../../../Evals/src/recorded-evaluation.ts';

export default function VoiceCheck() {
  const [clips, setClips] = useState<Recording[]>([]);
  const [voice, setVoice] = useState('Daniel');
  const [language, setLanguage] = useState<SpeechLanguage>('en-GB');
  const [sample, setSample] = useState('equation');
  const [status, setStatus] = useState('Ready');
  const [results, setResults] = useState<RecordingResult[]>([]);
  const appendResult = useCallback((result: RecordingResult) => {
    setResults((previous) => [...previous, result]);
  }, []);
  const [running, setRunning] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(
      [
        '/demo-voices/manifest.json',
        '/demo-voices/graph-geometry/manifest.json',
      ].map(async (path) => {
        const response = await fetch(path, { signal: controller.signal });
        if (!response.ok) throw new Error('Recordings could not load.');
        return (await response.json()) as Recording[];
      }),
    )
      .then((groups) => setClips(groups.flat()))
      .catch((error) => {
        if (!controller.signal.aborted)
          setStatus(
            error instanceof Error
              ? error.message
              : 'Recordings could not load.',
          );
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, []);
  async function run(batch: boolean) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    const selected = clips.filter(
      (c) => c.voice === voice && (batch || c.case === sample),
    );
    try {
      for (const clip of selected) {
        try {
          const transcript = await recognizeRecording(
            clip.audio,
            controller.signal,
            (message) => setStatus(`${clip.case}: ${message}`),
            language,
          );
          controller.signal.throwIfAborted();
          const result = { ...evaluateRecording(clip, transcript), language };
          appendResult(result);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          const message =
            error instanceof Error ? error.message : 'Recognition failed.';
          const failedResult: RecordingResult = {
            voice: clip.voice,
            case: clip.case,
            audio: clip.audio,
            sha256: clip.sha256,
            transcript: '',
            passed: false,
            status: 'recognition-error',
            message,
            language,
          };
          appendResult(failedResult);
          if (!(error instanceof NoRecordingTranscript)) throw error;
        }
      }
      setStatus('Finished. Results below use actual browser transcripts.');
    } catch (error) {
      setStatus(
        controller.signal.aborted
          ? 'Cancelled. Your homework is unchanged.'
          : error instanceof Error
            ? error.message
            : 'Voice test failed.',
      );
    } finally {
      active.current = null;
      setRunning(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              recognizer: 'Chrome Web Speech / explicit audio track',
              scope:
                'Synthetic recordings through the real speech service and local math engine; does not test microphone hardware.',
              results,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'math-audio-browser-voice-results.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="voice-check">
      <Link href="/">Back to problem</Link>
      <h1>Recorded voice check</h1>
      <p>
        This sends a synthetic recording to Chrome’s speech service, then checks
        the heard words with the math engine. It does not open your microphone
        or change saved homework.
      </p>
      <p>
        Use desktop Chrome 135 or newer. Microphone hardware needs a separate
        live check.
      </p>
      <label htmlFor="check-voice">Voice </label>
      <select
        id="check-voice"
        value={voice}
        disabled={running}
        onChange={(event) => {
          setVoice(event.target.value);
          setLanguage(recordingLanguage(event.target.value));
        }}
      >
        {['Daniel', 'Karen', 'Rishi'].map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>{' '}
      <label htmlFor="check-language">Speech language </label>
      <select
        id="check-language"
        value={language}
        disabled={running}
        onChange={(event) => setLanguage(speechLanguage(event.target.value))}
      >
        {speechLanguages.map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>{' '}
      <label htmlFor="check-sample">Recording </label>
      <select
        id="check-sample"
        value={sample}
        disabled={running}
        onChange={(event) => setSample(event.target.value)}
      >
        {clips
          .filter((c) => c.voice === voice)
          .map((c) => (
            <option key={c.case} value={c.case}>
              {c.case}
            </option>
          ))}
      </select>
      <p>
        <button
          className="soft-button"
          disabled={running || !clips.length}
          onClick={() => void run(false)}
        >
          Test recording
        </button>{' '}
        <button
          className="soft-button"
          disabled={running || !clips.length}
          onClick={() => void run(true)}
        >
          Test this voice
        </button>{' '}
        <button
          className="soft-button"
          disabled={!running}
          onClick={() => active.current?.abort()}
        >
          Cancel test
        </button>
      </p>
      <output aria-live="polite">{status}</output>
      <h2>
        Results · {results.filter((r) => r.passed).length}/{results.length}{' '}
        passed
      </h2>
      <button
        className="soft-button"
        disabled={!results.length || running}
        onClick={download}
      >
        Download results
      </button>{' '}
      <button
        className="soft-button"
        disabled={!results.length || running}
        onClick={() => setResults([])}
      >
        Clear results
      </button>
      <ol>
        {results.map((r, i) => (
          <li key={i}>
            <strong>
              {r.voice} · {r.case} · {r.passed ? 'Pass' : 'Needs work'}
            </strong>
            <p>Heard: {r.transcript}</p>
            <p>
              {r.status}: {r.message}
            </p>
          </li>
        ))}
      </ol>
    </main>
  );
}
