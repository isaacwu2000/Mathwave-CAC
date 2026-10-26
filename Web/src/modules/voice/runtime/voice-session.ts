import type { Recognition, VoiceState } from '../types/index.ts';
export type { Recognition, VoiceState } from '../types/index.ts';
export class VoiceSession {
  private current: Recognition | null = null;
  private wanted = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private restarts = 0;
  private startedAt = 0;
  private epoch = 0;
  private preparing = false;
  private prepare?: () => Promise<() => void>;
  private language: string;
  private create: () => Recognition;
  private events: {
    state: (s: VoiceState) => void;
    partial: (s: string) => void;
    command: (s: string) => void;
    error: (s: string) => void;
  };
  constructor(
    create: () => Recognition,
    events: VoiceSession['events'],
    prepare?: () => Promise<() => void>,
    language = 'en-US',
  ) {
    this.create = create;
    this.events = events;
    this.prepare = prepare;
    this.language = language;
  }
  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private detach() {
    this.epoch++;
    this.preparing = false;
    this.clearTimer();
    const r = this.current;
    this.current = null;
    if (r) {
      r.onstart = null;
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      try {
        r.abort();
      } catch {
        /* Already ended. */
      }
    }
  }
  stop() {
    this.wanted = false;
    this.paused = false;
    this.detach();
    this.events.state('idle');
    this.events.partial('');
  }
  pause() {
    if (!this.wanted) return;
    this.paused = true;
    this.detach();
    this.events.state('paused');
  }
  resume() {
    if (!this.wanted) return;
    this.paused = false;
    if (!this.current) this.begin();
  }
  toggle() {
    if (this.wanted) {
      this.stop();
      return;
    }
    this.wanted = true;
    this.restarts = 0;
    this.begin();
  }
  private fail(message: string) {
    this.stop();
    this.events.error(message);
  }
  private begin() {
    if (!this.wanted || this.paused || this.current || this.preparing) return;
    this.clearTimer();
    this.events.state('starting');
    if (this.prepare) {
      const epoch = ++this.epoch;
      this.preparing = true;
      this.timer = setTimeout(() => {
        if (epoch === this.epoch)
          this.fail(
            'Microphone permission is still pending. Allow it in the browser prompt, then try again.',
          );
      }, 60000);
      void this.prepare()
        .then((release) => {
          release();
          if (epoch !== this.epoch || !this.wanted || this.paused) return;
          this.preparing = false;
          this.clearTimer();
          this.startRecognition();
        })
        .catch((error: unknown) => {
          if (epoch === this.epoch)
            this.fail(
              `${error instanceof Error ? error.message : 'Microphone access failed.'} Your work is kept.`,
            );
        });
      return;
    }
    this.startRecognition();
  }
  private startRecognition() {
    let r: Recognition;
    try {
      r = this.create();
    } catch {
      this.fail(
        'Speech recognition could not start. Try again or type your command.',
      );
      return;
    }
    this.current = r;
    const active = () => this.current === r && this.wanted && !this.paused;
    const completed = new Set<number>();
    r.lang = this.language;
    r.continuous = true;
    r.interimResults = true;
    r.onstart = () => {
      if (!active()) return;
      this.clearTimer();
      this.startedAt = Date.now();
      this.events.state('listening');
    };
    r.onresult = (e) => {
      if (!active()) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!active()) break;
        const result = e.results[i];
        if (result.isFinal) {
          if (completed.has(i)) continue;
          completed.add(i);
          this.events.partial('');
          this.events.command(result[0].transcript);
        } else this.events.partial(result[0].transcript);
      }
    };
    r.onerror = (e) => {
      if (!active()) return;
      if (e.error === 'no-speech') {
        this.events.partial('');
        return;
      }
      this.fail(
        e.error === 'not-allowed'
          ? 'Microphone access was denied. Allow it in your browser’s site settings, then try again. Your work is kept.'
          : e.error === 'service-not-allowed'
            ? 'This browser does not allow its speech service. Open Math Audio in Google Chrome or choose GPT Live in Voice settings. Your work is kept.'
            : e.error === 'audio-capture'
              ? 'Speech recognition could not capture your microphone. Check the input device and close other recording apps, then retry. Your work is kept.'
              : e.error === 'network'
                ? 'Speech recognition could not connect. Your work is kept; you can type or retry the microphone.'
                : `Speech recognition stopped (${e.error}). Your work is kept. Try the microphone again or type your command.`,
      );
    };
    r.onend = () => {
      if (!active()) return;
      this.detach();
      if (Date.now() - this.startedAt > 10000) this.restarts = 0;
      if (++this.restarts > 3) {
        this.fail(
          'The microphone could not stay connected. Your work is kept. Try again when you are ready.',
        );
        return;
      }
      this.events.state('starting');
      this.timer = setTimeout(() => this.begin(), 500);
    };
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      if (active())
        this.fail(
          this.prepare
            ? 'Your microphone is available, but this browser’s speech service did not start. Open Math Audio in Google Chrome or choose GPT Live in Voice settings. Your work is kept.'
            : 'The microphone did not start. Check microphone permission, then try again.',
        );
    }, 15000);
    try {
      r.start();
    } catch (e) {
      if (active())
        this.fail(
          `The microphone could not start${e instanceof Error ? `: ${e.message}` : '.'} Your work is kept.`,
        );
    }
  }
}
