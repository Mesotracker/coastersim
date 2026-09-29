import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const distIndex = resolve(dist, 'index.html');
let html = await readFile(distIndex, 'utf8');

// Inline every Vite-emitted stylesheet and ES module. The resulting document
// has no network or package-manager dependency and can be opened from file://.
const stylesheetPattern = /<link\s+rel="stylesheet"\s+crossorigin\s+href="([^"]+)"\s*\/?>/g;
for (const match of [...html.matchAll(stylesheetPattern)]) {
  const href = match[1];
  const css = await readFile(resolve(dist, href.replace(/^\.\//, '')), 'utf8');
  html = html.replace(match[0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
}

const modulePattern = /<script\s+type="module"\s+crossorigin\s+src="([^"]+)"\s*><\/script>/g;
for (const match of [...html.matchAll(modulePattern)]) {
  const src = match[1];
  const js = await readFile(resolve(dist, src.replace(/^\.\//, '')), 'utf8');
  html = html.replace(match[0], () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
}

html = html
  .replace(/<link\s+rel="modulepreload"[^>]*>/g, '')
  .replace('</head>', '  <meta name="application-name" content="Coaster Forge Platinum" />\n  <meta name="theme-color" content="#0b0e13" />\n</head>');

await writeFile(distIndex, html);
await writeFile(resolve(root, 'coaster-forge.html'), html);
await rm(resolve(dist, 'assets'), { recursive: true, force: true });

const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`Standalone build: coaster-forge.html (${kb.toLocaleString()} KiB, one file)`);
