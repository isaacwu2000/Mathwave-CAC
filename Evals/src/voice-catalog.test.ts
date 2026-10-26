import { expect, test } from 'vitest';
import { voiceCatalog, selectVoiceCampaign } from './voice-catalog.ts';

test('voice campaigns sample six categories while keeping recovery variants and conversation turns together', () => {
  const campaign = selectVoiceCampaign({ sample: 6, seed: 'first-campaign' });
  expect(new Set(campaign.map((c) => c.category)).size).toBe(6);
  expect(campaign.reduce((sum, c) => sum + c.turns, 0)).toBe(9);
  expect(campaign).toEqual(
    selectVoiceCampaign({ sample: 6, seed: 'first-campaign' }),
  );
  expect(
    voiceCatalog.find((c) => c.id === 'height-recovery')?.variants,
  ).toHaveLength(9);
  expect(
    voiceCatalog.find((c) => c.id === 'width-recovery')?.variants,
  ).toHaveLength(6);
});

test('every existing recording belongs to exactly one family', () => {
  const clips = voiceCatalog.flatMap((c) => c.variants);
  expect(clips).toHaveLength(75);
  expect(new Set(clips.map((c) => c.audio)).size).toBe(75);
  expect(voiceCatalog).toHaveLength(23);
  expect(voiceCatalog.filter((c) => c.turns > 1).map((c) => c.id)).toEqual([
    'natural-conversation',
  ]);
});
