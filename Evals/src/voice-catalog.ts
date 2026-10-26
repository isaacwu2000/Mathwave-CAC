import { createHash } from 'node:crypto';
import algebraClips from '../../Web/public/demo-voices/manifest.json';
import geometryClips from '../../Web/public/demo-voices/graph-geometry/manifest.json';
import graphCases from '../inputs/recorded-graph-geometry/cases.json';
import { naturalVoiceCases } from './natural-voice-conversation.ts';
import { selectCases, type SelectionOptions } from './case-selection.ts';

export type VoiceVariant = {
  case: string;
  voice: string;
  audio: string;
  sha256: string;
};
export type VoiceCase = {
  id: string;
  category: string;
  turns: number;
  variants: VoiceVariant[];
};
export const recordedScenarios = [
  { id: 'equation', setup: [], expectedCommand: 'write 2*x+3=11' },
  {
    id: 'step',
    setup: ['write 2*x+3=11'],
    expectedCommand: 'subtract 3 from both sides',
  },
  // Agent programs answer queries without saving their temporary data; parser fixtures predate that contract.
  {
    id: 'median',
    setup: [],
    expectedCommand: 'median of 2,4,8,10',
    readOnly: true,
    answerPatterns: ['median', '\\b(?:6|six)\\b'],
  },
  {
    id: 'outliers',
    setup: ['data 4,5,5,6,7,8,22'],
    expectedCommand: 'find outliers',
  },
  ...graphCases,
];
const clips = [...algebraClips, ...geometryClips];

/** Groups acoustic variants into one family so extra recordings do not inflate coverage. */
function family(id: string) {
  if (['height-reply', 'height-confirm', 'height-clear-reply'].includes(id))
    return 'height-recovery';
  if (['width-reply', 'width-clear-reply'].includes(id))
    return 'width-recovery';
  return id;
}
export const voiceCatalog: VoiceCase[] = [
  ...new Set(recordedScenarios.map((c) => family(c.id))),
].map((id) => ({
  id,
  category: ['equation', 'step'].includes(id)
    ? 'algebra'
    : ['median', 'outliers'].includes(id)
      ? 'statistics'
      : ['function', 'range', 'intercepts', 'point'].includes(id)
        ? 'graphs'
        : ['missing-height', 'height-recovery', 'width-recovery'].includes(id)
          ? 'clarification'
          : 'geometry',
  turns: 1,
  variants: clips.filter((clip) => family(clip.case) === id),
}));
voiceCatalog.push({
  id: 'natural-conversation',
  category: 'conversation',
  turns: naturalVoiceCases.length,
  variants: [],
});

/** Selects whole families, then one reproducible voice/wording variant per standalone case. */
export function selectVoiceCampaign(options: SelectionOptions) {
  return selectCases(voiceCatalog, options).map((item) => {
    const hash = Number.parseInt(
      createHash('sha256')
        .update(`${options.seed ?? 'default'}:${item.id}`)
        .digest('hex')
        .slice(0, 8),
      16,
    );
    return {
      ...item,
      variant: item.variants.length
        ? item.variants[hash % item.variants.length]
        : null,
    };
  });
}
