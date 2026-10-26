import { parseData } from '../../math/index.ts';
import type { Workspace } from '../../workspace/state.ts';
import { normalizeGraphReferences } from './graph-command.ts';

/** Normalizes explicit command phrasing without changing mathematical notation. */
export function commandInput(raw: string, _original: Workspace): string {
  return normalizeGraphReferences(
    raw
      .trim()
      .replace(/[.?]+$/, '')
      .replace(/^(?:could|can|would|will) you\s+(?:please\s+)?/i, '')
      .replace(/^please\s+/i, '')
      .replace(/(?:,?\s+please)$/i, '')
      .trim()
      .replace(
        /^which (?:observations|values|points) (?:look|are|seem) (?:unusually|extremely) (?:far (?:away|apart)|distant)$/i,
        'find outliers',
      )
      .replace(
        /^(?:find|show|inspect|identify) (?:my |the |these )?(?:unusual|outlying|suspicious) (?:observations|values|points|measurements)$/i,
        'find outliers',
      )
      .replace(
        /^(?:(?:find|explain|show|show me)(?: the)? )?out[ -]+li(?:ar|er)s[.?]*$/i,
        'find outliers',
      ),
  );
}

/** Parses a named statistic and optional explicit data using the same rules for execution and saved programs. */
export function statisticsInput(
  input: string,
): { name: string; data?: number[]; source?: string } | null {
  const match = input.match(
    /^(?:(?:what is|what's|find|calculate|show|tell me|read|explain)\s+)?(?:the\s+)?(median|mean|average|mode|range|sum|count|minimum|maximum|sample variance|population variance|sample standard deviation|population standard deviation|standard deviation|variance)(?:\s+(?:of|for)\s+(.+))?$/i,
  );
  if (!match) return null;
  const inline =
    match[2] &&
    !/^(?:the |my |these )?(?:data|data set|numbers|values)$/i.test(match[2]);
  return {
    name: match[1].toLowerCase(),
    source: match[2],
    data: inline
      ? parseData(match[2].replace(/,?\s+and\s+/g, ', '))
      : undefined,
  };
}
