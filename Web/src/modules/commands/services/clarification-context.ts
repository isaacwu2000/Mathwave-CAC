import { evaluateMath, parseMath } from '../../math/index.ts';
import type { ClarificationContext } from '../types/clarification-context.ts';
export type { ClarificationContext } from '../types/clarification-context.ts';
export function validateClarificationContext(
  value: unknown,
): ClarificationContext | undefined {
  if (value === undefined) return undefined;
  const c = value as ClarificationContext;
  if (
    !c ||
    typeof c.request !== 'string' ||
    !c.request.trim() ||
    c.request.length > 2000 ||
    typeof c.question !== 'string' ||
    !c.question.trim() ||
    c.question.length > 1000
  )
    throw new Error('Invalid clarification context.');
  return { request: c.request, question: c.question };
}
function geometryReplyValue(answer: string, key: string) {
  return answer.replace(
    new RegExp(
      `^(?:the )?${key}(?:\\s+(?:is|equals|should be|must be|to))?\\s+`,
      'i',
    ),
    '',
  );
}
function startsNewRequest(answer: string) {
  return /^(?:undo|redo|read|help|stop|cancel|clear|graph|plot|calculate|solve|write|data|new|open|show|set|change|replace|draw|create|make|circle|rectangle|triangle|sphere|square|cylinder|add|subtract|multiply|divide|zoom|range|find|describe|next|previous)\b|^hide (?:graph|steps|saved problems|calculations)\b/.test(
    answer,
  );
}
/** Resolve only exact, unambiguous answers; other follow-ups go to the interpreter with context. */
export function resolveClarification(
  context: ClarificationContext | undefined,
  reply: string,
): string | null {
  if (!context) return null;
  const answer = reply
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/^please\s+/, '');
  const request = context.request
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^please\s+/i, '');
  if (
    /^(?:on |from |to )?both sides$/.test(answer) &&
    !/;|\b(then|left|right|side|sides)\b/i.test(request)
  ) {
    if (/^(?:please )?subtract\b/i.test(request))
      return `${request} from both sides`;
    if (/^(?:please )?add\b/i.test(request)) return `${request} to both sides`;
  }
  if (
    /^(sample|population)(?: (?:variance|standard deviation))?$/.test(answer) &&
    /\b(variance|standard deviation)\b/i.test(request)
  ) {
    const kind = answer.split(' ')[0];
    return `${kind} ${request.replace(/^(?:find |calculate |what is (?:the )?|the )/i, '')}`;
  }
  const dimensionQuestion = context.question.match(
    /^What is the (?:rectangular prism|cube|annulus|sector|regular polygon|circle|square|rectangle|triangle|right triangle|sphere|cylinder|cone|parallelogram|trapezoid|rectangular prism|cube|annulus|sector|regular polygon) (radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c)\?$/i,
  );
  if (
    dimensionQuestion &&
    /^(?:(?:(?:find|calculate|show|read)(?: me)? (?:the )?|what is (?:the )?)?(?:area|perimeter|circumference|diameter|diagonal|hypotenuse|volume|surface area|slant height) of (?:a |the )?)?(?:(?:draw|create|make|geometry)\s+(?:a\s+)?)?(?:right triangle|rectangle|triangle|cylinder|sphere|circle|square|cone|parallelogram|trapezoid|rectangular prism|cube|annulus|sector|regular polygon)\b/i.test(
      request,
    ) &&
    !/;|\bthen\b/i.test(request)
  ) {
    const key = dimensionQuestion[1];
    const value = geometryReplyValue(answer, key);
    try {
      evaluateMath(parseMath(value));
    } catch {
      return startsNewRequest(answer) ? null : request;
    }
    const baseRequest = request.replace(
      new RegExp(`\\s+${key}(?:\\s+(?:of|is|equals|=))?\\s*$`, 'i'),
      '',
    );
    return `${baseRequest} ${key} ${value}`;
  }
  const numberQuestion = context.question.match(
    /^What number should the (radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c) change to\?$/i,
  );
  if (numberQuestion && /^(?:set|change|said)\b/i.test(request)) {
    try {
      const value = geometryReplyValue(answer, numberQuestion[1]);
      evaluateMath(parseMath(value));
      return `set ${numberQuestion[1]} to ${value}`;
    } catch {
      return startsNewRequest(answer) ? null : request;
    }
  }
  const coefficient = request.match(
    /^(?:replace|change) (?:the |this |that |selected )?coefficient(?: (?:of|on|for) [a-z])? (?:with|to) (.+)$/i,
  );
  const variable = answer.match(/^(?:of |for |coefficient of )?([a-z])$/);
  if (
    coefficient &&
    variable &&
    /coefficient/i.test(context.question) &&
    !/;|\bthen\b/i.test(request)
  )
    return `change the coefficient of ${variable[1]} to ${coefficient[1]}`;
  const part = answer.match(
    /^(?:part )(\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/,
  );
  if (
    part &&
    /\b(part|term|coefficient)\b/i.test(context.question) &&
    !/;|\bthen\b/i.test(request)
  ) {
    if (coefficient)
      return `select part ${part[1]}; change selected coefficient to ${coefficient[1]}`;
    const edit = request.match(
      /^(?:replace|change) (?:it|(?:this|that|selected)(?: (?:part|term|number|value|expression))?) (?:with|to) (.+)$/i,
    );
    if (edit) return `replace part ${part[1]} with ${edit[1]}`;
  }
  const n = answer.match(
    /^(?:step )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/,
  );
  if (
    n &&
    /\bstep\b/i.test(context.question) &&
    /^(cancel|remove|delete)\b/i.test(request)
  )
    return `cancel step ${n[1]}`;
  return null;
}
