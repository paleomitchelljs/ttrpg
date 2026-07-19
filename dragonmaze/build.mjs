// Single-file build: bundle src/main.js with esbuild, inline the JS + CSS
// into index.html, write dist/dragon.html. The result runs from file://
// (double-click), which raw ES modules cannot.

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
});
const js = result.outputFiles[0].text;
const css = await readFile(join(root, 'styles.css'), 'utf8');
let html = await readFile(join(root, 'index.html'), 'utf8');

const withCss = html.replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`);
let withJs = withCss.replace(
  /<script type="module" src="\.\/src\/main\.js"><\/script>/,
  () => `<script>\n${js}\n</script>`
);
if (withCss === html || withJs === withCss) {
  throw new Error('Inline markers not found in index.html — build aborted.');
}

// Inline image assets as data URIs so the single file needs nothing else.
for (const rel of ['assets/dragon-side.png', 'assets/dragon-fire.png']) {
  const data = await readFile(join(root, rel));
  const uri = `data:image/png;base64,${data.toString('base64')}`;
  withJs = withJs.replaceAll(`./${rel}`, uri);
}

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/dragon.html'), withJs);
console.log(`dist/dragon.html written (${(withJs.length / 1024).toFixed(1)} kB)`);

// Keep the copy served by the parent portal app in sync.
try {
  await writeFile(join(root, '../public/dragon.html'), withJs);
  console.log('also synced to ../public/dragon.html');
} catch {
  // No parent public/ dir (standalone checkout) — dist copy is enough.
}
