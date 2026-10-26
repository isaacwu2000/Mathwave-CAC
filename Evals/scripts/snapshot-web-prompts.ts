import { writeFile } from 'node:fs/promises';
import {
  interpretationInstructions,
  graphInterpretationInstructions,
  voiceInstructions,
  graphBuildOutputInstructions,
} from '../../Web/src/modules/ai/index.ts';
import {
  graphSceneInstructionsFor,
  constructionInstructionsFor,
} from '../../Web/src/modules/commands/index.ts';
import { initialWorkspace } from '../../Web/src/modules/workspace/state.ts';
const sections = [
  [
    'MAIN INTERPRETER (optional context follows only for relevant requests)',
    interpretationInstructions,
    graphInterpretationInstructions,
  ],
  ['LIVE VOICE COMPANION', voiceInstructions],
  [
    'STREAMED GRAPH BUILD (base plus its output instructions)',
    graphInterpretationInstructions + graphBuildOutputInstructions,
  ],
  [
    'OPTIONAL GRAPH CONTEXT',
    graphSceneInstructionsFor('polar graph', initialWorkspace),
  ],
  [
    'OPTIONAL CONSTRUCTION CONTEXT',
    constructionInstructionsFor('construction', initialWorkspace),
  ],
];
await writeFile(
  new URL('../WEB-AI-SYSTEM-PROMPTS.txt', import.meta.url),
  'Mathwave Web AI system prompts — current source snapshot\nActual app instruction strings. Request, workspace and dialogue are supplied separately. Optional API supplements are selected locally. Execution, numerical validation, persistence and undo belong to the math command runner.\n\n' +
    sections
      .map(([title, prompt]) => `=== ${title} ===\n${prompt}\n`)
      .join('\n')
      .trimEnd() +
    '\n',
);
console.log(
  JSON.stringify({
    mainCharacters: interpretationInstructions.length,
    voiceCharacters: voiceInstructions.length,
  }),
);
