import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initialWorkspace } from '../../Web/src/modules/workspace/state.ts';
import { runCommand } from '../../Web/src/modules/commands/index.ts';

test('recorded demo fixtures contain nonempty PCM audio with verified checksums', () => {
  const clips = JSON.parse(
    readFileSync('public/demo-voices/manifest.json', 'utf8'),
  );
  assert.equal(clips.length, 12);
  const geometryClips = JSON.parse(
    readFileSync('public/demo-voices/graph-geometry/manifest.json', 'utf8'),
  );
  assert.equal(geometryClips.length, 63);
  assert.equal(
    new Set(geometryClips.map((c: { audio: string }) => c.audio)).size,
    63,
  );
  assert.equal(new Set(clips.map((c: { audio: string }) => c.audio)).size, 12);
  for (const clip of [...clips, ...geometryClips]) {
    assert.equal(clip.recognitionStatus, 'not-tested');
    const bytes = readFileSync(`public${clip.audio}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
    const decoder = new TextDecoder();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(decoder.decode(bytes.subarray(0, 4)), 'RIFF');
    assert.equal(decoder.decode(bytes.subarray(8, 12)), 'WAVE');
    let data: Uint8Array | undefined;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      assert.ok(offset + 8 + size <= bytes.length);
      if (decoder.decode(bytes.subarray(offset, offset + 4)) === 'data')
        data = bytes.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
    assert.ok(data && data.length > 22050);
    assert.ok(
      data.some((value) => value !== 0),
      clip.audio,
    );
    assert.ok(clip.durationSeconds > 0.5);
    if (clips.includes(clip))
      assert.doesNotThrow(() =>
        runCommand(initialWorkspace, clip.expectedCommand),
      );
  }
});
