import { compileGraphScene } from '../../visuals/index.ts';
import {
  needsGraphScene,
  equationWorkspace,
  currentGraphScene,
  graphSceneState,
  graphSceneMessage,
} from './graph-scene.ts';
import {
  describeData,
  displayNumber,
  isSimplificationCommand,
  parseData,
  simplifyMath,
  statistics,
} from '../../math/index.ts';
import {
  describeConstruction,
  classifyTriangle,
  curvePoints,
  defaultGraphRange,
  describeGeometry,
  describeGraph,
  dimensionsFor,
  fitGraphComparison,
  fitGraphY,
  geometryMeasures,
  geometryNumber,
  graphAreaBetween,
  graphAverageRate,
  graphDerivative,
  graphFunction,
  graphIntegral,
  graphIntersections,
  graphKeyPoints,
  graphNormal,
  graphRoots,
  graphSecant,
  graphTangent,
  graphValueTable,
  includeGraphValue,
  measureGeometry,
  parseGeometry,
  scaleGeometry,
  shiftGraph,
  shiftGraphRange,
  transformGraph,
  validateGeometry,
  validateGraphRange,
  validateGraphTrace,
  validateTriangleOverlay,
} from '../../visuals/index.ts';
import {
  describeWorkspace,
  initialWorkspace,
  partsFor,
  type Mode,
  type Workspace,
} from '../../workspace/state.ts';
import type { CommandResult } from '../types/run-command.ts';
import { commandInput, statisticsInput } from './command-input.ts';
import {
  isMathProgramCommand,
  MATH_PROGRAM_PREFIX,
  runMathProgram,
} from './math-program.ts';
export type { CommandResult } from '../types/run-command.ts';

