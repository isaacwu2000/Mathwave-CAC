import {
  browserVoiceEnvironment,
  type VoiceEnvironment,
} from './browser-live.ts';

/** Captures real Live playback with silent input; never opens a physical microphone. */
export class RecordingReplies {
  readonly startedAt = Date.now();
  private context = new AudioContext();
  private output = this.context.createMediaStreamDestination();
  private recorder = new MediaRecorder(this.output.stream);
  private chunks: Blob[] = [];
  private pending: {
    resolve: () => void;
    reject: (error: Error) => void;
    started: boolean;
    active: boolean;
    expected?: string;
    complete: boolean;
    finish?: ReturnType<typeof setTimeout>;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  constructor() {
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.recorder.start();
    void this.context.resume();
  }
  environment(): VoiceEnvironment {
    return {
      configured: () => browserVoiceEnvironment.configured(),
      monitor: async (_sample, signal) => {
        signal?.throwIfAborted();
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const silence = context.createConstantSource();
        silence.offset.value = 0;
        silence.connect(destination);
        silence.start();
        await context.resume();
        return {
          stream: destination.stream,
          play() {},
          draining: () => false,
          close() {
            silence.stop();
            destination.stream.getTracks().forEach((track) => track.stop());
            void context.close();
          },
        };
      },
      connect: (capture, context, receive, journeyId) =>
        browserVoiceEnvironment.connect(
          capture,
          context,
          receive,
          journeyId,
          (stream) => {
            this.context.createMediaStreamSource(stream).connect(this.output);
          },
          200,
        ),
    };
  }
  /** Adds student input to the take audio without playing it through the speakers. */
  captureInput(stream: MediaStream): () => void {
    const source = this.context.createMediaStreamSource(stream);
    source.connect(this.output);
    return () => source.disconnect();
  }
  /** Waits for actual playback; the final confirmation must finish in both transcript and audio. */
  reply(
    send: () => void,
    signal: AbortSignal,
    expected?: string,
  ): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener('abort', abort);
        if (this.pending) {
          clearTimeout(this.pending.timeout);
          clearTimeout(this.pending.finish);
          this.pending = null;
        }
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Recording stopped.', 'AbortError'));
      };
      this.pending = {
        started: false,
        active: false,
        expected,
        complete: !expected,
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        timeout: setTimeout(
          () =>
            this.pending?.reject(
              new Error('No spoken app reply arrived. The take was stopped.'),
            ),
          30000,
        ),
      };
      signal.addEventListener('abort', abort, { once: true });
      send();
    });
  }
  transcript(text: string) {
    const pending = this.pending;
    if (!pending?.expected) return;
    const words = (value: string) =>
      value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    pending.complete = words(text).includes(words(pending.expected));
    if (pending.complete && pending.started && !pending.active)
      this.playback(false);
  }
  playback(active: boolean) {
    const pending = this.pending;
    if (!pending) return;
    pending.active = active;
    clearTimeout(pending.finish);
    if (active) pending.started = true;
    else if (pending.started && pending.complete)
      pending.finish = setTimeout(
        () => pending.resolve(),
        pending.expected ? 0 : 250,
      );
  }
  /** Plays a quiet rising chime through the speakers and the recorded app mix. */
  celebrate() {
    [1046.5, 1318.5, 1568].forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = this.context.currentTime + 0.015 + index * 0.085;
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.045, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      gain.connect(this.output);
      oscillator.start(start);
      oscillator.stop(start + 0.23);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  }
  fail(message: string) {
    this.pending?.reject(new Error(message));
  }
  async finish(): Promise<Blob> {
    this.pending?.reject(new Error('Recording finished.'));
    const blob = await new Promise<Blob>((resolve) => {
      this.recorder.onstop = () =>
        resolve(new Blob(this.chunks, { type: this.recorder.mimeType }));
      this.recorder.stop();
    });
    this.output.stream.getTracks().forEach((track) => track.stop());
    await this.context.close();
    return blob;
  }
}
