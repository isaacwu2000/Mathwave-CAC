import { PROGRAM_LIMITS, toolInstructions } from './tool-catalog.ts';

/** Shared language and save semantics; signatures and tool-specific rules come from executable contracts. */
export const programProtocol = `Math program API. Names joined by | share a signature.
Allow initialized const bindings, finite arithmetic (+ - * / **), strings, arrays, explicit object properties and approved calls only. No imports, loops, functions, assignment, property reads, computed calls, casts or network.
Per program: <=${PROGRAM_LIMITS.characters} characters, <=${PROGRAM_LIMITS.statements} statements, <=${PROGRAM_LIMITS.calls} calls; bindings are local. Transforms return immutable values; reselect parts after a transform. Graph handles share one collection; select other curves from it, never mix collections.
One problem.save applies the final value; no save means read-only. A failed statement rejects its program. Explicitly sequenced steps each need a complete program, including subtraction then simplification. Up to six programs run in order on preceding saved results; validate the whole batch before persistence. Undo recovers the request.
Controls must be the sole call. Queries read temporary values without saving; never save just to answer.`;

/** Complete interpreter reference; optional graph/construction language context adds its own registered calls. */
export const programInstructions = `${programProtocol}
${toolInstructions('interpreter')}
For actions, queries, suggestions or corrections, use programs: an array of one to six complete sources. Empty means reply without a proposal, unsupported or clarification. Suggestions include proposed actions and problem.save but stay unapplied until accepted; put read-only calculations in previews, not proposals. Honor requests to leave work unchanged. Corrections replace the previous turn against its original state, not its mistaken result. Preserve domains and perform only requested math.`;
