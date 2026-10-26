'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pico, type PicoAttention } from '../../../components/ui/pico';

export function PersonIcon() {
  return (
    <svg
      width="24"
      height="28"
      viewBox="0 0 24 28"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <circle cx="12" cy="7" r="4" />
      <path d="M3 25v-3a9 9 0 0 1 18 0v3" />
    </svg>
  );
}
export function MicrophoneIcon() {
  return (
    <svg
      width="26"
      height="36"
      viewBox="0 0 26 36"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
    >
      <rect x="8" y="2" width="10" height="20" rx="5" />
      <path d="M3 17v3a10 10 0 0 0 20 0v-3M13 30v4M7 34h12" />
    </svg>
  );
}
export function AudioPanel({
  active,
  starting,
  speaking,
  working = false,
  attention = 'neutral',
  celebrating = false,
  success,
  partial,
  reply,
  status,
  waveform,
  onToggle,
  progress,
  scripted = false,
}: {
  active: boolean;
  starting: boolean;
  speaking: boolean;
  working?: boolean;
  attention?: PicoAttention;
  celebrating?: boolean;
  success?: ReactNode;
  partial: string;
  reply: string;
  status: string;
  waveform: number[];
  onToggle: () => void;
  progress?: ReactNode;
  scripted?: boolean;
}) {
  const [noAudio, setNoAudio] = useState(false);
  const lastHeard = useRef(0);
  const previousPartial = useRef(partial);
  useEffect(() => {
    lastHeard.current = Date.now();
    const update = () =>
      setNoAudio(active && !starting && Date.now() - lastHeard.current >= 5000);
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 250);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [active, starting, partial]);
  useEffect(() => {
    // Use the newest microphone sample, not the fading waveform history.
    if (partial !== previousPartial.current || (waveform.at(-1) ?? 0) > 0.08) {
      lastHeard.current = Date.now();
    }
    previousPartial.current = partial;
  }, [partial, waveform]);
  const transcript = starting
    ? 'Starting microphone…'
    : active
      ? noAudio && !scripted
        ? '[No audio]'
        : partial || 'Listening…'
      : '';
  const transcriptWindow = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const window = transcriptWindow.current;
    if (window) window.scrollLeft = window.scrollWidth;
  }, [transcript]);
  return (
    <div
      className="audio-group"
      data-working={working}
      data-speaking={speaking}
    >
      <button
        className="audio-panel"
        aria-label={
          starting
            ? 'Cancel microphone startup'
            : active
              ? 'Stop listening'
              : 'Start listening'
        }
        aria-pressed={active}
        aria-describedby="voice-status"
        onClick={onToggle}
      >
        <MicrophoneIcon />
        <span className="audio-content">
          <span
            ref={transcriptWindow}
            className="audio-transcript"
            data-source={
              active && partial && (!noAudio || scripted) ? 'student' : 'status'
            }
            title={transcript || undefined}
          >
            {transcript}
          </span>
          <svg
            className="audio-wave"
            viewBox="0 0 360 18"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {waveform.map((level, index) => (
              <line
                key={index}
                x1={3 + index * 7.5}
                x2={3 + index * 7.5}
                y1={9 - level * 8}
                y2={9 + level * 8}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ))}
          </svg>
        </span>
      </button>
      <span className="audio-arrow" aria-hidden="true">
        <svg
          className="audio-arrow-shaft"
          preserveAspectRatio="none"
          viewBox="0 0 84 36"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
        >
          <path
            vectorEffect="non-scaling-stroke"
            className="moving-dashes"
            d="M3 18h78"
            strokeDasharray="10 8"
          />
        </svg>
        <svg
          className="audio-arrow-head"
          viewBox="0 0 16 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinejoin="round"
        >
          <path d="M2 3L14 10L2 17Z" />
        </svg>
      </span>
      <div className="pico-response">
        <Pico
          listening={active && !starting}
          working={working}
          speaking={speaking}
          attention={attention}
          celebrating={celebrating}
        />
        {reply && (
          <p className="pico-reply" data-source="pico">
            {reply}
          </p>
        )}
        {success && (
          <output
            className="pico-success"
            aria-live="polite"
            aria-atomic="true"
          >
            {success}
          </output>
        )}
        <output className="pico-progress" aria-live="polite" aria-atomic="true">
          {progress}
        </output>
      </div>
      <span id="voice-status" className="sr-only">
        {status}
      </span>
    </div>
  );
}
