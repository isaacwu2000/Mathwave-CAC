'use client';
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useSyncExternalStore,
} from 'react';
import { recognizeGuidedLine } from '../runtime/guided-recording-input.ts';
import { RecordingReplies } from '../runtime/recording-replies.ts';
import { browserVoiceEnvironment } from '../runtime/browser-live.ts';
import { OpenAIVoiceSession } from '../runtime/openai-voice-session.ts';
import type { LiveContext } from '../types/index.ts';
import type { VoiceState } from '../types/index.ts';
const subscribeSupport = () => () => {};
const getSupport = () =>
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  !!window.AudioContext &&
  !!window.RTCPeerConnection;
export function useAudio(
  execute: (text: string, id: string, signal?: AbortSignal) => Promise<unknown>,
  getContext: () => LiveContext,
  onNotice: (text: string) => void,
  replies = true,
  complete?: (text: string) => boolean,
  recording = false,
) {
  const recordingCapture = useRef<RecordingReplies | null>(null);
  const [recordedReplies, setRecordedReplies] = useState<{
    url: string;
    startedAt: number;
  } | null>(null);
  const supported = useSyncExternalStore(
    subscribeSupport,
    getSupport,
    () => false,
  );
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [connectionState, setConnectionState] = useState('monitoring');
  const [speaking, setSpeaking] = useState(false);
  const [partial, setPartial] = useState('');
  const [reply, setReply] = useState('');
  const latestReply = useRef('');
  const [failure, setFailure] = useState('');
  const [waveform, setWaveform] = useState<number[]>(Array(48).fill(0));
  const waveformAt = useRef(0);
  const session = useRef<OpenAIVoiceSession | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const generation = useRef(0);
  const paused = useRef(false);
  const want = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ execute, getContext, onNotice, complete });
  useEffect(() => {
    callbacks.current = { execute, getContext, onNotice, complete };
  });
  const startRecognition = useCallback(() => session.current?.resume(), []);
  const stop = useCallback(() => {
    generation.current++;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    paused.current = false;
    setSpeaking(false);
    session.current?.resume();
  }, []);
  const stopListening = useCallback(() => {
    want.current = false;
    if (timer.current) clearTimeout(timer.current);
    session.current?.stopListening();
  }, []);
  useEffect(() => {
    session.current = new OpenAIVoiceSession(
      {
        state: (value) => {
          want.current = value !== 'idle';
          setVoiceState(value);
          if (value === 'idle') setWaveform(Array(48).fill(0));
        },
        partial: setPartial,
        reply: (text) => {
          recordingCapture.current?.transcript(text);
          latestReply.current = text;
          setReply(text);
        },
        level: (value) => {
          const now = performance.now();
          if (now - waveformAt.current < 80) return;
          waveformAt.current = now;
          setWaveform((previous) => [
            ...previous.slice(1),
            Math.min(1, value * 18),
          ]);
        },
        provider: setConnectionState,
        playback: (active) => {
          setSpeaking(active);
          recordingCapture.current?.playback(active);
        },
        context: () => callbacks.current.getContext(),
        complete: (text) => callbacks.current.complete?.(text) ?? false,
        execute: (text, id, signal) =>
          callbacks.current.execute(text, id, signal),
        notice: (text) => {
          recordingCapture.current?.fail(text);
          setFailure(text);
          callbacks.current.onNotice(text);
        },
        error: (text) => {
          want.current = false;
          recordingCapture.current?.fail(text);
          setFailure(text);
          callbacks.current.onNotice(text);
        },
      },
      recording
        ? {
            configured: () => browserVoiceEnvironment.configured(),
            monitor: (sample, signal) =>
              recordingCapture.current!.environment().monitor(sample, signal),
            connect: (capture, context, event, journeyId) =>
              recordingCapture
                .current!.environment()
                .connect(capture, context, event, journeyId),
          }
        : undefined,
    );
    return () => {
      if (recordingCapture.current)
        void recordingCapture.current.finish().catch(() => {});
      want.current = false;
      session.current?.stop();
      session.current = null;
      if (timer.current) clearTimeout(timer.current);
      void ctx.current?.close().catch(() => {});
    };
  }, [recording]);
  // A different problem must not inherit the prior conversation or delayed audio.
  const reset = useCallback(() => {
    want.current = false;
    if (timer.current) clearTimeout(timer.current);
    generation.current++;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    paused.current = false;
    session.current?.stop();
    setSpeaking(false);
    setPartial('');
    setReply('');
    setFailure('');
    setWaveform(Array(48).fill(0));
  }, []);
  useEffect(() => {
    session.current?.setReplies(replies);
  }, [replies]);
  const toggleListening = useCallback(() => {
    if (want.current) {
      stopListening();
      return;
    }
    if (!getSupport()) {
      callbacks.current.onNotice(
        'Live audio is unavailable in this browser. Your saved problems are available in Settings.',
      );
      return;
    }
    stop();
    setFailure('');
    want.current = true;
    session.current?.toggle();
  }, [stop, stopListening]);
  const sonify = useCallback(
    async (values: Array<number | null>) => {
      stop();
      const finite = values.filter(
        (v): v is number => v !== null && Number.isFinite(v),
      );
      if (!finite.length) {
        callbacks.current.onNotice('No finite values are available to play.');
        return;
      }
      if (!window.AudioContext) {
        callbacks.current.onNotice(
          'Tone playback is unavailable in this browser.',
        );
        return;
      }
      const audio = new AudioContext();
      ctx.current = audio;
      const token = ++generation.current;
      try {
        await audio.resume();
      } catch {
        void audio.close().catch(() => {});
        if (generation.current === token) {
          ctx.current = null;
          callbacks.current.onNotice(
            'Audio could not start. Try Play sound again.',
          );
        }
        return;
      }
      if (generation.current !== token || ctx.current !== audio) {
        void audio.close().catch(() => {});
        return;
      }
      paused.current = true;
      session.current?.pause();
      setSpeaking(true);
      const lo = Math.min(...finite),
        hi = Math.max(...finite);
      const step = Math.min(0.2, 4 / values.length);
      let last: OscillatorNode | null = null;
      values.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) return;
        const osc = audio.createOscillator(),
          gain = audio.createGain();
        const time = audio.currentTime + 0.08 + i * step;
        osc.type = 'sine';
        osc.frequency.value =
          220 + (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * 660;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.07, time + 0.012);
        gain.gain.linearRampToValueAtTime(0, time + step * 0.85);
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start(time);
        osc.stop(time + step);
        last = osc;
      });
      const end = () => {
        audio.close().catch(() => {});
        if (generation.current !== token) return;
        ctx.current = null;
        paused.current = false;
        setSpeaking(false);
        if (want.current) timer.current = setTimeout(startRecognition, 350);
      };
      if (last) (last as OscillatorNode).onended = end;
      else end();
    },
    [startRecognition, stop],
  );
  return {
    recordedReplies,
    beginRecordingReplies: () => {
      if (recordedReplies) URL.revokeObjectURL(recordedReplies.url);
      setRecordedReplies(null);
      recordingCapture.current = new RecordingReplies();
      session.current?.setReplies(true);
    },
    sayRecordingFacts: async (
      value: unknown,
      signal: AbortSignal,
      expected?: string,
    ) => {
      if (!recordingCapture.current)
        throw new Error('Reply recording is not started.');
      await recordingCapture.current.reply(
        () => session.current?.reportFacts(value, true),
        signal,
        expected,
      );
      return latestReply.current;
    },
    listenRecordingLine: (
      signal: AbortSignal,
      partial: (text: string) => void,
      status: (text: string) => void,
    ) =>
      recognizeGuidedLine(
        callbacks.current.getContext(),
        {
          partial,
          status,
          level: (value) => {
            const now = performance.now();
            if (now - waveformAt.current < 80) return;
            waveformAt.current = now;
            setWaveform((previous) => [
              ...previous.slice(1),
              Math.min(1, value * 18),
            ]);
          },
          capture: (stream) => recordingCapture.current!.captureInput(stream),
        },
        signal,
      ),
    playRecordingWin: () => recordingCapture.current?.celebrate(),
    clearRecordingReply: () => {
      setReply('');
    },
    finishRecordingReplies: async () => {
      const finalReply = latestReply.current;
      session.current?.stop();
      setReply(finalReply);
      const capture = recordingCapture.current;
      recordingCapture.current = null;
      if (!capture) return;
      const blob = await capture.finish();
      setRecordedReplies({
        url: URL.createObjectURL(blob),
        startedAt: capture.startedAt,
      });
    },
    supported,
    listening: voiceState === 'listening',
    starting: voiceState === 'starting',
    microphoneActive: voiceState !== 'idle',
    speaking,
    partial,
    reply,
    failure,
    connectionState,
    waveform,
    toggleListening,
    stopListening,
    reset,
    stop,
    sonify,
    reportFacts: (value: unknown) => session.current?.reportFacts(value),
    setReplies: (value: boolean) => session.current?.setReplies(value),
    setPace: (value: 'slower' | 'faster') => session.current?.setPace(value),
  };
}
