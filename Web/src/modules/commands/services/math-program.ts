import {
  currentGraphScene,
  equationWorkspace,
  graphSceneState,
  graphSceneIndex,
} from './graph-scene.ts';
import { compileGraphScene } from '../../visuals/index.ts';
import {
  applyBothSidesMath,
  evaluateMath,
  formatMath,
  getParts,
  parseData,
  parseMath,
  replaceMath,
  replacePartMath,
  simplifyMath,
  solveMath,
  speakMath,
  type MathNode,
} from '../../math/index.ts';
import {
  validateConstruction,
  describeConstruction,
  editConstruction,
  measureGeometry,
  scaleGeometry,
  validateGeometry,
  type Shape,
} from '../../visuals/index.ts';
import type { Workspace } from '../../workspace/state.ts';
import {
  describeWorkspace,
  partsFor,
  initialWorkspace,
} from '../../workspace/state.ts';
import type {
  PartReference as Part,
  SceneValue as Scene,
  ProgramValue as Value,
  MathValue as Work,
} from '../types/program.ts';
import { interpretTypeScript } from './program-parser.ts';
import { programTool, type ToolName } from '../config/tool-catalog.ts';
import { validateToolArguments } from './tool-execution.ts';
import { runCommand, type CommandResult } from './run-command.ts';

// Stored commands keep the existing problem format and replay through the same interpreter.
export const MATH_PROGRAM_PREFIX = 'typescript\n';
export const isMathProgramCommand = (text: string) =>
  text.startsWith(MATH_PROGRAM_PREFIX);
export const mathProgramCommand = (source: string) =>
  MATH_PROGRAM_PREFIX + source;

/**
 * - Interprets approved TypeScript calls against private values from this workspace.
 * - Returns only the explicit saved value and requested readbacks; never persists work.
 * - Rejects invalid syntax, arguments, domains and references before returning a change.
 * - Keeps intermediate values immutable and controls separate from mathematical work.
 */
