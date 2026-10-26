import {
  browserVoiceEnvironment,
  type VoiceEnvironment,
  type LiveTransport,
  type LocalCapture,
} from './browser-live.ts';
import {
  SilenceMonitor,
  rms,
  type AudioFrame,
} from '../services/silence-monitor.ts';
import type { LiveContext } from '../types/index.ts';
export type GuidedInputEvents = {
  partial(text: string): void;
  status(text: string): void;
  level?(value: number): void;
  capture?(stream: MediaStream): () => void;
};

/**
 * Captures one real spoken line with the app's normal microphone and Live transport.
 * - Emits actual transcript deltas; never substitutes cue text.
 * - Waits for speech silence and settled transcription, with no idle speech deadline.
 * - Stops microphone input before resolving; provider delegations cannot edit work.
 */
export function recognizeGuidedLine(
  context: LiveContext,
  events: GuidedInputEvents,
  signal: AbortSignal,
  environment: VoiceEnvironment = browserVoiceEnvironment,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let capture: LocalCapture | undefined,
      transport: LiveTransport | undefined,
      disconnect: (() => void) | undefined;
    let settled = false,
      ready = false,
      connecting = false,
      text = '',
      lastSignal: number | null = null,
      lastText = 0;
    let buffer: AudioFrame[] = [];
    let connectionTimeout: ReturnType<typeof setTimeout> | undefined;
    let closeTimeout: ReturnType<typeof setTimeout> | undefined;
    const releaseProvider = () => {
      clearTimeout(closeTimeout);
      transport?.dispose();
      transport = undefined;
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      clearTimeout(connectionTimeout);
      signal.removeEventListener('abort', abort);
      disconnect?.();
      capture?.close();
      buffer = [];
      events.level?.(0);
      if (transport) {
        transport.send({ type: 'session.close' });
        closeTimeout = setTimeout(releaseProvider, 1500);
      }
      if (error) reject(error);
      else resolve(text.trim());
    };
    const abort = () =>
      finish(new DOMException('Guided take stopped.', 'AbortError'));
    const flush = () => {
      if (!ready || !capture) return;
      for (const frame of buffer) capture.play(frame);
      buffer = [];
    };
    const receive = (event: Record<string, unknown>) => {
      if (event.type === 'session.closed') {
        releaseProvider();
        if (!settled)
          finish(new Error('Voice connection closed. Try this take again.'));
        return;
      }
      if (settled) return;
      if (event.type === 'session.started') {
        ready = true;
        clearTimeout(connectionTimeout);
        events.status('Listening…');
        flush();
      }
      if (
        event.type === 'session.input_transcript.delta' &&
        typeof event.delta === 'string'
      ) {
        text = (text + event.delta).slice(-4000);
        lastText = performance.now();
        events.partial(text);
      }
      if (event.type === 'session.delegation.created') {
        const delegation = event.delegation as { id?: string } | undefined;
        if (delegation?.id)
          transport?.send({
            type: 'session.thinking.append',
            delegation_id: delegation.id,
            content:
              'Guided recording input only. No action is delegated here. Remain silent while the client waits for the student to finish.',
          });
      }
      if (
        ['error', 'transport.error', 'playback.error'].includes(
          String(event.type),
        )
      )
        finish(
          new Error(
            'Live transcription failed. Stop and try the guided take again.',
          ),
        );
    };
    const connect = async () => {
      if (!capture || settled || connecting || transport) return;
      connecting = true;
      events.status('Connecting speech…');
      connectionTimeout = setTimeout(
        () =>
          finish(
            new Error(
              'Live transcription did not connect. Try this take again.',
            ),
          ),
        25000,
      );
      try {
        const live = await environment.connect(
          capture,
          context,
          receive,
          crypto.randomUUID(),
          undefined,
          350,
          true,
        );
        if (settled) {
          live.send({ type: 'session.close' });
          live.dispose();
          return;
        }
        transport = live;
        transport.mute(true);
        flush();
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error('Live transcription could not start.'),
        );
      }
    };
    const activity = new SilenceMonitor({
      wake() {
        void connect();
      },
      frame() {},
      idle() {},
      signal(at) {
        lastSignal = at;
      },
    });
    const tick = setInterval(() => {
      const now = performance.now();
      if (
        ready &&
        lastSignal !== null &&
        now - lastSignal > 20000 &&
        !text.trim()
      )
        finish(
          new Error(
            'No transcript arrived. Try saying the cue again in a new take.',
          ),
        );
      if (
        ready &&
        text.trim() &&
        lastSignal !== null &&
        now - lastSignal >= 1800 &&
        now - lastText >= 650 &&
        !capture?.draining()
      )
        finish();
    }, 50);
    signal.addEventListener('abort', abort, { once: true });
    events.partial('');
    events.status('Opening microphone…');
    void (async () => {
      try {
        if (!(await environment.configured()))
          throw new Error(
            'Voice is not configured. The automatic take is still available.',
          );
        const input = await environment.monitor((frame) => {
          if (settled) return;
          activity.sample(frame);
          events.level?.(rms(frame.samples));
          if (ready && capture) {
            if (lastSignal !== null && frame.at - lastSignal < 1200)
              capture.play(frame);
          } else {
            buffer.push(frame);
            const limit = activity.active ? 10000 : 300;
            while (buffer.length > 1 && frame.at - buffer[0].at > limit)
              buffer.shift();
          }
        }, signal);
        if (settled) {
          input.close();
          return;
        }
        capture = input;
        disconnect = events.capture?.(capture.stream);
        events.status('Listening—say the line when you’re ready.');
        if (activity.active) void connect();
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error('The microphone could not start.'),
        );
      }
    })();
  });
}
