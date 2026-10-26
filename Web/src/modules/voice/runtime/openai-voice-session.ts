import {
  SILENCE_MS,
  TRANSCRIPT_SETTLE_MS,
  REQUEST_SILENCE_MS,
} from '../config/silence.ts';
import { journeyPoint, journeySpan } from '../../diagnostics/index.ts';
import type { LiveContext } from '../types/index.ts';
import type { VoiceState } from '../types/index.ts';
import {
  browserVoiceEnvironment,
  type VoiceEnvironment,
  type LocalCapture,
  type LiveTransport,
} from './browser-live.ts';
import {
  SilenceMonitor,
  rms,
  frameDuration,
  type AudioFrame,
} from '../services/silence-monitor.ts';
type Events = {
  state(value: VoiceState): void;
  partial(value: string): void;
  level?(value: number): void;
  error(value: string): void;
  notice(value: string): void;
  context(): LiveContext;
  execute?(text: string, id: string, signal?: AbortSignal): Promise<unknown>;
  complete?(text: string): boolean;
  interpret?(value: unknown): string;
  provider?(
    value: 'monitoring' | 'connecting' | 'connected' | 'closing' | 'error',
  ): void;
  closed?(event: Record<string, unknown>): void;
  playback?(active: boolean): void;
  reply?(text: string): void;
};

