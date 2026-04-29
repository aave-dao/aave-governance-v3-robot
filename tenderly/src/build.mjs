// Bundle the Tenderly action entry into a single CJS file using esbuild.
//
// We bundle (not compile) because @bgd-labs/toolbox is ESM-only. esbuild flattens
// the ESM/CJS interop and also resolves relative TS imports without needing `.js`
// extensions in source. Output goes to `out/tenderly/index.js`, which is the path
// Tenderly's runtime expects given the function paths in tenderly.yaml.

import { build } from "esbuild";

const externals = [
  // The Tenderly runtime provides this — keep it external so the cloud bundle uses
  // the runtime's copy and not whatever version we shipped.
  "@tenderly/actions",
];

await build({
  entryPoints: ["./tenderly/index.ts"],
  outfile: "./out/tenderly/index.js",
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: true,
  external: externals,
  // Suppress noisy "this is undefined at top level" warnings from CJS interop wrappers.
  logLevel: "info",
});

console.log("build: src/out/tenderly/index.js");
