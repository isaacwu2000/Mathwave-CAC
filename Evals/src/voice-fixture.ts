import type { VoiceObservation } from './voice-parity.ts';
export type FixtureWindow = Window & {
  playEvaluationFixture?: (audio: string) => Promise<void>;
  voiceObservations?: VoiceObservation[];
  liveAudioDiagnostics?: {
    at: number;
    type: string;
    values: Record<string, string | number | boolean | null>;
  }[];
  liveEvaluationEvents?: {
    at: number;
    type: string;
    session?: unknown;
    delta?: string;
    delegation?: unknown;
  }[];
};

/** Installs a synthetic input device and independent playback observations in an isolated evaluation browser. */
export function installVoiceFixture(
  input: string | { audio: string; dropFirstRecognition: boolean },
) {
  const firstAudio = typeof input === 'string' ? input : input.audio;
  const dropFirstRecognition =
    typeof input !== 'string' && input.dropFirstRecognition;
  let connections = 0;
  const trace: NonNullable<FixtureWindow['liveEvaluationEvents']> = [];
  (window as FixtureWindow).liveEvaluationEvents = trace;
  const diagnostics: NonNullable<FixtureWindow['liveAudioDiagnostics']> = [];
  (window as FixtureWindow).liveAudioDiagnostics = diagnostics;
  const recordAudio = (
    type: string,
    values: Record<string, string | number | boolean | null>,
  ) => {
    diagnostics.push({ at: performance.now(), type, values });
    if (diagnostics.length > 400) diagnostics.shift();
  };
  const observations: VoiceObservation[] = [];
  (window as FixtureWindow).voiceObservations = observations;
  let expected = '';
  let inputActive = false;
  let changedAt = 0;
  let audibleUntil = -Infinity;
  const meters: { analyser: AnalyserNode; stream: MediaStream }[] = [];
  const outputs: HTMLAudioElement[] = [];
  const NativeAudio = window.Audio;
  window.Audio = class extends NativeAudio {
    constructor(src?: string) {
      super(src);
      outputs.push(this);
    }
  };
  const meterContext = new AudioContext();
  setInterval(() => {
    const at = performance.now();
    for (const { analyser: meter, stream } of meters) {
      if (
        !outputs.some(
          (audio) =>
            !audio.muted && !audio.paused && audio.srcObject === stream,
        )
      )
        continue;
      const samples = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(samples);
      if (
        Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length) >
        0.001
      )
        audibleUntil = at + 350;
    }
    const panel = document.querySelector('.audio-group');
    const transcript = panel?.querySelector('.pico-reply');
    const microphone = panel?.querySelector('.audio-panel');
    if (!panel) return;
    observations.push({
      at,
      audible:
        at < audibleUntil &&
        outputs.some(
          (audio) => !audio.muted && !audio.paused && audio.srcObject,
        ),
      speaking: panel.getAttribute('data-speaking') === 'true',
      microphoneActive: microphone?.getAttribute('aria-pressed') === 'true',
      microphoneText:
        microphone?.querySelector('.audio-transcript')?.textContent ?? '',
      source: transcript?.getAttribute('data-source') ?? '',
      text: transcript?.textContent ?? '',
      expected,
      settled: at - changedAt > 200,
    });
    if (observations.length > 3000) observations.shift();
  }, 100);

  // oxlint-disable-next-line typescript/unbound-method -- apply below preserves the peer receiver.
  const createChannel = RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel = function (...args) {
    const connection = ++connections;
    this.addEventListener('track', (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      const source = meterContext.createMediaStreamSource(stream);
      const meter = meterContext.createAnalyser();
      meter.fftSize = 512;
      source.connect(meter);
      meters.push({ analyser: meter, stream });
      void meterContext.resume();
    });
    // Outgoing packet counts and source energy distinguish silence from untranscribed speech.
    if (typeof this.getStats === 'function') {
      const timer = setInterval(() => {
        if (this.connectionState === 'closed') {
          clearInterval(timer);
          return;
        }
        void this.getStats()
          .then((stats) => {
            stats.forEach((row) => {
              if (row.type === 'outbound-rtp' && row.kind === 'audio')
                recordAudio('outbound-audio', {
                  packetsSent: row.packetsSent ?? 0,
                  bytesSent: row.bytesSent ?? 0,
                });
              if (row.type === 'media-source' && row.kind === 'audio')
                recordAudio('outgoing-source', {
                  audioLevel: row.audioLevel ?? 0,
                  totalAudioEnergy: row.totalAudioEnergy ?? 0,
                  totalSamplesDuration: row.totalSamplesDuration ?? 0,
                });
            });
          })
          .catch(() => {});
      }, 250);
    }
    const channel = createChannel.apply(this, args);
    const send = channel.send.bind(channel);
    channel.send = (data: string | Blob | ArrayBuffer | ArrayBufferView) => {
      if (typeof data === 'string') {
        const event = JSON.parse(data);
        // Commentary marks a completed student request, including transcript fallback.
        if (event.type === 'session.commentary.append') inputActive = false;
      }
      send(data as string);
    };
    channel.addEventListener('message', (message) => {
      const event = JSON.parse(String(message.data));
      if (
        dropFirstRecognition &&
        connection === 1 &&
        [
          'session.input_transcript.delta',
          'session.delegation.created',
        ].includes(event.type)
      ) {
        recordAudio('recognition-withheld', { connection, event: event.type });
        message.stopImmediatePropagation();
      }
      if (event.type === 'session.closed') inputActive = false;
      if (event.type === 'session.input_transcript.delta') {
        if (!inputActive) expected = '';
        inputActive = true;
      }
      if (event.type === 'session.output_transcript.delta') {
        expected = (expected + String(event.delta ?? '')).slice(-4000);
        changedAt = performance.now();
      }
      if (
        [
          'session.started',
          'session.closed',
          'session.delegation.created',
          'session.input_transcript.delta',
          'session.output_transcript.delta',
        ].includes(event.type)
      ) {
        trace.push({
          at: performance.now(),
          type: event.type,
          session:
            event.type === 'session.started'
              ? {
                  model: event.session?.model,
                  delegation: { type: event.session?.delegation?.type },
                  instructions: event.session?.instructions,
                }
              : undefined,
          delta: typeof event.delta === 'string' ? event.delta : undefined,
          delegation: event.delegation
            ? { id: event.delegation.id, target: event.delegation.target }
            : undefined,
        });
        if (trace.length > 500) trace.shift();
      }
    });
    return channel;
  };
  let audioContext: AudioContext;
  let destination: MediaStreamAudioDestinationNode;
  const play = async (audio: string) => {
    const response = await fetch(audio);
    if (!response.ok) throw new Error('Fixture unavailable.');
    const buffer = await audioContext.decodeAudioData(
      await response.arrayBuffer(),
    );
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    await audioContext.resume();
    source.addEventListener('ended', () =>
      recordAudio('fixture-ended', { contextState: audioContext.state }),
    );
    recordAudio('fixture-scheduled', {
      duration: buffer.duration,
      contextState: audioContext.state,
    });
    source.start(audioContext.currentTime + 0.3);
  };
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: async () => {
      audioContext = new AudioContext();
      destination = audioContext.createMediaStreamDestination();
      await play(firstAudio);
      return destination.stream;
    },
  });
  (window as FixtureWindow).playEvaluationFixture = play;
}
