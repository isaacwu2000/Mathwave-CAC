import {
  formatMath,
  parseMath,
  parseData,
  evaluateMath,
} from '../../math/index.ts';
import { parseGeometry, geometryNumber } from '../../visuals/index.ts';
import { isMathProgramCommand, mathProgramCommand } from './math-program.ts';
import { commandInput, statisticsInput } from './command-input.ts';
import { runCommand } from './run-command.ts';
import { parseMathOperation } from './math-intent.ts';
import { initialWorkspace, type Workspace } from '../../workspace/state.ts';

/**
 * Compiles explicit command input to the executable math language for storage.
 * - Keeps relative operations relative, so later history replay can recalculate them.
 * - Leaves programs intact and rejects input without an equivalent operation.
 * - Resolves canonical input against private values; never changes saved state.
 */
export function commandSource(
  command: string,
  state: Workspace = initialWorkspace,
): string {
  if (isMathProgramCommand(command)) return command;
  const text = commandInput(command, state);
  const quote = JSON.stringify;
  const notation = (value: string) => quote(formatMath(parseMath(value)));
  const save = (value: string) => mathProgramCommand(`problem.save(${value});`);
  const query = (value: string) => mathProgramCommand(`${value};`);
  const current = 'problem.currentEquation()';
  const numeric = (value: string) => {
    const number = evaluateMath(parseMath(value));
    if (!Number.isFinite(number))
      throw new Error('Use a finite numeric argument.');
    return number;
  };
  let match: RegExpMatchArray | null;
  const example = text.match(
    /^(?:(?:open|load|show) )?(?:example )?(equations?|statistics)(?: example)?$/i,
  );
  if (example && /example/i.test(text)) {
    const mode = /^equation/i.test(example[1]) ? 'equation' : 'statistics';
    return save(`problem.example(${quote(mode)})`);
  }
  if (/^(?:clear|clear workspace|new session)$/i.test(text))
    return save('problem.blank()');
  if (/^(?:graph|show graph|graph it|graph the equation)$/i.test(text))
    return save('view.showGraph(graph.current(1))');
  if ((match = text.match(/^(?:write|enter|equation)\s+(.+)$/i)))
    return save(`math.expression(${notation(match[1])})`);
  if (/^simplify$/i.test(text)) return save(`math.simplify(${current})`);
  if (/^swap sides$/i.test(text)) return save(`math.swapSides(${current})`);
  if ((match = text.match(/^replace part (\d+) matching (.+?) with (.+)$/i)))
    return mathProgramCommand(
      `const value = ${current}; problem.save(math.replacePart(value, math.part(value, ${Number(match[1])}, ${notation(match[2])}), ${notation(match[3])}));`,
    );
  if ((match = text.match(/^(?:replace|change) (.+?) (?:with|to) (.+)$/i)))
    return save(
      `math.replace(${current}, ${notation(match[1])}, ${notation(match[2])})`,
    );
  if ((match = text.match(/^(?:graph|plot)\s+(.+)$/i)))
    return save(`graph.plot(${quote(match[1])})`);
  if ((match = text.match(/^add graph\s+(.+)$/i)))
    return save(`graph.add(graph.current(1), ${quote(match[1])})`);
  if ((match = text.match(/^edit graph (\d+) to\s+(.+)$/i)))
    return save(`graph.edit(graph.current(${match[1]}), ${quote(match[2])})`);
  if (
    (match = text.match(
      /^(?:remove|delete|cancel) (?:graph|curve|expression) (\d+)$/i,
    ))
  )
    return save(`graph.remove(graph.current(${match[1]}))`);
  if ((match = text.match(/^view x (\S+) to (\S+) y (\S+) to (\S+)$/i)))
    return save(
      `view.range(graph.current(1), ${match.slice(1).map(numeric).join(', ')})`,
    );
  if ((match = text.match(/^zoom (in|out)$/i)))
    return save(
      `view.zoom(graph.current(1), ${quote(match[1].toLowerCase())})`,
    );
  if ((match = text.match(/^pan(?: graph)? (left|right|up|down)$/i)))
    return save(`view.pan(graph.current(1), ${quote(match[1].toLowerCase())})`);
  for (const [pattern, method] of [
    [/^reset graph$/i, 'reset'],
    [/^(?:fit graph|fit curves|zoom fit)$/i, 'fit'],
    [/^hide graph$/i, 'hideGraph'],
    [/^hide comparison$/i, 'hideComparison'],
    [/^fit comparison$/i, 'fitComparison'],
  ] as const)
    if (pattern.test(text)) return save(`view.${method}(graph.current(1))`);
  if ((match = text.match(/^add (tangent|normal) to graph (\d+) at x (.+)$/i)))
    return save(
      `graph.add${match[1].toLowerCase() === 'tangent' ? 'Tangent' : 'Normal'}(graph.current(${match[2]}), ${numeric(match[3])})`,
    );
  if ((match = text.match(/^add derivative of graph (\d+)$/i)))
    return save(`graph.addDerivative(graph.current(${match[1]}))`);
  if ((match = text.match(/^reflect graph (\d+) across ([xy]) axis$/i)))
    return save(
      `graph.reflect(graph.current(${match[1]}), ${quote(match[2].toLowerCase())})`,
    );
  if ((match = text.match(/^scale graph (\d+) vertically by (.+)$/i)))
    return save(
      `graph.scaleVertically(graph.current(${match[1]}), ${numeric(match[2])})`,
    );
  if ((match = text.match(/^shift graph (\d+) right (.+?) up (.+)$/i)))
    return save(
      `graph.shift(graph.current(${match[1]}), ${numeric(match[2])}, ${numeric(match[3])})`,
    );
  if ((match = text.match(/^add secant to graph (\d+) from (.+?) to (.+)$/i)))
    return save(
      `graph.addSecant(graph.current(${match[1]}), ${numeric(match[2])}, ${numeric(match[3])})`,
    );
  if (
    (match = text.match(/^(evaluate|slope of|trace) graph (\d+) at x (.+)$/i))
  ) {
    const method =
      match[1].toLowerCase() === 'evaluate'
        ? 'value'
        : match[1].toLowerCase() === 'trace'
          ? 'trace'
          : 'slope';
    const call = `graph.${method}(graph.current(${match[2]}), ${numeric(match[3])})`;
    return method === 'trace' ? save(call) : query(call);
  }
  if ((match = text.match(/^find (roots|key points) of graph (\d+)$/i)))
    return query(
      `graph.${match[1].toLowerCase() === 'roots' ? 'roots' : 'keyPoints'}(graph.current(${match[2]}))`,
    );
  if (/^(?:solve|solve step by step|calculate)$/i.test(text))
    return query(`math.solve(${current})`);
  if (/^(?:read|read equation)$/i.test(text)) return query(`problem.read()`);
  if ((match = text.match(/^(next|previous) part$/i)))
    return save(`view.${match[1].toLowerCase()}Part(${current})`);
  if ((match = text.match(/^(?:restore|return to) step (\d+)$/i)))
    return query(`history.restoreStep(${Number(match[1])})`);
  if ((match = text.match(/^(?:undo|cancel) step (\d+)$/i)))
    return query(`history.cancelStep(${Number(match[1])})`);
  if ((match = text.match(/^(undo|redo)(?: (\d+))?$/i)))
    return query(`history.${match[1].toLowerCase()}(${Number(match[2] || 1)})`);
  if (/^(?:help|close help)$/i.test(text))
    return query(`view.${/^close/i.test(text) ? 'close' : 'open'}("help")`);
  if ((match = text.match(/^(?:data set|set data|dataset|data)\s+(.+)$/i)))
    return save(`statistics.data(${quote(parseData(match[1]))})`);
  const metric = statisticsInput(text);
  if (metric?.data) return save(`statistics.data(${quote(metric.data)})`);
  if ((match = text.match(/^scale shape by (.+)$/i)))
    return save(
      `geometry.scale(geometry.current(), ${geometryNumber(match[1], 'Invalid scale factor.')})`,
    );
  if (
    (match = text.match(
      /^(?:set|change|said)(?: the)? (radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c|leg a|leg b)(?: to| =)? (.+)$/i,
    ))
  ) {
    const updates = `${match[1]} to ${match[2]}`.split(
      /\s*(?:,|;|\band\b)\s*(?=(?:(?:set|change)\s+)?(?:the\s+)?(?:radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c|leg a|leg b)\s+(?:to|=)\s*)/i,
    );
    const dimensions = updates.map((update) => {
      const part = update.match(
        /^(?:(?:set|change)\s+)?(?:the\s+)?(.+?)\s+(?:to|=)\s*(.+)$/i,
      );
      if (!part) throw new Error('Name each dimension and its value.');
      return `${part[1].toLowerCase().replace('leg ', '')}: ${geometryNumber(part[2], 'Invalid dimension.')}`;
    });
    return save(
      `geometry.setDimensions(geometry.current(), {${dimensions.join(', ')}})`,
    );
  }
  const inlineGeometry = text.match(
    /^(?:(?:find|calculate|show|read)(?: me)? (?:the )?|what is (?:the )?)?(area|perimeter|circumference|diameter|space diagonal|diagonal|hypotenuse|volume|surface area|slant height) of (?:a |the )?(.+)$/i,
  );
  const geometry = parseGeometry(inlineGeometry?.[2] ?? text);
  if (geometry) {
    return save(
      `geometry.create(${quote(geometry.shape)}, {${Object.entries(
        geometry.dimensions,
      )
        .map(([name, value]) => `${name}: ${value}`)
        .join(', ')}})`,
    );
  }
  const operation = parseMathOperation(text);
  if (operation?.kind === 'swap') return save(`math.swapSides(${current})`);
  if (operation?.kind === 'arithmetic') {
    const method = {
      '+': 'add',
      '-': 'subtract',
      '*': 'multiply',
      '/': 'divide',
    }[operation.operator];
    return save(
      `math.${method}BothSides(${current}, ${quote(operation.operand)})`,
    );
  }
  const canonical = runCommand(state, command).storedCommand;
  if (canonical && canonical !== command)
    return commandSource(canonical, state);
  try {
    const equation =
      /^right\s+.+(?:=|\bequals?\b).+$/i.test(text) &&
      !/^right\s+(?:side|angle|triangle)\b/i.test(text)
        ? text.replace(/^right\s+/i, '')
        : text;
    return save(`math.expression(${notation(equation)})`);
  } catch {
    throw new Error('This command has no executable math program.');
  }
}
