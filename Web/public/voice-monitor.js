// Microphone samples are kept in memory and never recorded to a file.
class VoiceMonitorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(Math.round(sampleRate / 50));
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.frame[this.offset++] = sample;
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(Math.round(sampleRate / 50));
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-monitor', VoiceMonitorProcessor);