export function runMathProgram(
  original: Workspace,
  source: string,
): CommandResult & { control?: string; operations: string[]; saved: boolean } {
  const references = new WeakSet<object>();
  const messages: string[] = [];
  let saved: Workspace | undefined;
  let control: string | undefined;
  const operations: string[] = [];
  const work = (value: Value): Work => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('kind' in value) ||
      value.kind !== 'math' ||
      !references.has(value)
    )
      throw new Error('Expected a mathematical expression or equation.');
    return value as Work;
  };
  const math = (state: Workspace, node: MathNode, selection = 0): Work => {
    const expression = formatMath(node);
    parseMath(expression); // Preserve the engine's token and nesting limits after transformations.
    const value: Work = {
      kind: 'math',
      node,
      state: {
        ...equationWorkspace(state),
        mode: 'equation',
        expression,
        selection,
      },
    };
    delete value.state.graphScene;
    references.add(value);
    return value;
  };
  const expression = (value: Value): MathNode =>
    typeof value === 'string' || typeof value === 'number'
      ? parseMath(String(value))
      : work(value).node;
  const text = (value: Value): string => {
    if (typeof value !== 'string') throw new Error('Expected text.');
    return value;
  };
  const number = (value: Value): number => {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error('Expected a finite number.');
    return value;
  };
  const scene = (value: Value, kind: Scene['kind']): Scene => {
    if (
      !value ||
      typeof value !== 'object' ||
      !references.has(value) ||
      !('kind' in value) ||
      value.kind !== kind
    )
      throw new Error(`Expected a ${kind} reference.`);
    return value as Scene;
  };
  const makeScene = (
    kind: Scene['kind'],
    state: Workspace,
    number = 1,
  ): Scene => {
    const value = { kind, state, number };
    references.add(value);
    return value;
  };
  const dimensions = (value: Value): Record<string, number> => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      references.has(value)
    )
      throw new Error('Expected labeled numeric dimensions.');
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, number(v)]),
    );
  };
  const query = (value: Scene, command: string): undefined => {
    messages.push(runCommand(value.state, command).message);
    return undefined;
  };
  const change = (
    value: Scene,
    command: string,
    selected = value.number,
  ): Scene =>
    makeScene(value.kind, runCommand(value.state, command).state, selected);
  const executeTool = (name: ToolName, args: Value[]): Value => {
    switch (name) {
      case 'problem.blank':
        return math(
          {
            ...initialWorkspace,
            expression: '0',
            data: [0, 0],
          },
          parseMath('0'),
        );
      case 'problem.example': {
        const mode = text(args[0]);
        if (!['equation', 'statistics'].includes(mode))
          throw new Error('Choose an equation or statistics example.');
        if (mode === 'equation') {
          const value: Work = {
            kind: 'math',
            state: { ...initialWorkspace },
            node: parseMath(initialWorkspace.expression),
          };
          references.add(value);
          return value;
        }
        return makeScene(mode as 'statistics', {
          ...initialWorkspace,
          mode: mode as 'statistics',
        });
      }
      case 'problem.currentEquation': {
        if (original.mode !== 'equation' || original.graphScene)
          throw new Error(
            'Open an equation first; use graph references for the graph collection.',
          );
        const value: Work = {
          kind: 'math',
          state: original,
          node: parseMath(original.expression),
        };
        references.add(value);
        return value;
      }
      case 'math.expression':
      case 'math.equation': {
        if (typeof args[0] !== 'string')
          throw new Error('Supply mathematical notation as a string.');
        const node = parseMath(args[0]);
        if (name === 'math.equation' && node.kind !== 'equation')
          throw new Error('Expected an equation.');
        return math(original, node);
      }
      case 'math.addBothSides':
      case 'math.subtractBothSides':
      case 'math.multiplyBothSides':
      case 'math.divideBothSides': {
        const value = work(args[0]);
        const operand = expression(args[1]);
        const op = (
          {
            'math.addBothSides': '+',
            'math.subtractBothSides': '-',
            'math.multiplyBothSides': '*',
            'math.divideBothSides': '/',
          } as const
        )[name];
        return math(value.state, applyBothSidesMath(value.node, op, operand));
      }
      case 'math.simplify':
        return math(work(args[0]).state, simplifyMath(work(args[0]).node));
      case 'math.swapSides': {
        const value = work(args[0]);
        if (value.node.kind !== 'equation')
          throw new Error('Expected an equation.');
        return math(value.state, {
          kind: 'equation',
          left: value.node.right,
          right: value.node.left,
        });
      }
      case 'math.leftSide':
      case 'math.rightSide': {
        const value = work(args[0]);
        if (value.node.kind !== 'equation')
          throw new Error('Expected an equation.');
        return math(
          value.state,
          name === 'math.leftSide' ? value.node.left : value.node.right,
        );
      }
      case 'math.part': {
        const owner = work(args[0]),
          number = args[1];
        if (
          typeof number !== 'number' ||
          !Number.isInteger(number) ||
          !getParts(owner.node)[number - 1]
        )
          throw new Error('That part does not exist.');
        const part: Part = { kind: 'part', owner, number };
        if (
          args[2] !== undefined &&
          formatMath(parseMath(text(args[2]))) !==
            formatMath(getParts(owner.node)[number - 1].node)
        )
          throw new Error(
            'That part changed. Select it again; your work is unchanged.',
          );
        references.add(part);
        return part;
      }
      case 'math.replacePart': {
        const value = work(args[0]),
          part = args[1];
        if (
          !part ||
          typeof part !== 'object' ||
          !references.has(part) ||
          !('kind' in part) ||
          part.kind !== 'part' ||
          (part as Part).owner !== value
        )
          throw new Error(
            'Part reference belongs to a different equation value; select it again.',
          );
        return math(
          value.state,
          replacePartMath(
            value.node,
            (part as Part).number,
            formatMath(expression(args[2])),
          ),
        );
      }
      case 'math.replace':
        return math(
          work(args[0]).state,
          replaceMath(
            work(args[0]).node,
            formatMath(expression(args[1])),
            formatMath(expression(args[2])),
          ),
        );
      case 'math.solve':
        messages.push(solveMath(work(args[0]).node));
        return undefined;
      case 'math.read': {
        const value = args[0];
        if (
          value &&
          typeof value === 'object' &&
          references.has(value) &&
          'kind' in value &&
          value.kind === 'part'
        ) {
          const part = value as Part;
          messages.push(
            speakMath(getParts(part.owner.node)[part.number - 1].node),
          );
        } else messages.push(speakMath(work(value).node));
        return undefined;
      }
      case 'math.evaluate': {
        const node = work(args[0]).node,
          variables = args[1] === undefined ? {} : dimensions(args[1]);
        if (node.kind === 'equation') {
          const left = evaluateMath(node.left, variables),
            right = evaluateMath(node.right, variables),
            difference = left - right;
          if (!Number.isFinite(difference))
            throw new Error('Equation difference has no finite real value.');
          messages.push(
            `Left side: ${left}. Right side: ${right}. Difference: ${difference}.`,
          );
          return { left, right, difference };
        }
        const value = evaluateMath(node, variables);
        messages.push(`Value: ${value}.`);
        return value;
      }
      case 'problem.save': {
        if (saved) throw new Error('Save exactly one result per program.');
        const value = args[0];
        if (
          !value ||
          typeof value !== 'object' ||
          !references.has(value) ||
          !('state' in value)
        )
          throw new Error(
            'Save an equation, graph, shape or dataset reference.',
          );
        saved = (value as Work | Scene).state;
        if (
          original.retainedGraph &&
          'kind' in value &&
          value.kind === 'graph'
        ) {
          saved = {
            ...saved,
            expression: original.expression,
            retainedGraph: currentGraphScene(saved),
          };
          delete saved.graphScene;
          delete saved.graphExpressions;
        }
        return undefined;
      }
      case 'graph.scene': {
        if (
          !Array.isArray(args[0]) ||
          !args[0].every((v) => typeof v === 'string')
        )
          throw new Error('Supply an array of graph expressions.');
        return makeScene(
          'graph',
          graphSceneState(original, {
            rows: (args[0] as string[]).map((expression) => ({ expression })),
          }),
        );
      }
      case 'graph.name': {
        const g = scene(args[0], 'graph'),
          collection = currentGraphScene(g.state);
        const label = text(args[1]).trim();
        const rows = collection.rows.map((row, i) => {
          const next = { ...row };
          if (i === g.number - 1) {
            if (label) next.name = label;
            else delete next.name;
          }
          return next;
        });
        return makeScene('graph', graphSceneState(g.state, { rows }), g.number);
      }
      case 'graph.domain': {
        const g = scene(args[0], 'graph'),
          collection = currentGraphScene(g.state);
        const kind = compileGraphScene(collection).rows[g.number - 1].kind;
        if (kind !== 'polar' && kind !== 'parametric')
          throw new Error(
            'Parameter bounds apply to polar or parametric curves.',
          );
        const rows = collection.rows.map((row, i) =>
          i === g.number - 1
            ? { ...row, domain: { min: number(args[1]), max: number(args[2]) } }
            : { ...row },
        );
        return makeScene('graph', graphSceneState(g.state, { rows }), g.number);
      }
      case 'graph.point': {
        const g = scene(args[0], 'graph'),
          compiled = compileGraphScene(currentGraphScene(g.state));
        if (
          ['implicit', 'inequality', 'variable'].includes(
            compiled.rows[g.number - 1].kind,
          )
        )
          throw new Error(
            'Use graph.testPoint with both coordinates for this relation.',
          );
        const point = compiled.point(g.number - 1, number(args[1]));
        messages.push(
          point
            ? `Point (${point.x}, ${point.y}).`
            : 'The curve is undefined at this parameter.',
        );
        return undefined;
      }
      case 'graph.testPoint': {
        const g = scene(args[0], 'graph'),
          compiled = compileGraphScene(currentGraphScene(g.state));
        const row = compiled.rows[g.number - 1],
          x = number(args[1]),
          y = number(args[2]);
        if (row.kind !== 'implicit' && row.kind !== 'inequality')
          throw new Error(
            'Point membership currently checks implicit equations and inequalities.',
          );
        const belongs = compiled.contains(g.number - 1, x, y);
        messages.push(
          `Point (${x}, ${y}) ${belongs ? 'satisfies' : 'does not satisfy'} this relation (numerical check).`,
        );
        return undefined;
      }
      case 'graph.current': {
        if (original.retainedGraph)
          return makeScene(
            'graph',
            graphSceneState(original, original.retainedGraph),
            graphSceneIndex(original.retainedGraph, args[0]),
          );
        if (original.graphScene) {
          if (original.mode !== 'equation')
            throw new Error('Open the graph collection first.');
          return makeScene(
            'graph',
            original,
            graphSceneIndex(original.graphScene, args[0]),
          );
        }
        const index = number(args[0]);
        if (
          !Number.isInteger(index) ||
          index < 1 ||
          index > 1 + (original.graphExpressions?.length ?? 0) ||
          original.mode !== 'equation'
        )
          throw new Error('That graph does not exist.');
        // Validate that this expression is a graphable function, not a general equation.
        runCommand(original, `evaluate graph ${index} at x 0`);
        return makeScene('graph', original, index);
      }
      case 'graph.plot':
        return makeScene(
          'graph',
          runCommand(original, `graph ${text(args[0])}`).state,
        );
      case 'graph.add': {
        const g = scene(args[0], 'graph');
        if (g.state.graphScene) {
          const rows = [
            ...g.state.graphScene.rows,
            { expression: text(args[1]) },
          ];
          return makeScene(
            'graph',
            graphSceneState(g.state, { rows }),
            rows.length,
          );
        }
        const result = change(g, `add graph ${text(args[1])}`);
        return makeScene(
          'graph',
          result.state,
          1 + (result.state.graphExpressions?.length ?? 0),
        );
      }
      case 'graph.edit':
        if (scene(args[0], 'graph').state.graphScene) {
          const g = scene(args[0], 'graph');
          const rows = g.state.graphScene!.rows.map((row, i) =>
            i === g.number - 1
              ? { ...row, expression: text(args[1]) }
              : { ...row },
          );
          return makeScene(
            'graph',
            graphSceneState(g.state, { rows }),
            g.number,
          );
        }
        return change(
          scene(args[0], 'graph'),
          `edit graph ${scene(args[0], 'graph').number} to ${text(args[1])}`,
        );
      case 'graph.remove':
        if (scene(args[0], 'graph').state.graphScene) {
          const g = scene(args[0], 'graph');
          const rows = g.state.graphScene!.rows.filter(
            (_row, i) => i !== g.number - 1,
          );
          return makeScene('graph', graphSceneState(g.state, { rows }));
        }
        return change(
          scene(args[0], 'graph'),
          `remove graph ${scene(args[0], 'graph').number}`,
          1,
        );
      case 'graph.trace':
        return change(
          scene(args[0], 'graph'),
          `trace graph ${scene(args[0], 'graph').number} at x ${number(args[1])}`,
        );
      case 'graph.addTangent':
      case 'graph.addNormal': {
        const g = scene(args[0], 'graph');
        return change(
          g,
          `add ${name === 'graph.addTangent' ? 'tangent' : 'normal'} to graph ${g.number} at x ${number(args[1])}`,
        );
      }
      case 'graph.addDerivative':
        return change(
          scene(args[0], 'graph'),
          `add derivative of graph ${scene(args[0], 'graph').number}`,
        );
      case 'graph.addSecant':
        return change(
          scene(args[0], 'graph'),
          `add secant to graph ${scene(args[0], 'graph').number} from ${number(args[1])} to ${number(args[2])}`,
        );
      case 'graph.shift':
        return change(
          scene(args[0], 'graph'),
          `shift graph ${scene(args[0], 'graph').number} right ${number(args[1])} up ${number(args[2])}`,
        );
      case 'graph.reflect': {
        const axis = text(args[1]);
        if (!['x', 'y'].includes(axis)) throw new Error('Axis must be x or y.');
        return change(
          scene(args[0], 'graph'),
          `reflect graph ${scene(args[0], 'graph').number} across ${axis} axis`,
        );
      }
      case 'graph.scaleVertically':
        return change(
          scene(args[0], 'graph'),
          `scale graph ${scene(args[0], 'graph').number} vertically by ${number(args[1])}`,
        );
      case 'graph.value':
      case 'graph.slope':
      case 'graph.normal': {
        const g = scene(args[0], 'graph');
        return query(
          g,
          `${name === 'graph.value' ? 'evaluate graph' : name === 'graph.slope' ? 'slope of graph' : 'normal of graph'} ${g.number} at x ${number(args[1])}`,
        );
      }
      case 'graph.derivative':
      case 'graph.roots':
      case 'graph.keyPoints':
      case 'graph.table': {
        const g = scene(args[0], 'graph');
        const verb = {
          'graph.derivative': 'derivative of graph',
          'graph.roots': 'find roots of graph',
          'graph.keyPoints': 'find key points of graph',
          'graph.table': 'table graph',
        }[name];
        return query(g, `${verb} ${g.number}`);
      }
      case 'graph.integral':
      case 'graph.totalArea':
      case 'graph.averageRate': {
        const g = scene(args[0], 'graph');
        const verb = {
          'graph.integral': 'integral graph',
          'graph.totalArea': 'total area graph',
          'graph.averageRate': 'average rate of change of graph',
        }[name];
        return query(
          g,
          `${verb} ${g.number} from ${number(args[1])} to ${number(args[2])}`,
        );
      }
      case 'graph.intersections':
      case 'graph.areaBetween': {
        const a = scene(args[0], 'graph'),
          b = scene(args[1], 'graph');
        if (
          JSON.stringify([a.state.expression, a.state.graphExpressions]) !==
          JSON.stringify([b.state.expression, b.state.graphExpressions])
        )
          throw new Error(
            'Graph references belong to different curve collections.',
          );
        return query(
          a,
          name === 'graph.intersections'
            ? `find intersections of graphs ${a.number} and ${b.number}`
            : `area between graphs ${a.number} and ${b.number} from ${number(args[2])} to ${number(args[3])}`,
        );
      }
      case 'graph.select': {
        const g = scene(args[0], 'graph');
        if (g.state.graphScene)
          return makeScene(
            'graph',
            g.state,
            graphSceneIndex(g.state.graphScene, args[1]),
          );
        const index = number(args[1]);
        if (
          !Number.isInteger(index) ||
          index < 1 ||
          index > 1 + (g.state.graphExpressions?.length ?? 0)
        )
          throw new Error('That graph does not exist.');
        return makeScene('graph', g.state, index);
      }
      case 'geometry.construct': {
        const source = text(args[0]);
        validateConstruction(source);
        return makeScene('geometry', {
          ...original,
          mode: 'geometry',
          graph: false,
          geometry: undefined,
          geometryOverlay: undefined,
          construction: source,
          selection: 0,
        });
      }
      case 'geometry.extend': {
        const g = scene(args[0], 'geometry');
        if (!g.state.construction)
          throw new Error('Open a named construction first.');
        const source = g.state.construction + '\n' + text(args[1]);
        validateConstruction(source);
        return makeScene('geometry', { ...g.state, construction: source });
      }
      case 'geometry.editObject': {
        const g = scene(args[0], 'geometry');
        if (!g.state.construction)
          throw new Error('Open a named construction first.');
        return makeScene('geometry', {
          ...g.state,
          construction: editConstruction(
            g.state.construction,
            text(args[1]),
            text(args[2]),
          ),
        });
      }
      case 'geometry.inspect': {
        const g = scene(args[0], 'geometry');
        if (!g.state.construction)
          throw new Error('Open a named construction first.');
        messages.push(
          describeConstruction(g.state.construction, text(args[1])),
        );
        return undefined;
      }
      case 'geometry.current':
        if (!original.geometry && !original.construction)
          throw new Error('Create a shape or named construction first.');
        return makeScene('geometry', { ...original, mode: 'geometry' });
      case 'geometry.create': {
        const geometry = validateGeometry({
          shape: text(args[0]) as Shape,
          dimensions: dimensions(args[1]),
        });
        const state: Workspace = {
          ...original,
          mode: 'geometry',
          geometry,
          graph: false,
          geometryOverlay: undefined,
          selection: 0,
        };
        delete state.construction;
        return makeScene('geometry', state);
      }
      case 'geometry.scale': {
        const g = scene(args[0], 'geometry');
        return makeScene('geometry', {
          ...g.state,
          geometry: scaleGeometry(g.state.geometry!, number(args[1])),
          geometryOverlay: undefined,
        });
      }
      case 'geometry.setDimensions': {
        const g = scene(args[0], 'geometry');
        const geometry = validateGeometry({
          ...g.state.geometry!,
          dimensions: {
            ...g.state.geometry!.dimensions,
            ...dimensions(args[1]),
          },
        });
        return makeScene('geometry', {
          ...g.state,
          geometry,
          construction: undefined,
          geometryOverlay: undefined,
        });
      }
      case 'geometry.measure': {
        const g = scene(args[0], 'geometry');
        messages.push(measureGeometry(g.state.geometry!, text(args[1])));
        return undefined;
      }
      case 'geometry.classify':
        return query(scene(args[0], 'geometry'), 'classify triangle');
      case 'geometry.construction': {
        const label = text(args[1]);
        if (
          !/^(?:show centroid|median [abc]|altitude [abc]|inradius|circumradius|hide construction)$/.test(
            label,
          )
        )
          throw new Error('Unsupported construction.');
        return change(scene(args[0], 'geometry'), label);
      }
      case 'statistics.current':
        return makeScene('statistics', { ...original, mode: 'statistics' });
      case 'statistics.data': {
        if (!Array.isArray(args[0]))
          throw new Error('Expected an array of numbers.');
        const data = parseData(args[0].map(number).join(','));
        return makeScene('statistics', {
          ...original,
          mode: 'statistics',
          data,
          selection: 0,
        });
      }
      case 'statistics.mean':
      case 'statistics.median':
      case 'statistics.mode':
      case 'statistics.range':
      case 'statistics.sum':
      case 'statistics.count':
      case 'statistics.minimum':
      case 'statistics.maximum':
      case 'statistics.outliers':
      case 'statistics.sampleVariance':
      case 'statistics.populationVariance':
      case 'statistics.sampleStandardDeviation':
      case 'statistics.populationStandardDeviation': {
        const metric = name
          .slice('statistics.'.length)
          .replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
        return query(
          scene(args[0], 'statistics'),
          metric === 'outliers' ? 'find outliers' : metric,
        );
      }
      case 'problem.read':
      case 'problem.readPart':
      case 'view.selectPart':
      case 'view.nextPart':
      case 'view.previousPart': {
        const value = args[0];
        if (
          !value ||
          typeof value !== 'object' ||
          !references.has(value) ||
          !('state' in value)
        )
          throw new Error('Expected a saved-work value.');
        const reference = value as Work | Scene,
          state = reference.state;
        if (name === 'problem.read') {
          messages.push(describeWorkspace(state));
          return undefined;
        }
        const parts = partsFor(state);
        const index =
          name === 'view.nextPart'
            ? state.selection + 1
            : name === 'view.previousPart'
              ? state.selection - 1
              : number(args[1]) - 1;
        if (!Number.isInteger(index) || !parts[index])
          throw new Error('That part does not exist.');
        if (name === 'problem.readPart') {
          messages.push(parts[index].spoken);
          return undefined;
        }
        messages.push(parts[index].spoken);
        const selected = {
          ...reference,
          state: { ...state, selection: index },
        };
        references.add(selected);
        return selected;
      }
      case 'view.range': {
        return change(
          scene(args[0], 'graph'),
          `view x ${number(args[1])} to ${number(args[2])} y ${number(args[3])} to ${number(args[4])}`,
        );
      }
      case 'view.pan': {
        const direction = text(args[1]);
        if (!['left', 'right', 'up', 'down'].includes(direction))
          throw new Error('Choose left, right, up or down.');
        return change(scene(args[0], 'graph'), `pan graph ${direction}`);
      }
      case 'view.zoom': {
        const direction = text(args[1]);
        if (!['in', 'out'].includes(direction))
          throw new Error('Choose in or out.');
        return change(scene(args[0], 'graph'), `zoom ${direction}`);
      }
      case 'view.fit':
      case 'view.reset':
      case 'view.hideComparison':
      case 'view.fitComparison':
      case 'view.hideGraph': {
        const command = {
          'view.fit': 'fit graph',
          'view.reset': 'reset graph',
          'view.hideComparison': 'hide comparison',
          'view.fitComparison': 'fit comparison',
          'view.hideGraph': 'hide graph',
        }[name];
        return change(scene(args[0], 'graph'), command);
      }
      case 'view.showGraph':
        return change(scene(args[0], 'graph'), 'graph');
      case 'history.reviseStep': {
        const step = number(args[0]);
        const expression = text(args[1]);
        if (!Number.isInteger(step) || step < 1)
          throw new Error('Use a positive whole-number step.');
        if (parseMath(expression).kind !== 'equation')
          throw new Error('Enter an equation with an equals sign.');
        control = `revise step ${step} to ${expression}`;
        return undefined;
      }
      case 'history.undo':
      case 'history.redo':
      case 'history.restoreStep':
      case 'history.cancelStep':
      case 'history.readStep': {
        const count = number(args[0]);
        if (!Number.isInteger(count) || count < 1)
          throw new Error('Use a positive whole-number count or step.');
        const verb = {
          'history.undo': 'undo',
          'history.redo': 'redo',
          'history.restoreStep': 'restore step',
          'history.cancelStep': 'cancel step',
          'history.readStep': 'read step',
        }[name];
        control = `${verb} ${count}`;
        return undefined;
      }
      case 'view.open':
      case 'view.close': {
        const panel = text(args[0]);
        if (
          ![
            'steps',
            'voice settings',
            'saved problems',
            'more calculations',
            'help',
          ].includes(panel)
        )
          throw new Error('Unknown panel.');
        control =
          panel === 'help'
            ? name === 'view.open'
              ? 'help'
              : 'close help'
            : `${name === 'view.open' ? 'show' : 'hide'} ${panel}`;
        // The legacy panel vocabulary uses close for voice settings.
        if (name === 'view.close' && panel === 'voice settings')
          control = 'close voice settings';
        return undefined;
      }
      case 'audio.playGraph':
        control = `play graph ${number(args[0])}`;
        return undefined;
      case 'audio.playData':
        control = 'play data';
        return undefined;
      case 'audio.stopListening':
        control = 'stop listening';
        return undefined;
    }
    // A catalog addition without a corresponding handler fails TypeScript compilation.
    const missingImplementation: never = name;
    throw new Error(`Unknown function ${String(missingImplementation)}.`);
  };
  let standaloneControl = false;
  const calls = interpretTypeScript(source, (requestedName, args) => {
    const { name, definition } = programTool(requestedName);
    validateToolArguments(name, definition, args);
    operations.push(name);
    if (definition.kind === 'control') standaloneControl = true;
    const beforeSave = saved,
      beforeControl = control;
    const result = executeTool(name, args);
    if (definition.kind !== 'save' && saved !== beforeSave)
      throw new Error(`${name} cannot stage a save.`);
    if (definition.kind !== 'control' && control !== beforeControl)
      throw new Error(`${name} cannot execute a control.`);
    return result;
  });
  if (standaloneControl && calls !== 1)
    throw new Error(
      'History, audio and panel controls must be standalone; submit math separately.',
    );
  return {
    state: saved ?? original,
    message:
      messages.join('\n') ||
      (saved ? describeWorkspace(saved) : 'No changes saved.'),
    control,
    programSaved: !!saved,
    operations,
    saved: !!saved,
  };
}
