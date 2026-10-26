import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

const layers = [
  'types',
  'config',
  'repo',
  'services',
  'runtime',
  'hooks',
  'ui',
];
export const moduleEntries: Record<string, string[]> = {
  accounts: ['index.ts', 'server.ts', 'ui.ts'],
  diagnostics: ['index.ts'],
  math: ['index.ts', 'ui.ts'],
  commands: ['index.ts'],
  problems: ['index.ts', 'server.ts', 'server/cloud-api.ts'],
  visuals: ['index.ts', 'ui.ts'],
  voice: ['index.ts', 'ui.ts'],
  ai: ['index.ts', 'server.ts'],
  workspace: ['index.ts', 'state.ts', 'ui.ts'],
};
type Location = { module: string; path: string; layer?: string };
type Edge = { target: string; typeOnly: boolean };

/** Checks a complete source graph without loading application or environment code.
 * Returns diagnostics; source files are explicit inputs.
 */
export function checkModuleGraph(
  root: string,
  files: Map<string, string>,
): string[] {
  const errors = new Set<string>();
  const graph = new Map<string, Edge[]>();
  const clients = new Set<string>();
  const serverFiles = new Set<string>();
  const modules = resolve(root, 'src/modules');
  function location(file: string): Location | undefined {
    const [module, ...parts] = relative(modules, file).split('/');
    if (module === '..' || !module) return;
    const path = parts.join('/');
    const first = parts[0]?.replace(/\.(?:ts|tsx)$/, '');
    return { module, path, layer: layers.includes(first) ? first : undefined };
  }
  function report(file: string, message: string) {
    errors.add(`${relative(root, file)}: ${message}`);
  }
  for (const [file, code] of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const owner = location(file);
    const test = /\.test\.tsx?$/.test(file);
    if (owner && !moduleEntries[owner.module])
      report(file, `undeclared module ${owner.module}`);
    const source = ts.createSourceFile(
      file,
      code,
      ts.ScriptTarget.Latest,
      true,
    );
    if (
      !test &&
      owner?.layer === 'types' &&
      source.statements.some(
        (node) =>
          !ts.isTypeAliasDeclaration(node) &&
          !ts.isInterfaceDeclaration(node) &&
          !ts.isImportDeclaration(node) &&
          !ts.isExportDeclaration(node) &&
          !ts.isEmptyStatement(node),
      )
    )
      report(
        file,
        'types may contain only contracts and type-only imports/exports',
      );
    const edges: Edge[] = [];
    graph.set(file, edges);
    if (
      source.statements.some(
        (node) =>
          ts.isExpressionStatement(node) &&
          ts.isStringLiteral(node.expression) &&
          node.expression.text === 'use client',
      )
    )
      clients.add(file);
    if (!test && (owner?.layer === 'hooks' || owner?.layer === 'ui'))
      clients.add(file);
    if (owner?.path === 'server.ts' || owner?.path.startsWith('server/'))
      serverFiles.add(file);
    if (
      !test &&
      owner &&
      !owner.layer &&
      !moduleEntries[owner.module]?.includes(owner.path)
    ) {
      report(file, 'implementation must belong to a declared layer');
    }
    function check(spec: string, typeOnly: boolean) {
      if (!test && owner?.layer === 'types' && !typeOnly)
        report(file, 'types must use type-only imports');
      if (
        !test &&
        !typeOnly &&
        owner?.layer &&
        ['types', 'config', 'repo', 'services'].includes(owner.layer) &&
        (spec === 'react' || spec.startsWith('react/'))
      )
        report(file, `${owner.layer} cannot load ${spec}`);
      if (
        spec === 'cloudflare:workers' ||
        spec === 'server-only' ||
        spec === '@neondatabase/serverless' ||
        spec.startsWith('node:')
      ) {
        if (!typeOnly) serverFiles.add(file);
      }
      if (
        !test &&
        !typeOnly &&
        owner?.layer &&
        ['types', 'config', 'services'].includes(owner.layer) &&
        (spec === 'react' ||
          spec.startsWith('react/') ||
          spec === 'cloudflare:workers' ||
          spec === '@neondatabase/serverless' ||
          spec.startsWith('node:'))
      )
        report(file, `${owner.layer} cannot load ${spec}`);
      if (!spec.startsWith('.') && !spec.startsWith('@/')) return;
      const base = spec.startsWith('@/')
        ? resolve(root, 'src', spec.slice(2))
        : resolve(dirname(file), spec);
      const target = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        resolve(base, 'index.ts'),
        resolve(base, 'index.tsx'),
      ].find((candidate) => files.has(candidate));
      // Styles, assets and ambient modules are checked by the compiler/build.
      if (!target) {
        if (!/\.(?:css|svg|png|jpg|json)$/.test(spec))
          report(file, `unresolved ${spec}`);
        return;
      }
      edges.push({ target, typeOnly });
      const destination = location(target);
      if (!destination) return;
      if (owner?.module !== destination.module) {
        if (!moduleEntries[destination.module]?.includes(destination.path))
          report(
            file,
            `import ${destination.module} through a declared public entry (${spec})`,
          );
      } else if (!test) {
        if (
          moduleEntries[owner.module]?.includes(destination.path) &&
          owner.layer
        )
          report(
            file,
            'import local implementation directly instead of its public entry',
          );
        if (
          owner.layer &&
          destination.layer &&
          layers.indexOf(destination.layer) > layers.indexOf(owner.layer)
        )
          report(
            file,
            `${owner.layer} cannot import ${destination.layer} (${spec})`,
          );
      }
    }
    function visit(node: ts.Node) {
      if (
        !test &&
        owner?.layer &&
        ['types', 'config', 'services'].includes(owner.layer) &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'fetch'
      )
        report(
          file,
          `${owner.layer} cannot call global fetch; pass a transport adapter`,
        );
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const clause = node.importClause;
        const named = clause?.namedBindings;
        const typeOnly =
          clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
          (!!named &&
            ts.isNamedImports(named) &&
            !clause?.name &&
            named.elements.length > 0 &&
            named.elements.every((item) => item.isTypeOnly));
        check(node.moduleSpecifier.text, typeOnly);
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const named = node.exportClause;
        check(
          node.moduleSpecifier.text,
          node.isTypeOnly ||
            (!!named &&
              ts.isNamedExports(named) &&
              named.elements.length > 0 &&
              named.elements.every((item) => item.isTypeOnly)),
        );
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        check(node.arguments[0].text, false);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        check(node.argument.literal.text, true);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const client of clients) {
    const seen = new Set<string>();
    function walk(file: string, path: string[]) {
      if (seen.has(file)) return;
      seen.add(file);
      if (serverFiles.has(file)) {
        report(
          client,
          `browser code reaches server code: ${path.map((item) => relative(root, item)).join(' → ')}`,
        );
        return;
      }
      for (const edge of graph.get(file) ?? [])
        if (!edge.typeOnly) walk(edge.target, [...path, edge.target]);
    }
    walk(client, [client]);
  }
  return [...errors];
}
