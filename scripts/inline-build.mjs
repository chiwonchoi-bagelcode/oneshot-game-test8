// Inline the built JS/CSS into a single self-contained HTML file so the game
// can be opened straight from disk (file://) or hosted anywhere as one page.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = existsSync(join(dist, 'assets')) ? readdirSync(join(dist, 'assets')) : [];
for (const f of assets) {
  const p = join(dist, 'assets', f);
  if (f.endsWith('.js')) {
    const code = readFileSync(p, 'utf8').replace(/<\/script/g, '<\\/script');
    html = html.replace(new RegExp(`<script[^>]*src="\\./assets/${f.replace('.', '\\.')}"[^>]*></script>`), () => `<script type="module">${code}</script>`);
  } else if (f.endsWith('.css')) {
    const css = readFileSync(p, 'utf8');
    html = html.replace(new RegExp(`<link[^>]*href="\\./assets/${f.replace('.', '\\.')}"[^>]*>`), () => `<style>${css}</style>`);
  }
}
if (/src="\.\/assets\//.test(html) || /href="\.\/assets\//.test(html)) {
  console.error('inline-build: some assets were not inlined');
  process.exit(1);
}
mkdirSync('docs', { recursive: true });
writeFileSync(join('docs', 'index.html'), html);
console.log(`inline-build: docs/index.html (${(html.length / 1024).toFixed(0)} KB)`);