/** Listening owns local capture; provider generations only exist while speech/work needs them. */
export class OpenAIVoiceSession {
  private wanted = false;
  private inputStopped = false;
  private paused = false;
  private epoch = 0;
  private capture: LocalCapture | null = null;
  private transport: LiveTransport | null = null;
  private connecting = false;
  private ready = false;
  private closing = false;
  private failed = false;
  private buffer: AudioFrame[] = [];
  private transcript = '';
  private untranscribed: AudioFrame[] = [];
  private untranscribedMS = 0;
  private untranscribedOverflow = false;
  private transcriptionRetries = 0;
  private transcriptionReceived = false;
  private transcriptionDeadline = 0;
  private transcriptionNotice = false;
  private waitingDelegation: { id: string; at: number } | null = null;
  private reply = '';
  private replyEndMS: number | null = null;
  private replyAfterResult = false;
  private utterance = '';
  private lastInputSignal: number | null = null;
  private lastTranscriptAt: number | null = null;
  private connectionStarted: number | null = null;
  private connectionJourney = '';
  private awaitingAudio: string | null = null;
  private delegations = new Set<string>();
  private pending = 0;
  private operations = new Set<AbortController>();
  private acknowledgements = new Set<string>();
  private acknowledgementTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private monitor: SilenceMonitor;
  private tickTimer?: ReturnType<typeof setInterval>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private startTimer?: ReturnType<typeof setTimeout>;
  private captureStartTimer?: ReturnType<typeof setTimeout>;
  private captureStart?: AbortController;
  private replies = true;
  private connectionGeneration = 0;
  private cancelledConnections = new Map<
    number,
    { transport: LiveTransport; timeout: ReturnType<typeof setTimeout> }
  >();
  private finalizedConnections = new Set<number>();
  private deferredFacts: unknown[] = [];
  constructor(
    private events: Events,
    private environment: VoiceEnvironment = browserVoiceEnvironment,
  ) {
    this.monitor = new SilenceMonitor({
      signal: (at) => {
        if (!this.utterance) {
          this.clearUntranscribed();
          this.utterance = crypto.randomUUID();
          journeyPoint(this.utterance, 'input-detected', at);
          this.awaitingAudio = null;
        }
        this.lastInputSignal = at;
      },
      wake: (frames) => {
        for (const frame of frames) this.retainUntranscribed(frame);
        this.buffer.push(...frames);
        void this.connect();
      },
      frame: (frame) => this.forward(frame),
      idle: () => this.closeProvider(),
    });
  }
  toggle() {
    if (this.wanted && !this.inputStopped) this.stopListening();
    else if (this.wanted) void this.restartInput();
    else void this.start();
  }
  /** Releases the microphone while preserving delegated actions and AI playback. */
  stopListening() {
    if (!this.capture) {
      if (this.captureStart && this.inputStopped) {
        this.captureStart.abort();
        this.events.state('idle');
      } else if (!this.pending && !this.transport) this.stop();
      return;
    }
    this.inputStopped = true;
    this.captureStart?.abort();
    this.capture.close();
    this.capture = null;
    this.buffer = [];
    this.clearUntranscribed();
    this.events.state('idle');
    this.events.partial('');
    this.events.level?.(0);
    this.monitor.keepAlive(performance.now());
    if (this.transcript.trim()) void this.finishTranscript(this.epoch, true);
  }
  /** Reattaches fresh microphone input without invalidating in-flight work. */
  private async restartInput() {
    if (this.captureStart) return;
    const epoch = this.epoch;
    const starting = new AbortController();
    this.captureStart = starting;
    this.failed = false;
    this.events.state('starting');
    const timeout = setTimeout(
      () => starting.abort(new Error('Microphone restart timed out.')),
      15000,
    );
    let owner: LocalCapture | undefined;
    try {
      const capture = await this.environment.monitor((frame) => {
        if (
          epoch === this.epoch &&
          this.capture === owner &&
          !this.inputStopped &&
          !this.paused &&
          !this.failed
        ) {
          this.events.level?.(rms(frame.samples));
          this.monitor.sample(frame);
        }
      }, starting.signal);
      if (epoch !== this.epoch || starting.signal.aborted) {
        capture.close();
        return;
      }
      this.capture = capture;
      owner = capture;
      try {
        await this.transport?.replaceCapture?.(capture);
      } catch (error) {
        capture.close();
        if (this.capture === capture) this.capture = null;
        throw error;
      }
      if (epoch !== this.epoch || starting.signal.aborted) {
        capture.close();
        if (this.capture === capture) this.capture = null;
        return;
      }
      this.inputStopped = false;
      this.events.state('listening');
    } catch (error) {
      if (epoch === this.epoch) {
        this.events.state('idle');
        this.events.notice(
          error instanceof Error
            ? error.message
            : 'The microphone could not restart.',
        );
      }
    } finally {
      clearTimeout(timeout);
      if (this.captureStart === starting) this.captureStart = undefined;
    }
  }
  pause() {
    this.paused = true;
    this.clearUntranscribed();
    this.monitor.clear();
    this.buffer = [];
    if (!this.pending) this.closeProvider();
    if (this.wanted && !this.inputStopped) this.events.state('paused');
  }
  resume() {
    this.paused = false;
    if (this.wanted && !this.inputStopped) this.events.state('listening');
  }
  setReplies(value: boolean) {
    this.replies = value;
    this.transport?.mute(!value);
    this.events.playback?.(
      value && !this.failed && !this.closing && !!this.transport?.speaking(),
    );
  }
  setPace(value: 'slower' | 'faster') {
    this.transport?.send({
      type: 'session.instructions.append',
      delegation_id: null,
      content:
        value === 'slower'
          ? 'Use a slower speaking pace.'
          : 'Use a faster speaking pace.',
    });
  }
  reportFacts(value: unknown, newTurn = false) {
    if (newTurn) {
      this.reply = '';
      this.replyEndMS = null;
      this.replyAfterResult = false;
      this.events.reply?.('');
    }
    this.deferredFacts.push(value);
    this.monitor.keepAlive(performance.now());
    if (!this.wanted) void this.start(true);
    else void this.connect();
    this.flushFacts();
  }
  stop() {
    this.captureStart?.abort();
    this.captureStart = undefined;
    for (const operation of this.operations) operation.abort();
    this.operations.clear();
    this.wanted = false;
    this.transcriptionNotice = false;
    this.inputStopped = false;
    this.paused = false;
    this.epoch++;
    this.connecting = false;
    this.buffer = [];
    this.clearUntranscribed();
    this.deferredFacts = [];
    this.monitor.clear();
    this.transcript = '';
    this.waitingDelegation = null;
    this.utterance = '';
    this.lastInputSignal = null;
    this.lastTranscriptAt = null;
    this.awaitingAudio = null;
    this.capture?.close();
    this.capture = null;
    clearInterval(this.tickTimer);
    clearTimeout(this.startTimer);
    clearTimeout(this.captureStartTimer);
    this.events.playback?.(false);
    this.reply = '';
    this.replyEndMS = null;
    this.replyAfterResult = false;
    this.events.reply?.('');
    this.events.state('idle');
    this.events.partial('');
    this.events.level?.(0);
    this.closeProvider();
  }
  private async start(force = false) {
    if (this.wanted) return;
    const epoch = ++this.epoch;
    this.wanted = true;
    this.inputStopped = false;
    this.failed = false;
    this.events.state('starting');
    const captureStart = new AbortController();
    this.captureStart = captureStart;
    // Permission prompts and audio initialization may never settle. A retry must own a new capture.
    this.captureStartTimer = setTimeout(() => {
      if (epoch !== this.epoch) return;
      this.stop();
      this.events.error(
        'Voice startup timed out. Check microphone permission and try Record again. In a school browser, ask IT to allow microphone and audio access for this site.',
      );
    }, 15000);
    let pendingCapture: LocalCapture | undefined;
    let pendingCaptureOwner: LocalCapture | undefined;
    const releasePending = () => {
      pendingCapture?.close();
      pendingCapture = undefined;
    };
    captureStart.signal.addEventListener('abort', releasePending, {
      once: true,
    });
    try {
      // Local audio must start inside the student's click, before any server wait.
      const monitoring = this.environment
        .monitor((frame) => {
          if (
            epoch === this.epoch &&
            !this.inputStopped &&
            (this.capture === pendingCaptureOwner ||
              (this.capture === null && pendingCapture !== undefined)) &&
            this.wanted &&
            !this.paused &&
            !this.failed
          ) {
            this.events.level?.(rms(frame.samples));
            this.monitor.sample(frame);
          }
        }, captureStart.signal)
        .then((capture) => {
          if (captureStart.signal.aborted) {
            capture.close();
            captureStart.signal.throwIfAborted();
          }
          pendingCapture = capture;
          pendingCaptureOwner = capture;
          return capture;
        });
      const [, capture] = await Promise.all([
        this.environment.configured().then((configured) => {
          if (!configured)
            throw new Error(
              'Voice is not set up yet. Your saved problems are available in Settings.',
            );
        }),
        monitoring,
      ]);
      if (epoch !== this.epoch) return;
      clearTimeout(this.captureStartTimer);
      this.captureStart = undefined;
      this.capture = capture;
      pendingCapture = undefined;
      this.events.state('listening');
      this.events.provider?.('monitoring');
      this.tickTimer = setInterval(() => {
        const now = performance.now();
        // Delegation and transcript events can arrive in either order. Wait briefly for text.
        if (
          this.waitingDelegation &&
          !this.transcript.trim() &&
          now -
            Math.max(this.waitingDelegation.at, this.lastInputSignal ?? 0) >=
            SILENCE_MS
        ) {
          this.transport?.send({
            type: 'session.thinking.append',
            delegation_id: this.waitingDelegation.id,
            content:
              'No transcript arrived. No operation was performed. Do not claim a saved result.',
          });
          this.waitingDelegation = null;
          this.events.notice('I did not catch the request. Please repeat it.');
        }
        // Only a complete request transcribed after the latest student sound can use the shorter tail.
        const complete =
          this.lastInputSignal !== null &&
          this.lastTranscriptAt !== null &&
          this.lastTranscriptAt >= this.lastInputSignal &&
          (!!this.waitingDelegation ||
            !!this.events.complete?.(this.transcript));
        const requestSilence = complete ? REQUEST_SILENCE_MS : SILENCE_MS;
        this.monitor.setInputTail(requestSilence);
        const speaking = !!this.transport?.speaking();
        // A brief playback pause must not expose an expired student-silence deadline.
        if (speaking && !this.paused && !this.failed)
          this.monitor.keepAlive(now);
        const blocked =
          this.pending > 0 ||
          !!this.waitingDelegation ||
          this.acknowledgements.size > 0 ||
          !!this.capture?.draining() ||
          speaking ||
          this.connecting ||
          (!this.transcript.trim() && now < this.transcriptionDeadline);
        // Reply playback may keep the connection alive, but must not postpone a student request.
        // Wait for quiet student input, settled transcript text and drained input audio.
        const requestDue =
          this.ready &&
          !this.connecting &&
          !this.closing &&
          !this.paused &&
          !this.failed &&
          this.transcript.trim() &&
          this.lastInputSignal !== null &&
          this.lastTranscriptAt !== null &&
          now - this.lastInputSignal >= requestSilence &&
          now - this.lastTranscriptAt >= TRANSCRIPT_SETTLE_MS &&
          !this.capture?.draining();
        if (requestDue) void this.finishTranscript(epoch, complete);
        else if (this.paused && !blocked) this.closeProvider();
        else if (
          !blocked &&
          this.ready &&
          !this.closing &&
          !this.paused &&
          !this.inputStopped &&
          this.lastInputSignal !== null &&
          !this.transcriptionReceived &&
          !this.transcript.trim() &&
          this.monitor.due(now)
        )
          this.recoverUntranscribed(now);
        else this.monitor.tick(now, blocked || Boolean(this.transcript.trim()));
      }, 25);
      if (force || this.deferredFacts.length || this.monitor.active) {
        this.monitor.keepAlive(performance.now());
        void this.connect();
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.stop();
      this.events.error(
        error instanceof Error
          ? error.message
          : 'The microphone could not start.',
      );
    } finally {
      captureStart.signal.removeEventListener('abort', releasePending);
    }
  }
  private forward(frame: AudioFrame) {
    this.retainUntranscribed(frame);
    if (this.ready && !this.closing) this.capture?.play(frame);
    else {
      this.buffer.push(frame);
      if (
        this.buffer.reduce((total, item) => total + frameDuration(item), 0) >
        12000
      )
        this.fail(
          'Speech buffering exceeded 12 seconds. Please restart listening and repeat the request.',
        );
    }
  }
  /** Retains at most twelve seconds in memory until the request is transcribed or input stops. */
  private retainUntranscribed(frame: AudioFrame) {
    if (
      !this.utterance ||
      this.transcriptionReceived ||
      this.transcript.trim() ||
      this.untranscribedOverflow ||
      (this.lastInputSignal !== null && frame.at - this.lastInputSignal > 1000)
    )
      return;
    this.untranscribedMS += frameDuration(frame);
    if (this.untranscribedMS > 12000) {
      this.untranscribed = [];
      this.untranscribedOverflow = true;
    } else this.untranscribed.push(frame);
  }
  private clearUntranscribed() {
    this.untranscribed = [];
    this.untranscribedMS = 0;
    this.untranscribedOverflow = false;
    this.transcriptionRetries = 0;
    this.transcriptionReceived = false;
    this.transcriptionDeadline = 0;
  }
  /** Replays unheard audio once, after closing the old session. Never retries transcribed work. */
  private recoverUntranscribed(now: number) {
    if (
      !this.untranscribedOverflow &&
      this.untranscribed.length &&
      this.transcriptionRetries === 0
    ) {
      this.transcriptionRetries++;
      // Keep the spoken request and a short silence tail, without replaying five seconds of idle audio.
      this.buffer = this.untranscribed.filter(
        (frame) => frame.at <= this.lastInputSignal! + 1000,
      );
      this.monitor.keepAlive(now);
      journeyPoint(this.utterance, 'transcription-retry');
      this.closeProvider();
    } else {
      journeyPoint(this.utterance, 'transcription-missing');
      this.clearUntranscribed();
      this.utterance = '';
      this.lastInputSignal = null;
      this.monitor.clear();
      this.transcriptionNotice = true;
      this.events.notice(
        'I could not transcribe that audio. Please repeat your request. No action was taken.',
      );
      this.closeProvider();
    }
  }
  private async connect() {
    if (
      !this.wanted ||
      this.paused ||
      this.failed ||
      this.connecting ||
      this.transport ||
      !this.capture
    )
      return;
    this.connecting = true;
    this.connectionStarted = performance.now();
    this.connectionJourney = this.utterance || crypto.randomUUID();
    journeyPoint(this.connectionJourney, 'connection-start');
    this.events.provider?.('connecting');
    const epoch = this.epoch;
    const generation = ++this.connectionGeneration;
    this.startTimer = setTimeout(() => {
      if (epoch === this.epoch && generation === this.connectionGeneration)
        this.fail(
          'GPT Live did not start. Restart listening; your draft is preserved.',
        );
    }, 20000);
    const connectingCapture = this.capture;
    try {
      const transport = await this.environment.connect(
        connectingCapture,
        this.events.context(),
        (event) => this.receive(event, epoch, generation),
        this.connectionJourney,
      );
      if (
        epoch === this.epoch &&
        this.wanted &&
        this.capture &&
        this.capture !== connectingCapture
      ) {
        try {
          await transport.replaceCapture?.(this.capture);
        } catch (error) {
          transport.dispose();
          throw error;
        }
      }
      if (epoch !== this.epoch || !this.wanted || this.failed) {
        if (this.finalizedConnections.has(generation)) {
          transport.dispose();
          return;
        }
        const timeout = setTimeout(() => {
          transport.dispose();
          this.cancelledConnections.delete(generation);
          this.events.notice(
            'The cancelled connection did not confirm session closure; final usage is unverified.',
          );
        }, 3000);
        this.cancelledConnections.set(generation, { transport, timeout });
        transport.send({
          type: 'session.close',
          event_id: crypto.randomUUID(),
        });
        return;
      }
      this.transport = transport;
      transport.mute(!this.replies);
      if (this.ready) this.flushAudio();
    } catch (error) {
      if (epoch === this.epoch)
        this.fail(
          error instanceof Error ? error.message : 'GPT Live reconnect failed.',
        );
    } finally {
      if (epoch === this.epoch) this.connecting = false;
    }
  }
  private flushAudio() {
    if (!this.capture || !this.ready || !this.transport) return;
    if (
      this.transcriptionRetries > 0 &&
      this.untranscribed.length &&
      !this.transcript.trim()
    ) {
      const queuedMS = this.buffer.reduce(
        (total, frame) => total + frameDuration(frame),
        0,
      );
      this.transcriptionDeadline = performance.now() + queuedMS + SILENCE_MS;
    }
    for (const frame of this.buffer) this.capture.play(frame);
    this.buffer = [];
    this.flushFacts();
  }
  private flushFacts() {
    if (!this.ready || !this.transport || this.closing) return;
    for (const value of this.deferredFacts) this.append(value, null);
    this.deferredFacts = [];
  }
  private append(value: unknown, delegation: string | null) {
    this.replyAfterResult = true;
    // Give the saved result a fresh reply window before applying student silence.
    this.monitor.keepAlive(performance.now());
    const data =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : { result: String(value) };
    const text =
      typeof data.result === 'string'
        ? data.result
        : typeof data.readback === 'string'
          ? data.readback
          : typeof data.error === 'string'
            ? data.error
            : '';
    const characters = Array.from(text);
    const count = Math.max(1, Math.ceil(characters.length / 700));
    for (let index = 0; index < count; index++) {
      const id = crypto.randomUUID();
      this.acknowledgements.add(id);
      this.acknowledgementTimers.set(
        id,
        setTimeout(() => {
          if (this.acknowledgements.has(id))
            this.fail(
              'GPT Live did not acknowledge the saved result. Restart listening; the problem action is already preserved.',
            );
        }, 10000),
      );
      const facts = {
        status: data.status,
        saved: data.saved,
        revision: data.revision,
        result: characters.slice(index * 700, (index + 1) * 700).join(''),
        part: index + 1,
        parts: count,
      };
      this.transport?.send({
        type: 'session.commentary.append',
        event_id: id,
        delegation_id: delegation,
        content: JSON.stringify(facts),
      });
    }
  }
  private receive(
    event: Record<string, unknown>,
    epoch: number,
    generation: number,
  ) {
    const cancelled = this.cancelledConnections.get(generation);
    if (cancelled) {
      if (event.type === 'session.closed') {
        clearTimeout(cancelled.timeout);
        cancelled.transport.dispose();
        this.cancelledConnections.delete(generation);
        this.events.closed?.(event);
      }
      return;
    }
    if (generation !== this.connectionGeneration) return;
    if (event.type === 'session.closed') {
      const requestedClose = this.closing;
      this.events.playback?.(false);
      journeyPoint(this.connectionJourney, 'session-closed');
      this.finalizedConnections.add(generation);
      if (this.finalizedConnections.size > 20)
        this.finalizedConnections.delete(
          this.finalizedConnections.values().next().value!,
        );
      clearTimeout(this.closeTimer);
      clearTimeout(this.startTimer);
      this.events.closed?.(event);
      this.transport?.dispose();
      this.transport = null;
      this.ready = false;
      this.closing = false;
      this.acknowledgements.clear();
      this.delegations.clear();
      this.waitingDelegation = null;
      for (const timer of this.acknowledgementTimers.values())
        clearTimeout(timer);
      this.acknowledgementTimers.clear();
      if (this.wanted) {
        if (
          !requestedClose &&
          !this.paused &&
          !this.inputStopped &&
          !this.failed &&
          this.lastInputSignal !== null &&
          !this.transcriptionReceived &&
          !this.transcript.trim()
        )
          this.recoverUntranscribed(performance.now());
        this.events.provider?.('monitoring');
        if (this.monitor.active || this.deferredFacts.length)
          void this.connect();
      }
      return;
    }
    if (epoch !== this.epoch || !this.wanted) return;
    if (event.type === 'session.started') {
      if (this.connectionStarted !== null) {
        journeySpan(
          this.connectionJourney,
          'connection',
          this.connectionStarted,
        );
        journeyPoint(this.connectionJourney, 'connection-ready');
      }
      this.ready = true;
      clearTimeout(this.startTimer);
      this.events.provider?.('connected');
      this.flushAudio();
      return;
    }
    if (event.type === 'session.commentary.appended') {
      const id = String(event.client_event_id);
      this.acknowledgements.delete(id);
      clearTimeout(this.acknowledgementTimers.get(id));
      this.acknowledgementTimers.delete(id);
      return;
    }
    if (event.type === 'playback.activity') {
      if (this.failed || this.closing || !this.ready || !this.replies) return;
      if (event.active === true && this.awaitingAudio) {
        journeyPoint(this.awaitingAudio, 'next-audio-observed');
        this.awaitingAudio = null;
      }
      this.events.playback?.(event.active === true);
      return;
    }
    if (
      ['error', 'transport.error', 'playback.error'].includes(
        String(event.type),
      )
    ) {
      this.fail(
        'GPT Live connection or playback failed. Restart listening; your problem is preserved.',
      );
      return;
    }
    if (this.failed || this.closing || !this.ready) return;
    if (
      event.type === 'session.output_transcript.delta' &&
      typeof event.delta === 'string'
    ) {
      // Separate paused sentences for display; preserve token fragments and decimal points.
      const pausedSentence =
        (this.replyAfterResult ||
          (this.replyEndMS !== null &&
            typeof event.start_ms === 'number' &&
            event.start_ms - this.replyEndMS >= 400)) &&
        /[.!?]["'”’)]?$/.test(this.reply) &&
        /^["'“‘(]?\p{L}/u.test(event.delta);
      if (pausedSentence || /^\s/u.test(event.delta))
        this.replyAfterResult = false;
      this.reply = (
        this.reply +
        (pausedSentence ? ' ' : '') +
        event.delta
      ).slice(-4000);
      this.replyEndMS =
        typeof event.end_ms === 'number' && Number.isFinite(event.end_ms)
          ? event.end_ms
          : null;
      this.events.reply?.(this.reply);
      return;
    }
    if (
      event.type === 'session.input_transcript.delta' &&
      typeof event.delta === 'string' &&
      !this.paused
    ) {
      if (!this.transcript.trim() && !event.delta.trim()) return;
      if (this.transcriptionNotice) {
        this.transcriptionNotice = false;
        this.events.notice('');
      }
      if (!this.transcript) {
        this.reply = '';
        this.replyEndMS = null;
        this.replyAfterResult = false;
        this.events.reply?.('');
      }
      this.clearUntranscribed();
      this.transcriptionReceived = true;
      this.transcript = (this.transcript + event.delta).slice(-4000);
      this.lastTranscriptAt = performance.now();
      this.lastInputSignal ??= this.lastTranscriptAt;
      this.utterance ||= crypto.randomUUID();
      this.events.partial(this.transcript);
      return;
    }
    if (event.type !== 'session.delegation.created') return;
    const delegation = event.delegation as
      | { id?: string; target?: string }
      | undefined;
    if (
      !delegation?.id ||
      delegation.target !== 'client' ||
      this.delegations.has(delegation.id)
    )
      return;
    this.clearUntranscribed();
    this.transcriptionReceived = true;
    this.delegations.add(delegation.id);
    if (this.waitingDelegation || !this.transcript.trim()) {
      if (!this.waitingDelegation && this.lastInputSignal !== null)
        this.waitingDelegation = { id: delegation.id, at: performance.now() };
      else
        this.transport?.send({
          type: 'session.thinking.append',
          delegation_id: delegation.id,
          content:
            'No new transcribed request is available. A prior request may already be handled or pending. Do not execute it again or announce an unsupported error; wait for a new student request.',
        });
      return;
    }
    const text = this.transcript;
    const id = this.utterance || crypto.randomUUID();
    if (this.lastInputSignal !== null)
      journeyPoint(id, 'last-input-signal', this.lastInputSignal);
    journeyPoint(id, 'delegated');
    this.lastInputSignal = null;
    this.lastTranscriptAt = null;
    this.transcript = '';
    this.utterance = '';
    // Keep the caption visible when a delta and delegation arrive before the next screen paint.
    this.pending++;
    const operation = new AbortController();
    this.operations.add(operation);
    // Deliver corrections immediately; the problem client serializes durable mutations.
    void (async () => {
      try {
        if (epoch !== this.epoch) return;
        const result =
          text.trim() && this.events.execute
            ? await this.events.execute(text, id, operation.signal)
            : {
                status: 'unsupported',
                error: 'No complete request was recognized.',
              };
        if (epoch === this.epoch && this.wanted) {
          journeyPoint(id, 'result-returned');
          this.append(result, delegation.id!);
          journeyPoint(id, 'commentary-sent');
          // Full-duplex audio has no result ID; only observe the next idle-to-audio transition.
          if (this.replies && this.pending === 1 && !this.transport?.speaking())
            this.awaitingAudio = id;
        }
      } catch (error) {
        journeyPoint(id, operation.signal.aborted ? 'cancelled' : 'failed');
        if (epoch === this.epoch && this.wanted)
          this.append(
            {
              status: 'unconfirmed',
              error:
                error instanceof Error
                  ? error.message
                  : 'The action could not be confirmed.',
            },
            delegation.id!,
          );
      } finally {
        this.operations.delete(operation);
        this.pending--;
      }
    })();
  }
  private async finishTranscript(epoch: number, complete = false) {
    const text = this.transcript,
      id = this.utterance || crypto.randomUUID();
    const delegation = this.waitingDelegation?.id ?? null;
    this.waitingDelegation = null;
    if (this.lastInputSignal !== null)
      journeyPoint(id, 'last-input-signal', this.lastInputSignal);
    journeyPoint(id, complete ? 'fast-dispatch' : 'transcript-fallback');
    this.lastInputSignal = null;
    this.lastTranscriptAt = null;
    this.transcript = '';
    this.utterance = '';
    // Reset command input without erasing the student's visible caption.
    this.pending++;
    const operation = new AbortController();
    this.operations.add(operation);
    try {
      const result = await this.events.execute?.(text, id, operation.signal);
      if (epoch === this.epoch && this.wanted) {
        journeyPoint(id, 'result-returned');
        this.append(result ?? { status: 'unsupported' }, delegation);
        journeyPoint(id, 'commentary-sent');
        if (this.replies && this.pending === 1 && !this.transport?.speaking())
          this.awaitingAudio = id;
      }
    } catch (error) {
      journeyPoint(id, operation.signal.aborted ? 'cancelled' : 'failed');
      this.events.notice(
        error instanceof Error
          ? error.message
          : 'The last request could not be confirmed.',
      );
    } finally {
      this.operations.delete(operation);
      this.pending--;
    }
  }
  private closeProvider() {
    if (!this.transport || this.closing) return;
    this.events.playback?.(false);
    this.transport.mute(true);
    this.closing = true;
    this.events.provider?.('closing');
    this.transport.send({
      type: 'session.close',
      event_id: crypto.randomUUID(),
    });
    this.closeTimer = setTimeout(() => {
      this.transport?.dispose();
      this.transport = null;
      this.ready = false;
      this.closing = false;
      this.fail(
        'The provider did not confirm session closure. Restart listening; final usage is unverified.',
      );
    }, 3000);
  }
  private fail(message: string) {
    for (const operation of this.operations) operation.abort();
    this.operations.clear();
    this.events.playback?.(false);
    this.failed = true;
    this.clearUntranscribed();
    this.waitingDelegation = null;
    this.buffer = [];
    this.monitor.clear();
    clearTimeout(this.startTimer);
    this.transcript = '';
    this.utterance = '';
    for (const timer of this.acknowledgementTimers.values())
      clearTimeout(timer);
    this.acknowledgementTimers.clear();
    this.acknowledgements.clear();
    this.lastInputSignal = null;
    this.lastTranscriptAt = null;
    this.awaitingAudio = null;
    this.events.provider?.('error');
    this.events.notice(message);
    this.closeProvider();
  }
}
