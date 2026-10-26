'use client';

import { useId, useSyncExternalStore } from 'react';
import './pico.css';

export type PicoAttention = 'neutral' | 'clarifying' | 'unavailable';

const subscribeVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
};
const pageHidden = () => document.hidden;
const serverHidden = () => false;

/**
 * Shows independent listening, request, and audible playback activity.
 * Pauses motion on hidden pages; existing audio controls own announcements.
 */
export function Pico({
  className = '',
  listening = false,
  working = false,
  speaking = false,
  attention = 'neutral',
  celebrating = false,
}: {
  className?: string;
  listening?: boolean;
  working?: boolean;
  speaking?: boolean;
  attention?: PicoAttention;
  celebrating?: boolean;
}) {
  const id = useId();
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    pageHidden,
    serverHidden,
  );
  const activity = [
    listening && 'listening',
    working && 'working',
    speaking && 'speaking',
    attention === 'clarifying' && 'waiting for clarification',
    attention === 'unavailable' && 'ready to retry',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <svg
      className={`pico ${className}`}
      viewBox="0 0 120 136"
      width="68"
      height="68"
      role="img"
      aria-label={`Pico: ${activity || 'ready'}`}
      data-listening={listening}
      data-working={working}
      data-speaking={speaking}
      data-attention={attention}
      data-hidden={hidden}
      data-celebrating={celebrating}
    >
      <defs>
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2=".75" y2="1">
          <stop stopColor="#f9c9a8" />
          <stop offset="1" stopColor="#eaa980" />
        </linearGradient>
        <radialGradient id={`${id}-light`} cx=".42" cy=".24" r=".8">
          <stop stopColor="#fff0d7" stopOpacity=".62" />
          <stop offset=".6" stopColor="#ffdfc2" stopOpacity=".18" />
          <stop offset="1" stopColor="#ffdfc2" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="126" rx="37" ry="4" fill="#c5a68f" opacity=".055" />
      <ellipse cx="60" cy="126" rx="27" ry="2.5" fill="#c5a68f" opacity=".07" />
      <g className="pico-pose">
        <g className="pico-body">
          <path
            d="M48 17C54 5 65 5 72 17L110 92C119 110 111 119 94 119H26C8 119 1 110 10 92Z"
            fill={`url(#${id}-base)`}
          />
          <path
            d="M48 17C54 5 65 5 72 17L110 92C119 110 111 119 94 119H26C8 119 1 110 10 92Z"
            fill={`url(#${id}-light)`}
          />
          <g className="pico-eyes" fill="#292725">
            <circle className="pico-eye-left" cx="43" cy="70" r="8" />
            <circle className="pico-eye-right" cx="77" cy="70" r="8" />
          </g>
        </g>
      </g>
      <g
        className="pico-waves"
        fill="none"
        stroke="#9b5934"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M121 53Q132 67 121 81" />
        <path d="M130 46Q145 67 130 88" />
        <path d="M139 39Q157 67 139 95" />
      </g>
    </svg>
  );
}
