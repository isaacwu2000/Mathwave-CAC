import type { Workspace } from '../../workspace/state.ts';

/** Short numeric answers can resume a build; controls and unrelated requests retain their normal route. */
export function isGraphClarificationAnswer(text: string) {
  return /^(?:(?:it is|use|radius|from|between|negative|minus)\s+)*(?:[+−-]?\d|zero\b|one\b|two\b|three\b|four\b|five\b|six\b|seven\b|eight\b|nine\b|ten\b|eleven\b|twelve\b|twenty\b|thirty\b|forty\b|fifty\b|half\b|pi\b)/i.test(
    text.trim(),
  );
}

/** Route creation/edit requests, keeping readback, history, and navigation on their existing path. */
export function isGraphBuildRequest(text: string, state: Workspace) {
  text = text
    .trim()
    .replace(/^(?:can|could|would) you\s+(?:please\s+)?/i, '')
    .replace(/^please\s+/i, '');
  // Compound requests need the full interpreter, which can save visuals, equations and queries together.
  // The streamed builder accepts visual operations only; do not guess the second clause's capability.
  if (/\b(?:and|then)\b|;/i.test(text)) return false;
  if (
    /^(?:construct|construction|add (?:a |an |the )?(?:point|segment|ray|circle|midpoint|bisector|perpendicular|parallel|incircle|circumcircle)|move (?:point|vertex))\b/i.test(
      text,
    )
  )
    return true;
  if (
    /^(?:show me|create|make) (?:a |an |the )?(?:graph|plot|circle|triangle|rectangle|square|regular polygon|annulus|sector)\b/i.test(
      text,
    )
  )
    return true;
  if (
    /^(?:read|describe|find|what|calculate|evaluate|table|play|hear|undo|redo|cancel|restore|open|new |hide |show |close |stop |help|export|equations|statistics|area|perimeter|volume|surface area|slope|integral|total area|average rate|classify|diameter|circumference|hypotenuse|angle [abc]|chord length|arc length|thickness|space diagonal)\b/i.test(
      text.trim(),
    )
  )
    return false;
  if (
    /^(?:please\s+)?(?:graph\b|plot\b|draw\b|sketch\b|add (?:a |an |the )?(?:graph|curve|tangent|normal|secant|derivative)\b|edit graph\b|remove graph\b|shift graph\b|reflect graph\b|scale graph\b|circle\b|triangle\b|right triangle\b|rectangle\b|square\b|regular polygon\b|annulus\b|sector\b|sphere\b|cylinder\b|cone\b|cube\b|rectangular prism\b|parallelogram\b|trapezoid\b)/i.test(
      text.trim(),
    )
  )
    return true;
  return (
    (state.graph || state.mode === 'geometry') &&
    /^(?:please\s+)?(?:make (?:it|that|the (?:graph|curve|shape))\b|change (?:it|that|the (?:graph|curve|shape|radius|side|height|width))\b|set (?:the )?(?:radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c)\b|double (?:the )?shape\b|halve (?:the )?shape\b|scale (?:the )?shape\b|actually\b|instead\b)/i.test(
      text.trim(),
    )
  );
}
