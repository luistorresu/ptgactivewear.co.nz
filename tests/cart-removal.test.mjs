import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('cart items expose a clear accessible removal action', async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL('js/main.js', root), 'utf8'),
    readFile(new URL('css/style.css', root), 'utf8')
  ]);

  assert.match(script, /data-remove-cart-item=/);
  assert.match(script, /aria-label="Remove \$\{escapeHtml\(item\.name\)\} from cart"/);
  assert.match(script, /<span>Remove<\/span>/);
  assert.match(script, /removed from cart/);
  assert.match(script, /localStorage\.setItem\('ptg-cart'/);
  assert.match(script, /cart\.splice\(index, 1\)/);
  assert.match(styles, /\.cart-remove-button/);
  assert.match(styles, /html\[data-theme="dark"\] \.cart-remove-button/);
  assert.match(styles, /#cart-items\s*\{[\s\S]*?flex: 0 0 auto !important/);
  assert.match(styles, /#cart-sidebar\s*\{[\s\S]*?overflow-y: auto/);
});
