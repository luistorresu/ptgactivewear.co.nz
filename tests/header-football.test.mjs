import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('public header creates one decorative local football without touching admin', async () => {
  const javascript = await source('js/theme.js');
  assert.match(javascript, /header\.querySelector\('\.floating-football-animation'\)/);
  assert.match(javascript, /stage\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(javascript, /ball\.alt = ''/);
  assert.match(javascript, /ball\.src = '\/assets\/images\/soccer-ball\.svg'/);
  assert.match(javascript, /header\.append\(stage\)/);
  assert.match(javascript, /document\.addEventListener\('visibilitychange'/);
  assert.doesNotMatch(await source('admin/index.html'), /header-football|soccer-ball/);
});

test('football SVG is compact, local, scalable and free of third-party branding', async () => {
  const svgPath = new URL('assets/images/soccer-ball.svg', root);
  const svg = await readFile(svgPath, 'utf8');
  const details = await stat(svgPath);
  assert.ok(details.size < 8 * 1024, `SVG is ${details.size} bytes`);
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /radialGradient/);
  assert.match(svg, /clipPath/);
  assert.doesNotMatch(svg, /<script|logo|sponsor|manufacturer/i);
  assert.doesNotMatch(svg, /(?:href|src)=["']https?:/i);
});

test('football uses slow randomized header motion, responsive sizing and reduced-motion safety', async () => {
  const javascript = await source('js/theme.js');
  const css = await source('css/style.css');
  assert.match(css, /\.floating-football-animation\s*\{[^}]*position:\s*absolute[^}]*pointer-events:\s*none/s);
  assert.match(javascript, /Array\.from\(\{ length: 7 \}, randomPoint\)/);
  assert.match(javascript, /duration:\s*36000 \+ Math\.random\(\) \* 12000/);
  assert.match(javascript, /translate3d\([^`]+rotate\(/);
  assert.match(javascript, /stage\.clientWidth - size - padding/);
  assert.match(javascript, /stage\.clientHeight - size - padding/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*--football-size:\s*26px/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*--football-size:\s*22px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.floating-football-animation\s*\{\s*display:\s*none/);
});
