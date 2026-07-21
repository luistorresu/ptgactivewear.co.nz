import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const publicPages = ['index.html', 'shop.html', 'product.html', 'about.html', 'contact.html', 'cart.html', 'order-success.html'];

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => Number.parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('every public page restores and exposes the three themes before styles render', async () => {
  for (const page of publicPages) {
    const html = await source(page);
    assert.ok(html.includes('<script src="/js/theme.js"></script>'), `${page} loads the theme bootstrap`);
    assert.ok(html.indexOf('/js/theme.js') < html.indexOf('css/style.css'), `${page} restores the theme before CSS`);
    assert.match(html, /data-theme-select aria-label="Website theme"/);
    assert.match(html, /value="light">Light<\/option>.*value="dark">Dark<\/option>.*value="sky">Sky Blue<\/option>/s);
    assert.match(html, /data-theme-logo/);
  }
});

test('theme storage accepts only approved values and safely defaults to Light', async () => {
  const javascript = await source('js/theme.js');
  assert.match(javascript, /STORAGE_KEY = 'ptg-theme'/);
  assert.match(javascript, /new Set\(\['light', 'dark', 'sky'\]\)/);
  assert.match(javascript, /THEMES\.has\(value\) \? value : 'light'/);
  assert.match(javascript, /savedTheme\(\) \|\| 'light'/);
  assert.match(javascript, /addEventListener\('storage'/);
  assert.doesNotMatch(await source('admin/index.html'), /theme\.js|data-theme-select/);
});

test('theme tokens cover public surfaces and retain AA text contrast', async () => {
  const css = await source('css/style.css');
  for (const token of ['page-background', 'surface-background', 'surface-secondary', 'text-primary', 'text-secondary', 'border-color', 'brand-primary', 'brand-secondary', 'button-primary', 'button-primary-text', 'link-color', 'focus-color', 'header-background', 'footer-background']) {
    assert.match(css, new RegExp(`--${token}:`));
  }
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /html\[data-theme="sky"\]/);
  assert.match(css, /\.product-lightbox-image\s*\{[^}]*grid-column:\s*2/s);

  const pairs = [
    ['#111827', '#ffffff'], ['#ffffff', '#197997'], ['#176f8d', '#ffffff'],
    ['#f7fafc', '#0b1117'], ['#08141a', '#72d2eb'], ['#bac7d1', '#0b1117'],
    ['#102532', '#dff3fa'], ['#ffffff', '#126f8d'], ['#425e6d', '#dff3fa']
  ];
  for (const [foreground, background] of pairs) assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background} meets AA`);
});
