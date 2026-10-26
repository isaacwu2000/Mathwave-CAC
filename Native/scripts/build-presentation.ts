import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const root = resolve(import.meta.dirname, "../..");
const webRequire = createRequire(resolve(root, "Web/package.json"));
const out = resolve(root, "Native/Sources/MathAudioApp/Resources/Presentation");
await mkdir(out, { recursive: true });
await build({
  bundle: true,
  jsx: "automatic",
  entryPoints: [resolve(root, "Native/Presentation/entry.tsx")],
  outfile: resolve(out, "presentation.js"),
  plugins: [
    {
      name: "workspace-react",
      setup(build) {
        build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
          path: webRequire.resolve(args.path),
        }));
      },
    },
  ],
  platform: "browser",
  target: "es2022",
  format: "iife",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  assetNames: "[name]-[hash]",
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".otf": "file" },
});
// Compile the same Web stylesheet, including the renderer's positioning utilities.
// Without those utilities the canvas measures its own growing content instead of its viewport.
const pluginPath = webRequire.resolve("@tailwindcss/postcss");
const { default: tailwind } = await import(pluginPath);
const { default: postcss } = await import(webRequire.resolve("postcss"));
const from = resolve(root, "Web/app/globals.css");
const compiled = await postcss([tailwind({ base: resolve(root, "Web") })]).process(
  await readFile(from, "utf8"),
  { from },
);
await writeFile(resolve(out, "shared.css"), compiled.css.replaceAll("/fonts/", "fonts/"));
await cp(resolve(root, "Web/public/fonts"), resolve(out, "fonts"), { recursive: true });
await writeFile(
  resolve(out, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' file:; style-src 'self' file: 'unsafe-inline'; font-src 'self' file: data:; img-src 'self' file: data: blob:; connect-src 'none'"><link rel="stylesheet" href="shared.css"><link rel="stylesheet" href="presentation.css"></head><body><div id="root"></div><script src="presentation.js"></script></body></html>`,
);

for (const name of ["react", "react-dom", "mathlive", "three"]) {
  const license = resolve(root, "Web/node_modules", name, "LICENSE");
  try {
    await cp(license, resolve(out, name + "-LICENSE.txt"));
  } catch {
    await cp(
      resolve(root, "Web/node_modules", name, "LICENSE.txt"),
      resolve(out, name + "-LICENSE.txt"),
    );
  }
}