import {
  ClarificationError,
  evaluateMath,
  formatMath,
  getParts,
  parseMath,
  replaceMath,
  replacePartMath,
  solveMath,
  speakMath,
} from '../../math/index.ts';
import { contextualReplacement } from './math-context.ts';
import { interpretOperation } from './math-intent.ts';
export function runCommand(original: Workspace, raw: string): CommandResult {
  if (isMathProgramCommand(raw)) {
    const result = runMathProgram(
      original,
      raw.slice(MATH_PROGRAM_PREFIX.length),
    );
    if (result.control)
      throw new Error(
        'Submit standalone controls through a validated program response.',
      );
    return result;
  }
  // Graph controls target the retained drawing, then restore the independent equation.
  if (
    original.retainedGraph &&
    /\b(?:graph|curve)s?\b|^plot\b|^pan\b|^zoom\b|^find roots$|^(?:find|show|read) (?:the )?(?:x[ -])?intercepts/i.test(
      raw.trim(),
    )
  ) {
    const drawing = graphSceneState(original, original.retainedGraph);
    const result = runCommand(drawing, raw);
    if (!result.changed && !result.written)
      return { ...result, state: original };
    const state = {
      ...result.state,
      expression: original.expression,
      retainedGraph: currentGraphScene(result.state),
    };
    delete state.graphScene;
    delete state.graphExpressions;
    return { ...result, state };
  }
  const createScene = /^(?:graph|plot)\s+([\s\S]+)$/i.exec(raw.trim());
  const addScene = /^add graph\s+([\s\S]+)$/i.exec(raw.trim());
  const editScene = /^edit graph (\d+) to\s+([\s\S]+)$/i.exec(raw.trim());
  const removeScene = /^remove graph (\d+)$/i.exec(raw.trim());
  if (createScene && needsGraphScene(createScene[1])) {
    const graphScene = { rows: [{ expression: createScene[1] }] };
    return {
      state: graphSceneState(original, graphScene),
      message: graphSceneMessage(graphScene),
      changed: true,
      written: true,
    };
  }
  if (
    (addScene && (original.graphScene || needsGraphScene(addScene[1]))) ||
    ((original.graphScene || (editScene && needsGraphScene(editScene[2]))) &&
      (editScene || removeScene))
  ) {
    const previous = currentGraphScene(original),
      rows = previous.rows.map((row) => ({ ...row }));
    if (addScene) rows.push({ expression: addScene[1] });
    else {
      const index = Number((editScene || removeScene)![1]) - 1;
      if (!rows[index]) throw new Error('That graph row does not exist.');
      if (editScene) rows[index].expression = editScene[2];
      else rows.splice(index, 1);
    }
    const graphScene = { rows };
    return {
      state: graphSceneState(original, graphScene),
      message: graphSceneMessage(graphScene),
      changed: true,
      written: true,
    };
  }
  if (
    original.graphScene &&
    /^(?:describe graph|explain graph|read graph)$/i.test(raw.trim())
  )
    return { state: original, message: graphSceneMessage(original.graphScene) };
  if (original.graphScene) {
    const evaluated = /^evaluate graph (\d+) at x (.+)$/i.exec(raw.trim());
    if (evaluated) {
      const row = Number(evaluated[1]) - 1,
        compiled = compileGraphScene(original.graphScene);
      if (
        !compiled.rows[row] ||
        !['explicit', 'function'].includes(compiled.rows[row].kind) ||
        compiled.rows[row].args?.length === 2
      )
        throw new Error(
          'Use a parameter point query or specify both coordinates for this relation.',
        );
      const x = evaluateMath(parseMath(evaluated[2])),
        value = compiled.sample(row, x);
      return {
        state: original,
        message: `Graph row ${row + 1}, x = ${x}, ${value === null ? 'undefined' : `y = ${value}`}.`,
      };
    }
    if (
      /^(?:trace |play graph|hear graph|add (?:tangent|normal|derivative|secant)|shift graph|reflect graph|scale graph|(?:(?:find|show|read) )?(?:the )?(?:roots|intersections|key points|x[ -]intercepts)|derivative |normal |slope |integral |total area |area between |average rate |table|fit graph|fit curves|zoom fit|solve$|calculate$)/i.test(
        raw.trim(),
      )
    )
      throw new Error(
        'That analysis tool currently supports legacy explicit functions. This graph remains unchanged; you can read points or check a point against a relation.',
      );
  }
  const input = commandInput(raw, original);
  const command = input.toLowerCase().trim();
  if (
    /^(?:(?:open|load|show|make|create|read|describe) (?:a |an |the )?)?(?:example )?(?:diagrams?|flowcharts?|flow)(?:\b|$)/i.test(
      command,
    )
  )
    throw new Error(
      'The flowchart feature has been removed. Ask for an equation, graph or geometric drawing.',
    );
  if (!command) throw new Error('Speak or type an equation or command.');
  if (
    /^make (?:it|(?:this|that|my|the)(?: (?:equation|expression|work|problem))?) better$/i.test(
      command,
    )
  )
    throw new ClarificationError(
      'What would you like to change? Name the term to replace or the operation to apply.',
    );
  if (
    /^(?:fix|correct)\s+(?:(?:the|my|this|that)\s+)?(?:mistake|error|equation|expression|number|work|whichever number is wrong)(?:\s+in (?:my|the|this) (?:equation|expression|work))?$/i.test(
      command,
    )
  )
    throw new ClarificationError(
      'Which term is wrong, and what should replace it? Say replace, the exact term, and its new value.',
    );
  if (
    /^(?:replace|change)\b/i.test(command) &&
    !/^(?:replace|change)\s+.+?\s+(?:with|to)\s+.+$/i.test(command)
  )
    throw new ClarificationError(
      'Which term should change, and what is its new value? Say replace, the exact term, and its new value.',
    );
  const currentEquationNode = () => {
    if (original.graphScene)
      throw new Error(
        'Use graph rows for this collection; open an equation before applying equation operations.',
      );
    return parseMath(original.expression);
  };
  const contextualEdit = contextualReplacement(original, input);
  if (contextualEdit) {
    if (original.mode !== 'equation')
      throw new ClarificationError(
        'Open an equation before replacing a math part.',
      );
    const node = currentEquationNode(),
      part = getParts(node)[contextualEdit.part - 1];
    if (!part)
      throw new ClarificationError(
        'That part does not exist. Select a saved math part.',
      );
    if (
      contextualEdit.expected !== undefined &&
      formatMath(parseMath(contextualEdit.expected)) !== formatMath(part.node)
    )
      throw new ClarificationError(
        'That part changed. Select it again; your work is unchanged.',
      );
    const replacement = parseMath(contextualEdit.replacement);
    const next = replacePartMath(
      node,
      contextualEdit.part,
      contextualEdit.replacement,
    );
    return {
      state: { ...original, expression: formatMath(next), selection: 0 },
      changed: true,
      written: true,
      storedCommand: `replace part ${contextualEdit.part} matching ${formatMath(part.node)} with ${formatMath(replacement)}`,
      message: `Changed part ${contextualEdit.part}. Your equation is now ${speakMath(next)}. Say undo to go back.`,
    };
  }
  const vagueReplacement = input.match(
    /^(?:replace|change)\s+(it|(?:this|that)(?: (?:term|number|value|expression))?|the (?:term|number|value|expression))\s+(?:with|to)\s+(.+)$/i,
  );
  if (vagueReplacement)
    throw new ClarificationError(
      original.mode === 'statistics'
        ? 'Which data value should change? Say data followed by the complete updated list.'
        : 'Which term should I replace? Say replace, the exact term, and its new value.',
    );
  const result = (
    message: string,
    state = original,
    changed = false,
    written = false,
  ): CommandResult => {
    if (original.graphScene && state.expression !== original.expression) {
      state = { ...state };
      delete state.graphScene;
    }
    return { state, message, changed, written };
  };
  const action = (a: CommandResult['action'], message = ''): CommandResult => ({
    state: original,
    message,
    action: a,
  });
  if (/^(read response|repeat|repeat that)$/.test(command))
    return action('repeat');
  if (/^(undo|undo that|go back)$/.test(command)) return action('undo');
  if (
    /^(help|voice guide|show (help|voice guide)|what can i say)$/.test(command)
  )
    return action('help', 'Voice guide opened. Say close help to return.');
  if (/^(close (help|voice guide)|close)$/.test(command))
    return action('close-help', 'Voice guide closed.');
  if (/^(stop|stop audio|stop speaking|silence)$/.test(command))
    return action('stop', 'Audio stopped.');
  if (/^(stop listening|microphone off)$/.test(command))
    return action('listen-stop', 'Microphone off.');
  if (
    /^(mute|turn (off|responses off)|turn off (spoken responses|responses|read responses aloud))$/.test(
      command,
    )
  )
    return action('mute', 'Spoken responses off.');
  if (
    /^(unmute|turn (on|responses on)|turn on (spoken responses|responses|read responses aloud))$/.test(
      command,
    )
  )
    return action('unmute', 'Spoken responses on.');
  if (/^(slower|speak slower)$/.test(command))
    return action('slower', 'Speech slowed down.');
  if (/^(faster|speak faster)$/.test(command))
    return action('faster', 'Speech sped up.');
  if (/^(type|focus input|edit input)$/.test(command))
    return action('focus', 'Command input focused.');
  if (/^(new session|clear|clear workspace)$/.test(command))
    return result(
      'New session. Say an equation or data followed by numbers. You can undo this.',
      {
        ...initialWorkspace,
        expression: '0',
        data: [0, 0],
      },
      true,
    );
  const shapeBase = () => {
    const state = { ...original };
    delete state.construction;
    return state;
  };
  const inlineGeometry = input.match(
    /^(?:(?:find|calculate|show|read)(?: me)? (?:the )?|what is (?:the )?)?(area|perimeter|circumference|diameter|space diagonal|diagonal|hypotenuse|volume|surface area|slant height) of (?:a |the )?(.+)$/i,
  );
  if (inlineGeometry) {
    const geometry = parseGeometry(inlineGeometry[2]);
    if (!geometry)
      throw new Error('Describe a supported shape and its dimensions.');
    const message = measureGeometry(geometry, inlineGeometry[1].toLowerCase());
    return result(
      message,
      {
        ...shapeBase(),
        mode: 'geometry',
        geometry,
        graph: false,
        selection: 0,
      },
      true,
      true,
    );
  }
  const geometry = parseGeometry(input);
  if (geometry)
    return result(
      describeGeometry(geometry) +
        (geometry.shape === 'right triangle' && /\bhypotenuse\b/i.test(input)
          ? ` Derived leg b: ${displayNumber(geometry.dimensions.b)} units. Pythagorean theorem: square root of hypotenuse squared minus known leg squared.`
          : ''),
      {
        ...shapeBase(),
        mode: 'geometry',
        geometry,
        graph: false,
        selection: 0,
      },
      true,
      true,
    );
  if (
    /^(?:read|describe)(?: the)? (?:shape|geometry|construction)$/.test(command)
  ) {
    if (original.construction)
      return result(
        describeConstruction(original.construction),
        { ...original, mode: 'geometry' },
        original.mode !== 'geometry',
      );
    if (!original.geometry)
      throw new Error('Create a shape first, for example circle radius five.');
    return result(
      describeGeometry(original.geometry),
      { ...original, mode: 'geometry' },
      original.mode !== 'geometry',
    );
  }
  if (command === 'hide construction') {
    if (original.mode !== 'geometry')
      throw new Error('Open a geometry diagram first.');
    return result(
      'Construction hidden. Your shape and work are unchanged.',
      { ...original, geometryOverlay: undefined },
      true,
    );
  }
  if (command === 'hide comparison')
    return result(
      'Comparison markers hidden. Saved graph expressions are unchanged.',
      { ...original, graphComparison: undefined },
      true,
    );
  if (command === 'fit comparison') {
    const comparison = original.graphComparison;
    if (
      !comparison ||
      ![original.expression, ...(original.graphExpressions || [])].includes(
        comparison.expression,
      )
    )
      throw new Error('Compare two points on a current graph first.');
    const view = fitGraphComparison(comparison);
    return result(
      'View fitted to both comparison endpoints.',
      {
        ...original,
        mode: 'equation',
        graph: true,
        graphRange: view.x,
        graphYRange: view.y,
      },
      true,
    );
  }
  if (original.mode === 'geometry' && original.geometry) {
    if (/^(?:(?:show|find|read) (?:the )?)?centroid$/.test(command)) {
      const g = original.geometry;
      if (
        !['triangle', 'right triangle'].includes(g.shape) ||
        'base' in g.dimensions
      )
        throw new ClarificationError(
          'Give three triangle side lengths or two right-triangle legs to locate the centroid.',
        );
      return result(
        'The centroid is where the three medians meet. It lies two thirds of the way from each vertex to the midpoint of the opposite side.',
        { ...original, geometryOverlay: 'centroid' },
        true,
      );
    }

    if (
      /^(?:classify(?: the| this)? triangle|triangle type|what (?:kind|type) of triangle is (?:this|it))$/.test(
        command,
      )
    )
      return result(classifyTriangle(original.geometry));
    const scaling = input.match(
      /^(?:scale|resize) (?:the |this |my )?(?:shape|geometry)(?: by(?: a factor of)?| to)? (.+)$/i,
    );
    const simpleScale = /^(?:double|halve) (?:the |this |my )?shape$/i.test(
      input,
    );
    if (scaling || simpleScale) {
      const factor = simpleScale
        ? /^double/i.test(input)
          ? 2
          : 0.5
        : geometryNumber(scaling![1], 'What scale factor should I use?');
      const geometry = scaleGeometry(original.geometry, factor);
      const measures = geometryMeasures(geometry);
      const changes = [`Lengths multiply by ${displayNumber(factor)}.`];
      if (measures.area || measures['surface area'])
        changes.push(`Areas multiply by ${displayNumber(factor * factor)}.`);
      if (measures.volume)
        changes.push(`Volumes multiply by ${displayNumber(factor ** 3)}.`);
      return {
        ...result(
          `${describeGeometry(geometry)} ${changes.join(' ')} Say undo to restore.`,
          { ...original, geometry, selection: 0 },
          true,
          true,
        ),
        storedCommand: `scale shape by ${factor}`,
      };
    }
    const edit = input.match(
      /^(?:set|change|said)(?: the)? (radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c|leg a|leg b)(?: to| =)? (.+)$/i,
    );
    if (edit) {
      // Split only explicitly labeled edits, keeping spoken numbers such as
      // "one hundred and twenty" and mathematical operands intact.
      const parts = `${edit[1]} to ${edit[2]}`.split(
        /\s*(?:,|;|\band\b)\s*(?=(?:(?:set|change)\s+)?(?:the\s+)?(?:radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c|leg a|leg b)\s+(?:to|=)\s*)/i,
      );
      const dimensions = { ...original.geometry.dimensions };
      const seen = new Set<string>();
      for (const part of parts) {
        const update = part.match(
          /^(?:(?:set|change)\s+)?(?:the\s+)?(radius|outer|inner|length|width|height|base|angle|sides|side|a|b|c|leg a|leg b)\s+(?:to|=)\s*(.+)$/i,
        );
        if (!update) throw new Error('Name each dimension and its new value.');
        const key = update[1].toLowerCase().replace('leg ', '');
        if (!dimensionsFor(original.geometry).includes(key))
          throw new Error(
            `This ${original.geometry.shape} has no ${key} dimension.`,
          );
        if (seen.has(key))
          throw new ClarificationError(
            `What number should the ${key} change to?`,
          );
        seen.add(key);
        dimensions[key] = geometryNumber(
          update[2],
          `What number should the ${key} change to?`,
        );
      }
      const geometry = validateGeometry({
        ...original.geometry,
        dimensions,
      });
      return result(
        describeGeometry(geometry),
        { ...original, geometry },
        true,
        true,
      );
    }
    const geometryCommand = command
      .replace(
        /^(find|calculate|read|show) (?:its|their|this shape's|the shape's) /,
        '$1 ',
      )
      .replace(
        /^(?:(?:find|calculate|read|show) (?:the )?)?high potter news$/,
        'hypotenuse',
      )
      .replace(/^(?:(?:find|calculate|read|show) )?angles? see$/, 'angle c');
    const measure = geometryCommand.match(
      /^(?:(?:find|calculate|read|show|what is) (?:the )?)?(area|perimeter|circumference|diameter|space diagonal|diagonal|hypotenuse|volume|surface area|slant height|thickness|arc length|chord length|segment area|apothem|interior angle|exterior angle|inradius|circumradius|altitude [abc]|median [abc]|angle [abc])$/,
    );
    if (measure) {
      const message = measureGeometry(original.geometry, measure[1]);
      if (
        /^(inradius|circumradius|altitude [abc]|median [abc])$/.test(measure[1])
      ) {
        validateTriangleOverlay(measure[1]);
        return result(
          message,
          { ...original, geometryOverlay: measure[1] },
          true,
        );
      }
      return result(message);
    }
  }
  const example = command.match(
    /^(?:open |load |show )?(?:example )?(equation|equations|statistics)(?: example)?$/,
  );
  if (example) {
    const mode: Mode = example[1].startsWith('equation')
      ? 'equation'
      : example[1] === 'statistics'
        ? 'statistics'
        : 'statistics';
    const next = {
      ...(/example/.test(command) ? initialWorkspace : original),
      mode,
      selection: 0,
    };
    return result(
      `${mode === 'equation' ? 'Equation' : mode === 'statistics' ? 'Statistics' : 'Diagram'} workspace. ${describeWorkspace(next)}`,
      next,
      true,
    );
  }
  const namedRead = command.match(
    /^(?:read|describe)(?: the)? (equation|data)$/,
  );
  if (namedRead) {
    const mode: Mode =
      namedRead[1] === 'equation'
        ? 'equation'
        : namedRead[1] === 'data'
          ? 'statistics'
          : 'statistics';
    const next = {
      ...original,
      mode,
      selection: mode === original.mode ? original.selection : 0,
    };
    return result(describeWorkspace(next), next, mode !== original.mode);
  }
  if (/^(read|read all|describe|summary|summarize)$/.test(command))
    return result(describeWorkspace(original));
  if (
    /^(solve|solve (it|the equation)|solve step by step|calculate)$/.test(
      command,
    )
  ) {
    if (original.mode !== 'equation')
      throw new Error(
        'Switch to equations to solve, or say describe for this workspace.',
      );
    const parsed = currentEquationNode();
    return result(
      parsed.kind === 'equation'
        ? solveMath(parsed)
        : `Result: ${displayNumber(evaluateMath(parsed))}. Expression: ${speakMath(parsed)}.`,
    );
  }
  const curves = [original.expression, ...(original.graphExpressions || [])];
  const betweenRequest = input.match(
    /^area between graphs (\d+) and (\d+) from (.+?) to (.+)$/i,
  );
  if (betweenRequest) {
    if (original.mode !== 'equation')
      throw new Error('Open two graphs before comparing their area.');
    const first = Number(betweenRequest[1]),
      second = Number(betweenRequest[2]);
    if (!curves[first - 1] || !curves[second - 1])
      throw new Error('That graph expression does not exist.');
    if (first === second)
      throw new Error('Choose two different graph expressions.');
    const start = evaluateMath(parseMath(betweenRequest[3])),
      end = evaluateMath(parseMath(betweenRequest[4]));
    const value = graphAreaBetween(
      curves[first - 1],
      curves[second - 1],
      start,
      end,
    );
    return result(
      `Total area between graphs ${first} and ${second} from ${displayNumber(start)} to ${displayNumber(end)}: ${displayNumber(value)}. The absolute vertical difference is integrated, splitting at crossings. Analytic integration of linear or quadratic curves.`,
    );
  }
  const integralRequest = input.match(
    /^(integral|total area) graph (\d+) from (.+?) to (.+)$/i,
  );
  if (integralRequest) {
    if (original.mode !== 'equation')
      throw new Error('Open a graph before integrating.');
    const number = Number(integralRequest[2]),
      expression = curves[number - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const start = evaluateMath(parseMath(integralRequest[3])),
      end = evaluateMath(parseMath(integralRequest[4]));
    const area = /^total/i.test(integralRequest[1]);
    const value = graphIntegral(expression, start, end, area);
    return result(
      `Graph ${number}. ${area ? 'Total geometric area' : 'Signed definite integral'} from ${displayNumber(start)} to ${displayNumber(end)}: ${displayNumber(value)}. ${area ? 'Areas below the x axis count positively.' : 'Values below the x axis contribute negatively; reversing bounds reverses the sign.'} Analytic integration of a linear or quadratic function.`,
    );
  }
  const reflection = input.match(
    /^reflect graph (\d+) across (?:the )?([xy])(?:[ -]axis| axis)$/i,
  );
  const verticalScale = input.match(/^scale graph (\d+) vertically by (.+)$/i);
  if (reflection || verticalScale) {
    if (original.mode !== 'equation')
      throw new Error('Open a graph before transforming it.');
    const number = Number((reflection || verticalScale)![1]),
      expression = curves[number - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const factor = verticalScale
      ? evaluateMath(parseMath(verticalScale[2]))
      : 1;
    if (factor <= 0)
      throw new Error(
        'Use a positive vertical scale factor. Use reflect graph for a reflection.',
      );
    const changed = transformGraph(
      expression,
      reflection?.[2].toLowerCase() === 'y' ? -1 : 1,
      reflection?.[2].toLowerCase() === 'x' ? -1 : factor,
    );
    return {
      ...runCommand(original, `edit graph ${number} to ${changed}`),
      message: `Graph ${number}: ${changed}. ${reflection ? `Reflected across the ${reflection[2].toLowerCase()} axis.` : `Y values multiply by ${displayNumber(factor)}; x values stay the same.`} Say undo to restore.`,
      storedCommand: reflection
        ? `reflect graph ${number} across ${reflection[2].toLowerCase()} axis`
        : `scale graph ${number} vertically by ${factor}`,
    };
  }
  const derivativeRequest = input.match(
    /^(add derivative of|derivative of) graph (\d+)$/i,
  );
  if (derivativeRequest) {
    if (original.mode !== 'equation')
      throw new Error('Open a graph before exploring derivatives.');
    const number = Number(derivativeRequest[2]),
      expression = curves[number - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const equation = graphDerivative(expression);
    const message = `Derivative of graph ${number}: ${equation}. Its y value gives the original curve’s tangent slope at each x. Analytic derivative of a linear or quadratic function.`;
    if (derivativeRequest[1].toLowerCase() === 'derivative of')
      return result(message);
    const added = runCommand(original, `add graph ${equation}`);
    return {
      ...added,
      message: `${message} Added derivative curve. Say undo to remove it.`,
      storedCommand: `add derivative of graph ${number}`,
    };
  }
  const normalRequest = input.match(
    /^(add normal to|normal of) graph (\d+) at x (.+)$/i,
  );
  if (normalRequest) {
    if (original.mode !== 'equation')
      throw new Error('Open a graph before exploring normals.');
    const number = Number(normalRequest[2]),
      expression = curves[number - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const normal = graphNormal(
      expression,
      evaluateMath(parseMath(normalRequest[3])),
    );
    const message = `Graph ${number} at (${displayNumber(normal.x)}, ${displayNumber(normal.y)}). Normal line: ${normal.equation}. ${normal.vertical ? 'The tangent is horizontal, so the normal is vertical.' : `Normal slope: ${displayNumber(normal.slope!)}; negative reciprocal of the tangent slope.`}`;
    if (/^normal of/i.test(normalRequest[1])) return result(message);
    if (normal.vertical)
      throw new Error(
        `${message} Vertical lines cannot currently be added as function curves.`,
      );
    const added = runCommand(original, `add graph ${normal.equation}`);
    return {
      ...added,
      message: `${message} Added normal. Say undo to remove it.`,
      storedCommand: `add normal to graph ${number} at x ${normal.x}`,
    };
  }
  const tangentRequest = input.match(
    /^(add tangent to|slope of) graph (\d+) at x (.+)$/i,
  );
  if (tangentRequest) {
    if (original.mode !== 'equation')
      throw new Error('Open a graph before exploring tangents.');
    const number = Number(tangentRequest[2]),
      expression = curves[number - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const tangent = graphTangent(
      expression,
      evaluateMath(parseMath(tangentRequest[3])),
    );
    const message = `Graph ${number} at (${displayNumber(tangent.x)}, ${displayNumber(tangent.y)}). Tangent slope: ${displayNumber(tangent.slope)}. Analytic derivative of a linear or quadratic function.`;
    if (/^slope/i.test(tangentRequest[1])) return result(message);
    const added = runCommand(original, `add graph ${tangent.equation}`);
    return {
      ...added,
      message: `${message} Added tangent: ${tangent.equation}. Say undo to remove it.`,
      storedCommand: `add tangent to graph ${number} at x ${tangent.x}`,
    };
  }
  const shift = input.match(
    /^shift graph (\d+) (right|left) (.+?) (up|down) (.+)$/i,
  );
  if (shift) {
    if (original.mode !== 'equation')
      throw new Error('Open a graph before shifting it.');
    const number = Number(shift[1]);
    if (!curves[number - 1])
      throw new Error('That graph expression does not exist.');
    const right =
      evaluateMath(parseMath(shift[3])) *
      (shift[2].toLowerCase() === 'left' ? -1 : 1);
    const up =
      evaluateMath(parseMath(shift[5])) *
      (shift[4].toLowerCase() === 'down' ? -1 : 1);
    const expression = shiftGraph(curves[number - 1], right, up);
    const shifted = runCommand(
      original,
      `edit graph ${number} to ${expression}`,
    );
    return {
      ...shifted,
      message: `Graph ${number} shifted ${displayNumber(right)} units right and ${displayNumber(up)} units up. ${expression}. Say undo to restore.`,
      storedCommand: `shift graph ${number} right ${right} up ${up}`,
    };
  }
  const extraPlot = input.match(
    /^(?:add|overlay)(?: another)? (?:graph|curve|expression) (.+)$/i,
  );
  const editPlot = input.match(
    /^(?:edit|change) (?:graph|curve|expression) (\d+) (?:to|with) (.+)$/i,
  );
  const removePlot = input.match(
    /^(?:remove|delete|cancel) (?:graph|curve|expression) (\d+)$/i,
  );
  if (extraPlot || editPlot || removePlot) {
    if (original.mode !== 'equation' || !original.graph)
      throw new Error('Graph an equation first.');
    const index = Number((editPlot || removePlot)?.[1]) - 1;
    if (
      (editPlot || removePlot) &&
      (!Number.isInteger(index) || index < 0 || index >= curves.length)
    )
      throw new Error('That graph expression does not exist.');
    if (extraPlot && curves.length >= 8)
      throw new Error('Use up to eight graph expressions.');
    if (removePlot && curves.length === 1)
      throw new Error('Keep one graph expression, or say hide graph.');
    if (removePlot) curves.splice(index, 1);
    else {
      const expression = formatMath(
        parseMath(extraPlot ? extraPlot[1] : editPlot![2]),
      );
      graphFunction(expression);
      if (extraPlot) curves.push(expression);
      else curves[index] = expression;
    }
    return result(
      `${curves.length} graph expression${curves.length === 1 ? '' : 's'}. Say undo to restore.`,
      {
        ...original,
        expression: curves[0],
        graphExpressions: curves.slice(1),
        selection: 0,
      },
      true,
      true,
    );
  }
  const intersectionRequest = command.match(
    /^(?:find|show|read)(?: the)? intersections(?: (?:of|between)(?: graphs?| curves?)? (\d+) (?:and|with|&) (?:graph |curve )?(\d+))?$/,
  );
  if (intersectionRequest) {
    if (curves.length < 2)
      throw new Error('Add a second graph expression first.');
    const first = Number(intersectionRequest[1] || 1);
    const second = Number(intersectionRequest[2] || 2);
    if (
      first < 1 ||
      second < 1 ||
      first > curves.length ||
      second > curves.length
    )
      throw new Error('That graph expression does not exist.');
    if (first === second)
      throw new Error('Choose two different graph expressions.');
    const intersections = graphIntersections(
      curves[first - 1],
      curves[second - 1],
      original.graphRange,
    );
    return result(
      intersections.length
        ? `Approximate intersections of graphs ${first} and ${second}: ${intersections.map((p) => `(${displayNumber(p.x)}, ${displayNumber(p.y)})`).join('; ')}. Sampling may miss intersections.`
        : 'No intersections found by sampling in this x range.',
    );
  }
  if (
    /^(?:fit (?:the )?(?:graph|curves|all curves)|zoom (?:to )?fit)$/.test(
      command,
    )
  ) {
    const graphYRange = fitGraphY(curves, original.graphRange);
    return result(
      `Fitted sampled curves vertically from ${displayNumber(graphYRange.min)} to ${displayNumber(graphYRange.max)}.`,
      { ...original, graph: true, mode: 'equation', graphYRange },
      true,
    );
  }

  const secantRequest = input.match(
    /^add secant to graph (\d+) from (.+?) to (.+)$/i,
  );
  if (secantRequest) {
    if (original.mode !== 'equation')
      throw new Error('Open a graph before adding a secant.');
    const number = Number(secantRequest[1]),
      expression = curves[number - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const secant = graphSecant(
      expression,
      evaluateMath(parseMath(secantRequest[2])),
      evaluateMath(parseMath(secantRequest[3])),
    );
    const added = runCommand(original, `add graph ${secant.equation}`);
    return {
      ...added,
      state: {
        ...added.state,
        graphComparison: {
          expression,
          start: secant.start.x,
          end: secant.end.x,
        },
      },
      message: `Added secant through (${displayNumber(secant.start.x)}, ${displayNumber(secant.start.y)}) and (${displayNumber(secant.end.x)}, ${displayNumber(secant.end.y)}). Average rate of change: ${displayNumber(secant.rate)}. This line connects the two endpoints; it does not assert continuity between them. Say undo to remove it.`,
      storedCommand: `add secant to graph ${number} from ${secant.start.x} to ${secant.end.x}`,
    };
  }
  const rateRequest = input.match(
    /^(?:find |read |calculate )?(?:the )?average rate of change(?: of graph (\d+))? from (.+?) to (.+)$/i,
  );
  if (rateRequest) {
    if (original.mode !== 'equation')
      throw new Error('Open a graph before comparing its values.');
    const number = Number(rateRequest[1] || 1),
      expression = curves[number - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const rate = graphAverageRate(
      expression,
      evaluateMath(parseMath(rateRequest[2])),
      evaluateMath(parseMath(rateRequest[3])),
    );
    return result(
      `Graph ${number}. Average rate of change: ${displayNumber(rate.rate)}. From (${displayNumber(rate.start.x)}, ${displayNumber(rate.start.y)}) to (${displayNumber(rate.end.x)}, ${displayNumber(rate.end.y)}). Formula: change in y divided by change in x. This is a secant slope between two endpoints, not a derivative or a claim of continuity between them.`,
      {
        ...original,
        graph: true,
        graphComparison: { expression, start: rate.start.x, end: rate.end.x },
      },
      true,
    );
  }
  const tableRequest = command.match(
    /^(?:read |show )?(?:value )?table(?: (?:of |for )?graph (\d+))?$/,
  );
  if (tableRequest) {
    if (original.mode !== 'equation')
      throw new Error('Open a graph before reading its value table.');
    const number = Number(tableRequest[1] || 1);
    const expression = curves[number - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const table = graphValueTable(expression, original.graphRange);
    return result(
      `Graph ${number} value table. ${table.map((p) => `x ${displayNumber(p.x)}: ${p.y === null ? 'undefined' : 'y ' + displayNumber(p.y)}`).join('; ')}. Five evaluated locations, not a complete domain or range.`,
    );
  }
  const keyPointRequest = command.match(
    /^(?:find|read|show)(?: the)? key points(?: (?:of|for) graph (\d+))?$/,
  );
  if (keyPointRequest) {
    const number = Number(keyPointRequest[1] || 1);
    const expression = curves[number - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const points = graphKeyPoints(expression, original.graphRange);
    return result(
      `Graph ${number}. ${points.length ? points.map((p) => `${p.name}: (${displayNumber(p.x)}, ${displayNumber(p.y)})`).join('; ') + '.' : 'No key points found.'} X-intercepts use this x range; y-intercepts and quadratic vertices may lie outside it. Sampling may miss roots.`,
    );
  }
  const numberedRoots = command.match(
    /^(?:find|read|show)(?: the)? (?:roots|intercepts|x[ -]intercepts)(?: of| for)? graph (\d+)$/,
  );
  if (numberedRoots) {
    const expression = curves[Number(numberedRoots[1]) - 1];
    if (!expression) throw new Error('That graph expression does not exist.');
    const message = runCommand(
      { ...original, expression, graphExpressions: [] },
      'find roots',
    ).message;
    return result(`Graph ${numberedRoots[1]}. ${message}`);
  }
  const numberedAudio = command.match(/^(?:play|hear|listen to) graph (\d+)$/);
  if (numberedAudio) {
    const expression = curves[Number(numberedAudio[1]) - 1];
    if (original.mode !== 'equation' || !expression)
      throw new Error('That graph expression does not exist.');
    graphFunction(expression);
    return {
      ...action(
        'sonify',
        `Playing graph ${numberedAudio[1]} from left to right. Higher pitches mean larger values.`,
      ),
      sonifyExpression: expression,
    };
  }
  const viewport = input.match(/^view x (.+?) to (.+?) y (.+?) to (.+)$/i);
  if (viewport) {
    const numbers = viewport.slice(1).map((v) => evaluateMath(parseMath(v)));
    const graphRange = validateGraphRange({ min: numbers[0], max: numbers[1] });
    const graphYRange = validateGraphRange({
      min: numbers[2],
      max: numbers[3],
    });
    graphFunction(original.expression);
    return result(
      `View x ${displayNumber(numbers[0])} to ${displayNumber(numbers[1])}, y ${displayNumber(numbers[2])} to ${displayNumber(numbers[3])}.`,
      { ...original, graph: true, mode: 'equation', graphRange, graphYRange },
      true,
    );
  }
  const pan = command.match(/^pan(?: graph)? (left|right|up|down)$/);
  if (pan) {
    const graphRange = original.graphRange || defaultGraphRange;
    const graphYRange = original.graphYRange || defaultGraphRange;
    graphFunction(original.expression);
    return result(
      `Graph panned ${pan[1]}.`,
      {
        ...original,
        graph: true,
        mode: 'equation',
        graphRange: /left|right/.test(pan[1])
          ? shiftGraphRange(graphRange, pan[1] === 'left' ? -0.25 : 0.25)
          : graphRange,
        graphYRange: /up|down/.test(pan[1])
          ? shiftGraphRange(graphYRange, pan[1] === 'down' ? -0.25 : 0.25)
          : graphYRange,
      },
      true,
    );
  }
  const curvePoint = input.match(/^(evaluate|trace) graph (\d+) at x (.+)$/i);
  if (curvePoint) {
    const index = Number(curvePoint[2]) - 1;
    if (!curves[index])
      throw new Error('That graph expression does not exist.');
    const x = evaluateMath(parseMath(curvePoint[3]));
    if (!Number.isFinite(x) || Math.abs(x) > 1e6)
      throw new Error(
        'Use a finite x between minus one million and one million.',
      );
    const y = graphFunction(curves[index]).value(x);
    const graphTrace = { graph: index + 1, x, expression: curves[index] };
    if (curvePoint[1].toLowerCase() === 'trace') validateGraphTrace(graphTrace);
    return result(
      `Graph ${index + 1}, x = ${displayNumber(x)}, ${y === null ? 'undefined' : `y = ${displayNumber(y)}`}.${curvePoint[1].toLowerCase() === 'trace' && y !== null && Math.abs(y) > 1e6 ? ' This y value is outside the supported plot view; its coordinates are still readable.' : ''}`,
      curvePoint[1].toLowerCase() === 'trace'
        ? {
            ...original,
            mode: 'equation',
            graph: true,
            graphTrace,
            graphRange: includeGraphValue(
              original.graphRange || defaultGraphRange,
              x,
            ),
            graphYRange:
              y === null
                ? original.graphYRange
                : includeGraphValue(
                    original.graphYRange || defaultGraphRange,
                    y,
                  ),
          }
        : original,
      curvePoint[1].toLowerCase() === 'trace',
    );
  }
  const rangeRequest = input.match(
    /^(?:set )?(?:graph |x )?range(?: from)? (.+?) to (.+)$/i,
  );
  if (rangeRequest) {
    const range = validateGraphRange({
      min: evaluateMath(parseMath(rangeRequest[1])),
      max: evaluateMath(parseMath(rangeRequest[2])),
    });
    graphFunction(original.expression);
    return result(
      original.graphScene
        ? graphSceneMessage(original.graphScene)
        : describeGraph(original.expression, range),
      { ...original, mode: 'equation', graph: true, graphRange: range },
      true,
    );
  }
  if (/^(zoom in|zoom out|reset graph)$/.test(command)) {
    const r = original.graphRange ?? defaultGraphRange;
    const center = (r.min + r.max) / 2,
      half = (r.max - r.min) / (command === 'zoom in' ? 4 : 1);
    const range = validateGraphRange(
      command === 'reset graph'
        ? defaultGraphRange
        : { min: center - half, max: center + half },
    );
    const yr = original.graphYRange || defaultGraphRange;
    const yc = (yr.min + yr.max) / 2,
      yh = (yr.max - yr.min) / (command === 'zoom in' ? 4 : 1);
    const graphYRange = validateGraphRange(
      command === 'reset graph'
        ? defaultGraphRange
        : { min: yc - yh, max: yc + yh },
    );
    graphFunction(original.expression);
    return result(
      original.graphScene
        ? graphSceneMessage(original.graphScene)
        : describeGraph(original.expression, range),
      {
        ...original,
        mode: 'equation',
        graph: true,
        graphRange: range,
        graphYRange,
      },
      true,
    );
  }
  if (
    /^(?:find |show |read )?(?:the )?(?:graph )?(?:roots|x[ -]intercepts)$/.test(
      command,
    )
  ) {
    if (
      curvePoints(original.expression, original.graphRange).every(
        (p) => p.y === 0,
      )
    )
      return result(
        'Every sampled value in this view is zero. This is not a set of isolated intercepts; sampling alone cannot prove the function is identically zero.',
      );
    const roots = graphRoots(original.expression, original.graphRange);
    return result(
      roots.length
        ? `Approximate x intercepts in this view: ${roots.map(displayNumber).join(', ')}. Sampling may miss roots.`
        : 'No x intercepts detected in this view. Sampling may miss roots.',
    );
  }
  const plot = input.match(/^(?:graph|plot) (?!it$|the equation$)(.+)$/i);
  if (plot) {
    const expression = formatMath(parseMath(plot[1]));
    const base = { ...original };
    delete base.graphScene;
    return result(
      describeGraph(expression, original.graphRange),
      { ...base, expression, mode: 'equation', graph: true, selection: 0 },
      true,
      true,
    );
  }
  if (/^(graph|show graph|graph (it|the equation))$/.test(command))
    return result(
      describeGraph(original.expression, original.graphRange),
      { ...original, mode: 'equation', graph: true, selection: 0 },
      true,
    );
  if (/^(hide graph)$/.test(command))
    return result('Graph hidden.', { ...original, graph: false }, true);
  if (/^(describe graph|explain graph)$/.test(command))
    return result(
      curves
        .map(
          (e, i) =>
            `${curves.length > 1 ? `Graph ${i + 1}. ` : ''}${describeGraph(e, original.graphRange)}`,
        )
        .join(' '),
    );
  if (/^(play graph|play data|sonify|listen to (graph|data))$/.test(command)) {
    if (original.mode === 'geometry')
      throw new Error('Say read to hear this workspace.');
    return action(
      'sonify',
      'Playing values from left to right. Higher pitches mean larger values, normalized within this view.',
    );
  }
  const metric = statisticsInput(command);
  if (metric) {
    const inline = metric.data !== undefined;
    const data = metric.data ?? original.data;
    const s = statistics(data);
    const name = metric.name;
    if (name === 'variance' || name === 'standard deviation')
      throw new ClarificationError(
        `Do you want sample or population ${name}? Say, for example, sample ${name}${inline ? ` of ${metric.source}` : ''}.`,
      );
    let value: string;
    if (name === 'mode')
      value = s.modes.length
        ? s.modes.map(displayNumber).join(', ')
        : 'none (no value repeats)';
    else if (name.includes('variance') || name.includes('standard deviation')) {
      const variance = name.startsWith('sample')
        ? s.sampleVariance
        : s.populationVariance;
      value = displayNumber(
        name.includes('deviation') ? Math.sqrt(variance) : variance,
      );
    } else {
      const key =
        ({ average: 'mean', minimum: 'min', maximum: 'max' } as const)[
          name as 'average' | 'minimum' | 'maximum'
        ] ?? name;
      value = displayNumber(
        s[key as 'median' | 'mean' | 'range' | 'sum' | 'count' | 'min' | 'max'],
      );
    }
    const explanation =
      name === 'median'
        ? ` Sorted values: ${[...data]
            .sort((a, b) => a - b)
            .map(displayNumber)
            .join(
              ', ',
            )}. ${data.length % 2 ? 'The median is the middle value.' : 'The median is the average of the two middle values.'}`
        : '';
    return result(
      `${name[0].toUpperCase() + name.slice(1)}: ${value}.${explanation}`,
      { ...original, data, mode: 'statistics', selection: 0 },
      Boolean(inline),
      Boolean(inline),
    );
  }
  if (/^(?:(?:find|explain|show|show me)(?: the)? )?outliers$/.test(command))
    return result(
      describeData(original.data),
      { ...original, mode: 'statistics', selection: 0 },
      true,
    );
  const at = input.match(
    /^(?:evaluate at|at|read graph at) x(?: equals| equal to| =)? (.+)$/i,
  );
  if (at) {
    const x = evaluateMath(parseMath(at[1]));
    const parsed = currentEquationNode();
    if (
      parsed.kind === 'equation' &&
      !(parsed.left.kind === 'variable' && parsed.left.name === 'y') &&
      !(parsed.right.kind === 'variable' && parsed.right.name === 'y')
    ) {
      const left = evaluateMath(parsed.left, { x }),
        right = evaluateMath(parsed.right, { x });
      return result(
        `At x = ${displayNumber(x)}, left side is ${displayNumber(left)}, right side is ${displayNumber(right)}, and left minus right is ${displayNumber(left - right)}.`,
      );
    }
    const plotted = graphFunction(original.expression),
      y = plotted.value(x);
    return result(
      y === null
        ? `At x = ${displayNumber(x)}, the graph is undefined.`
        : `At x = ${displayNumber(x)}, ${plotted.label} = ${displayNumber(y)}.`,
    );
  }

  const side = command.match(/^(?:read|explore)(?: the)? (left|right) side$/);
  if (side) {
    const n = currentEquationNode();
    if (n.kind !== 'equation')
      throw new Error(
        'This is an expression. Enter an equation with equals to explore its sides.',
      );
    return result(
      `${side[1]} side: ${speakMath(side[1] === 'left' ? n.left : n.right)}`,
    );
  }
  const selection = command.match(/^(next|previous)(?: (part|point|step))?$/);
  const endpointSelection = command.match(
    /^(?:read |select |explore )?(first|last) (part|point|step|observation)$/,
  );
  const indexMatch = command.match(
    /^(?:read|select|explore) (?:part|point|step|observation) (\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/,
  );
  if (selection || indexMatch || endpointSelection) {
    const parts = partsFor(original);
    const words = [
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
    ];
    const requested = endpointSelection
      ? endpointSelection[1] === 'first'
        ? 0
        : parts.length - 1
      : indexMatch
        ? (Number(indexMatch[1]) || words.indexOf(indexMatch[1]) + 1) - 1
        : original.selection + (selection?.[1] === 'next' ? 1 : -1);
    if (requested < 0 || requested >= parts.length)
      throw new Error(
        `There are ${parts.length} parts. ${requested < 0 ? 'You are at the first part.' : 'You are at the last part.'}`,
      );
    return result(parts[requested].spoken, {
      ...original,
      selection: requested,
    });
  }
  if (isSimplificationCommand(input)) {
    if (original.mode !== 'equation')
      throw new Error('Open an equation before simplifying.');
    const expression = formatMath(simplifyMath(currentEquationNode()));
    if (expression === formatMath(currentEquationNode()))
      return result(`No further supported simplification. ${expression}`);
    return {
      ...result(
        `Simplified: ${expression}`,
        { ...original, expression, selection: 0 },
        true,
        true,
      ),
      storedCommand: 'simplify',
    };
  }
  const operation = interpretOperation(original.expression, input);
  if (operation !== null) {
    if (original.graphScene) currentEquationNode();
    if (original.mode !== 'equation')
      throw new Error('Open an equation before applying that operation.');
    return result(
      `Added step: ${operation}`,
      { ...original, expression: operation, selection: 0 },
      true,
      true,
    );
  }
  const replace = input.match(
    /^(?:replace|change)\s+(.+?)\s+(?:with|to)\s+(.+)$/i,
  );
  if (replace) {
    if (original.mode === 'equation') {
      const n = replaceMath(currentEquationNode(), replace[1], replace[2]);
      return result(
        `Your equation is now ${speakMath(n)}. Say undo to go back.`,
        { ...original, expression: formatMath(n), selection: 0 },
        true,
        true,
      );
    }
    throw new Error(
      'To update the data, say data followed by the new comma-separated values.',
    );
  }
  const dataset = input.match(/^(?:data set|set data|dataset|data)\s+(.+)$/i);
  if (dataset) {
    const data = parseData(dataset[1]);
    return result(
      describeData(data),
      { ...original, mode: 'statistics', data, selection: 0 },
      true,
      true,
    );
  }
  // Chrome can hear "write" as "right". Only repair a complete equation;
  // geometry and requests about the right side keep their original meaning.
  const equationInput =
    /^right\s+.+(?:=|\bequals?\b).+$/i.test(input) &&
    !/^right\s+(?:side|angle|triangle)\b/i.test(input)
      ? input.replace(/^right\s+/i, '')
      : input.replace(/^(?:write|enter|equation)\s+/i, '');
  const node = parseMath(equationInput);
  return result(
    `Your ${node.kind === 'equation' ? 'equation' : 'expression'} is now ${speakMath(node)}.`,
    {
      ...equationWorkspace(original),
      mode: 'equation',
      expression: formatMath(node),
      selection: 0,
    },
    true,
    true,
  );
}
