import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('public header creates one decorative local football without touching admin', async () => {
  const javascript = await source('js/theme.js');
  assert.match(javascript, /header\.querySelector\('\.header-football-animation'\)/);
  assert.match(javascript, /lane\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(javascript, /ball\.alt = ''/);
  assert.match(javascript, /ball\.src = '\/assets\/images\/soccer-ball\.svg'/);
  assert.match(javascript, /header\.insertBefore\(lane, mobileMenu \|\| null\)/);
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

test('football animation is transform-only, responsive and motion-safe', async () => {
  const css = await source('css/style.css');
  assert.match(css, /\.header-football-animation\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /--football-duration:\s*14s/);
  assert.match(css, /@keyframes headerFootballTravel[\s\S]*translate3d/);
  assert.match(css, /@keyframes headerFootballRoll[\s\S]*rotate\(720deg\)/);
  assert.doesNotMatch(css.match(/@keyframes headerFootballTravel[\s\S]*?\n\}/)?.[0] || '', /\b(?:top|left|width|height)\s*:/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*--football-size:\s*30px/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*--football-size:\s*24px/);
  assert.match(css, /@media \(max-width: 340px\)[\s\S]*display:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.header-football-runner[\s\S]*animation:\s*none/);
});
