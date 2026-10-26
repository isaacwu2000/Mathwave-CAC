import type { Recognition } from '../types/index.ts';
import {
  speechLanguage,
  type SpeechLanguage,
} from '../services/speech-language.ts';
export class NoRecordingTranscript extends Error {}

type TrackRecognition = Recognition & {
  start: (track?: MediaStreamTrack) => void;
  stop: () => void;
};

/** Sends only fixture audio to the real browser recognizer; never opens a mic. */
export async function recognizeRecording(
  url: string,
  signal: AbortSignal,
  status: (message: string) => void,
  language: SpeechLanguage = 'en-US',
): Promise<string> {
  const chrome = navigator.userAgent.match(/(?:Chrome|Edg)\/(\d+)/);
  const Constructor =
    (
      window as typeof window & {
        SpeechRecognition?: new () => TrackRecognition;
        webkitSpeechRecognition?: new () => TrackRecognition;
      }
    ).SpeechRecognition ||
    (
      window as typeof window & {
        webkitSpeechRecognition?: new () => TrackRecognition;
      }
    ).webkitSpeechRecognition;
  if (!Constructor || !chrome || Number(chrome[1]) < 135)
    throw new Error(
      'Direct recording tests need desktop Chrome 135 or newer. No microphone was opened.',
    );
  signal.throwIfAborted();
  const audio = new AudioContext();
  const resumed = audio.resume();
  let source: AudioBufferSourceNode | undefined;
  let stream: MediaStream | undefined;
  let recognition: TrackRecognition | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let finishAudio: ReturnType<typeof setTimeout> | undefined;
  try {
    status('Loading recording…');
    const [response] = await Promise.all([fetch(url, { signal }), resumed]);
    if (!response.ok) throw new Error('Recording could not load.');
    const buffer = await audio.decodeAudioData(await response.arrayBuffer());
    signal.throwIfAborted();
    const output = audio.createMediaStreamDestination();
    stream = output.stream;
    source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    // Deliberately do not connect to speakers: avoid echo and ambient speech.
    recognition = new Constructor();
    const r = recognition,
      player = source;
    r.lang = speechLanguage(language);
    r.continuous = true;
    r.interimResults = true;
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finals = new Map<number, string>();
      const complete = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        if (error) reject(error);
        else {
          const text = [...finals.values()].join(' ').trim();
          if (text) resolve(text);
          else
            reject(
              new NoRecordingTranscript(
                'The speech service returned no final transcript.',
              ),
            );
        }
      };
      const cancel = () =>
        complete(new DOMException('Recording test cancelled.', 'AbortError'));
      signal.addEventListener('abort', cancel, { once: true });
      r.onstart = () => {
        if (settled) return;
        status('Recognizing recording…');
        player.start(audio.currentTime + 0.3);
      };
      r.onresult = (event) => {
        if (settled) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) finals.set(i, result[0].transcript);
          else status(`Heard: ${result[0].transcript}`);
        }
      };
      r.onerror = (event) =>
        complete(
          new Error(
            `Browser speech failed (${event.error}). No problem work was changed.`,
          ),
        );
      r.onend = () => complete();
      player.onended = () => {
        finishAudio = setTimeout(() => {
          if (!settled) r.stop();
        }, 1200);
      };
      timeout = setTimeout(
        () =>
          complete(
            new Error(
              'The speech service timed out. No problem work was changed.',
            ),
          ),
        20000,
      );
      status('Starting speech service…');
      try {
        r.start(output.stream.getAudioTracks()[0]);
      } catch (error) {
        complete(
          error instanceof Error
            ? error
            : new Error('Audio-track recognition could not start.'),
        );
      }
    });
  } finally {
    clearTimeout(timeout);
    clearTimeout(finishAudio);
    if (recognition) {
      recognition.onstart =
        recognition.onend =
        recognition.onerror =
        recognition.onresult =
          null;
      try {
        recognition.abort();
      } catch {
        /* Already ended. */
      }
    }
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* Not started. */
      }
      source.disconnect();
    }
    stream?.getTracks().forEach((track) => track.stop());
    void audio.close().catch(() => {});
  }
}
