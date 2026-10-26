import { expect, test } from 'vitest';
import { SilenceMonitor } from './silence-monitor.ts';
const frame = (level: number, at: number) => ({
  samples: new Float32Array(960).fill(level),
  sampleRate: 48000,
  at,
});
test('extended silence never wakes Live and quiet speech retains 300ms pre-roll', () => {
  const wakes: number[][] = [];
  const monitor = new SilenceMonitor({
    wake: (frames) => wakes.push(frames.map((f) => f.at)),
    frame() {},
    idle() {},
  });
  for (let at = 0; at < 20000; at += 20) monitor.sample(frame(0.0002, at));
  expect(wakes).toHaveLength(0);
  for (let at = 20000; at <= 20060; at += 20) monitor.sample(frame(0.004, at));
  expect(wakes).toHaveLength(1);
  expect(wakes[0][0]).toBeLessThanOrEqual(19780);
});
test('hysteresis preserves quiet speech and a two-second hesitation without closing', () => {
  let closes = 0;
  const monitor = new SilenceMonitor({
    wake() {},
    frame() {},
    idle() {
      closes++;
    },
  });
  for (let at = 0; at <= 80; at += 20) monitor.sample(frame(0.004, at));
  for (let at = 100; at <= 1000; at += 20) monitor.sample(frame(0.002, at));
  monitor.tick(3000);
  expect(closes).toBe(0);
  monitor.sample(frame(0.002, 3020));
  monitor.tick(8019);
  expect(closes).toBe(0);
  monitor.tick(8020);
  expect(closes).toBe(1);
});

test('reply keep-alive lets silent input drain while preserving the connection and new speech', () => {
  const forwarded: number[] = [];
  let closes = 0;
  const monitor = new SilenceMonitor({
    wake() {},
    frame: (value) => forwarded.push(value.at),
    idle: () => closes++,
  });
  for (let at = 0; at <= 80; at += 20) monitor.sample(frame(0.004, at));
  for (let at = 100; at <= 10000; at += 20) {
    monitor.keepAlive(at);
    monitor.sample(frame(0, at));
    monitor.tick(at);
  }
  expect(closes).toBe(0);
  expect(forwarded.at(-1)).toBe(5060);
  monitor.sample(frame(0.004, 10020));
  expect(forwarded.at(-1)).toBe(10020);
});

test('a complete request can drain its silence tail sooner without closing or losing new speech', () => {
  const forwarded: number[] = [];
  let closes = 0;
  const monitor = new SilenceMonitor({
    wake() {},
    frame: (f) => forwarded.push(f.at),
    idle: () => closes++,
  });
  for (let at = 0; at <= 80; at += 20) monitor.sample(frame(0.004, at));
  monitor.setInputTail(1200);
  for (let at = 100; at <= 2000; at += 20) {
    monitor.sample(frame(0, at));
    monitor.tick(at);
  }
  expect(forwarded.at(-1)).toBe(1260);
  expect(closes).toBe(0);
  monitor.sample(frame(0.004, 2020));
  expect(forwarded.at(-1)).toBe(2020);
});
