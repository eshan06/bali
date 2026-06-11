import { build } from 'esbuild';

await build({
  entryPoints: ['src/router.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/router.js',
  format: 'cjs',
  external: ['pg-native'],
  sourcemap: true,
  minify: true,
});

console.log('Lambda bundle built: dist/router.js');
