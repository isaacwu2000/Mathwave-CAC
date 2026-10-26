import { SILENCE_MS, PRE_ROLL_MS } from '../config/silence.ts';
import type { AudioFrame } from '../types/index.ts';
export { SILENCE_MS, PRE_ROLL_MS } from '../config/silence.ts';
export type { AudioFrame } from '../types/index.ts';
export const frameDuration = (frame: AudioFrame) =>
  (frame.samples.length / frame.sampleRate) * 1000;
export function rms(samples: Float32Array) {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** LearnUnlock-style volume monitoring, with hysteresis. RMS is not a semantic speech detector. */
export class SilenceMonitor {
  active = false;
  private ring: AudioFrame[] = [];
  private noise = 0.0005;
  private activationMs = 0;
  private lastSignal = 0;
  private lastInputSignal: number | null = null;
  private inputTailMS = SILENCE_MS;
  constructor(
    private events: {
      wake(frames: AudioFrame[]): void;
      frame(frame: AudioFrame): void;
      idle(): void;
      signal?(at: number): void;
    },
  ) {}
  sample(frame: AudioFrame) {
    const level = rms(frame.samples);
    const activate = Math.max(0.003, this.noise * 3);
    const deactivate = Math.max(0.0015, this.noise * 1.6);
    if (!this.active) {
      this.ring.push(frame);
      while (this.ring.length > 1 && frame.at - this.ring[0].at > PRE_ROLL_MS)
        this.ring.shift();
      if (level < activate)
        this.noise = Math.min(0.004, 0.98 * this.noise + 0.02 * level);
      this.activationMs =
        level >= activate
          ? this.activationMs + Math.min(25, frameDuration(frame))
          : 0;
      if (this.activationMs >= 60) {
        this.active = true;
        this.lastSignal = frame.at;
        this.lastInputSignal = frame.at;
        this.events.signal?.(frame.at);
        const frames = this.ring;
        this.ring = [];
        this.events.wake(frames);
      }
      return;
    }
    if (level >= deactivate) {
      this.lastSignal = frame.at;
      this.lastInputSignal = frame.at;
      this.events.signal?.(frame.at);
    }
    // Stop adding silence once the deadline passes so queued setup audio can drain.
    // Reply keep-alive extends the connection, not the microphone's silence tail.
    if (
      this.lastInputSignal !== null &&
      frame.at - this.lastInputSignal < this.inputTailMS
    )
      this.events.frame(frame);
  }
  tick(now: number, pending = false) {
    if (this.due(now) && !pending) {
      this.active = false;
      this.activationMs = 0;
      this.ring = [];
      this.events.idle();
    }
  }
  due(now: number) {
    return this.active && now - this.lastSignal >= SILENCE_MS;
  }
  keepAlive(now: number) {
    this.active = true;
    this.lastSignal = now;
  }
  /** Changes only forwarded input silence; listening and the connection idle deadline are preserved. */
  setInputTail(milliseconds: number) {
    this.inputTailMS = milliseconds;
  }
  clear() {
    this.active = false;
    this.activationMs = 0;
    this.ring = [];
    this.lastInputSignal = null;
    this.inputTailMS = SILENCE_MS;
  }
}
