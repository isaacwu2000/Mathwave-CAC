import { expect, test } from 'vitest';
import {
  interpretationInstructions,
  graphInterpretationInstructions,
  interpretationSchema,
} from './interpretation.ts';
import { voiceInstructions } from './openai-config.ts';
import { toolInstructions, voiceCapabilities } from '../../commands/index.ts';

test('Live and Luna consume generated tool views while retaining their own interaction policies', () => {
  expect(voiceInstructions).toContain(voiceCapabilities());
  expect(voiceInstructions).toContain('<|SpawnThinking|>');
  expect(voiceInstructions).not.toContain('graph.add(');
  expect(interpretationInstructions).toContain(toolInstructions('interpreter'));
  expect(interpretationInstructions).not.toContain(
    'Legacy English commands above',
  );
  expect(graphInterpretationInstructions).toContain(toolInstructions('graph'));
  expect(graphInterpretationInstructions).not.toMatch(
    /statistics\.|history\.|audio\.|math\.solve|presentation/,
  );
});

test('the active interpreter prompt describes only its current response protocol', () => {
  expect(Object.keys(interpretationSchema.properties)).toEqual([
    'status',
    'programs',
    'message',
    'completion',
    'presentation',
  ]);
  expect(interpretationInstructions).not.toMatch(
    /legacy (?:response|command|format|field)|leave revision|command and message stay empty|leave legacy command/i,
  );
  expect(interpretationInstructions).toContain(
    'use programs: an array of one to six complete sources',
  );
});

test('all agent views explain unavailable features without inventing a fallback', () => {
  for (const instructions of [
    voiceInstructions,
    interpretationInstructions,
    graphInterpretationInstructions,
  ]) {
    expect(instructions).toContain('Name the specific unavailable feature');
    expect(instructions).toContain('Never claim it was completed');
    expect(instructions).toContain('Ask one focused question');
    expect(instructions).toContain('Do not silently substitute');
  }
});
