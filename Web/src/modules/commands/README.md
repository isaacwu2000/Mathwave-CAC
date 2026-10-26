# Agent math programs

AI proposes a restricted TypeScript program. Students continue using ordinary
speech and text; existing English commands and saved problem formats still work.

```ts
const equation = problem.currentEquation();
const reduced = math.simplify(math.subtractBothSides(equation, 3));
problem.save(reduced);
```

`services/program-parser.ts` uses Babel's TypeScript parser and walks its syntax
tree directly. It accepts initialized `const` bindings, strings, finite numbers,
numeric arithmetic (`+ - * / **`), arrays, explicit object properties, and approved
namespace calls. It does not compile or evaluate JavaScript. Imports, functions,
loops, mutations, property reads, computed calls, optional chaining, casts, and
type annotations are rejected. Mathematical notation inside strings retains the
math engine's conventions, including `^` for powers.

`services/math-program.ts` checks argument types and mathematical domains while
interpreting the complete program on private values. Equation operations work
directly on the math AST; both English commands and programs share the same
both-sides transformation. Existing graph/statistics/view handlers are reused
through explicit, validated adapters; there is no arbitrary command escape hatch.
This changes the agent interface, not the engine's mathematical capability.

The complete callable reference supplied to the agent is
`config/program-instructions.ts`. It covers equations, graph analysis and
transformations, geometry, statistics, accessible reading/selection,
history, panels, and audio. For example:

```ts
const curve = graph.plot('x^2');
problem.save(graph.addTangent(curve, 2));
```

```ts
const shape = geometry.create('right triangle', { a: 3, b: 4 });
geometry.measure(shape, 'hypotenuse'); // Read-only; does not save the shape.
```

Values and bindings are immutable and scoped to one program. A graph reference
captures a curve collection and selected curve. `graph.select(value, number)`
selects within that captured collection. Handles from different collections
cannot be combined for intersections or area comparisons. Part references belong
to one exact equation value; select again after a transformation. No handle is a
durable identity across turns or revisions.

Only one explicit `problem.save(value)` is allowed. All statements must succeed
before its result is applied. Mathematical changes produce one recoverable step;
view and selection changes do not add mathematical history. Intermediate bindings
remain private, and queries never save them. Query readbacks describe the value
passed to the query, which can differ from the saved result.

History, panel, and audio controls must be the only call in their program. The
interpretation validator lowers these to existing controls so problem history
and UI ownership remain unchanged. Controls cannot be suggestions or corrections.

The AI response schema adds `program`; new model output leaves legacy `command`
and `commands` empty. Validated programs use a `typescript\n` marker internally
inside the existing command field for storage and replay. Progressive graph
records also contain programs. Groups containing programs use a checked JSON
array under a `command-group\n` marker so source semicolons remain intact.
This is transport
encoding, not a second agent-authored AST. Old English steps remain replayable.
Explanations can suggest a program without applying it. Confirmation checks the
existing workspace key; corrections run against the restored pre-turn problem.
Server saves retain their revision compare-and-swap and idempotent request IDs.

Programs are limited to 1,800 source characters, 32 statements, 24 calls, and 32
levels of expression nesting. Existing engine limits remain in force, including
2–100 data observations.
Syntax and operation failures include source locations. Deterministic tests and
mocked provider tests exercise the interface; they do not establish live-provider
accuracy or dyslexic-student usability.

Named geometry uses `geometry.construct(source)`, `geometry.extend(value, source)`,
`geometry.editObject(value, name, expression)` and `geometry.inspect(value, name)`.
The additional geometry vocabulary is sent only for relevant requests or an
active construction. Source is validated completely before a saved change or
preview is returned; dependency edits recheck every relationship. The
[visuals module](../visuals/README.md) describes the renderer and numerical scope.

Core graph scenes use `graph.scene(string[])`, `graph.name(value,name)` and
`graph.domain(value,min,max)`. Current/select accept a row number or unique name;
add/edit/remove validate all definitions together. `graph.point(value,t)` queries
a curve, and `graph.testPoint(value,x,y)` checks a relation. The additional
vocabulary in `config/graph-scene-instructions.ts` is selected locally for relevant
requests or active scenes, without an extra provider call. Existing explicit
curves retain their analysis tools; extended scenes reject unsupported legacy
analysis. See the capability document for syntax, examples and numerical limits.
