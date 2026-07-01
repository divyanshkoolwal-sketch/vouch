// Bundle the two entry points into single, dependency-free CJS files in dist/.
// Bundling means the installed plugin needs no `npm install` at runtime — node
// runs dist/*.js directly. CJS (not ESM) avoids module-resolution fragility
// across the varied contexts a plugin gets executed in.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logLevel: 'info',
  sourcemap: false,
};

await build({ ...common, entryPoints: ['src/mcp.ts'], outfile: 'dist/mcp.js' });
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' });
await build({ ...common, entryPoints: ['src/eval/run.ts'], outfile: 'dist/eval.js' });
console.log('vouch: built dist/mcp.js, dist/cli.js, dist/eval.js');
