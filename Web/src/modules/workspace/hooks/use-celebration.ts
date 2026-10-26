'use client';
import { useEffect, useRef, useState } from 'react';
import type { VerifiedCompletion } from '../../problems/index.ts';
import {
  claimCelebration,
  celebrationsPreference,
} from '../runtime/celebrations.ts';

export type Celebration = VerifiedCompletion & {
  revision: number;
  active: boolean;
};

/** Retains the accessible result, bounds the burst, and consumes receipts even when animations are disabled. */
export function useCelebration() {
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [enabled, setEnabled] = useState(true);
  const enabledRef = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    try {
      enabledRef.current =
        localStorage.getItem(celebrationsPreference) !== 'false';
      setEnabled(enabledRef.current);
    } catch {
      /* Preferences are optional. */
    }
  }, []);
  useEffect(() => {
    if (!celebration?.active) return;
    const timer = setTimeout(
      () =>
        setCelebration((current) =>
          current ? { ...current, active: false } : null,
        ),
      2200,
    );
    const hide = () => {
      if (document.hidden)
        setCelebration((current) =>
          current ? { ...current, active: false } : null,
        );
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [celebration]);
  return {
    celebration,
    enabled,
    setEnabled: (value: boolean) => {
      enabledRef.current = value;
      setEnabled(value);
      if (!value)
        setCelebration((current) =>
          current ? { ...current, active: false } : null,
        );
      try {
        localStorage.setItem(celebrationsPreference, String(value));
      } catch {
        /* Optional preference. */
      }
    },
    cancel: () => {
      setCelebration(null);
      return ++generation.current;
    },
    showVerified: (
      completion: VerifiedCompletion,
      revision: number,
      token: number,
    ) => {
      if (token !== generation.current) return;
      try {
        if (!claimCelebration(localStorage, completion.problemId, revision))
          return;
        setCelebration({
          ...completion,
          revision,
          active: enabledRef.current && !document.hidden,
        });
      } catch {
        /* A blocked browser store must not affect saved mathematics. */
      }
    },
  };
}
