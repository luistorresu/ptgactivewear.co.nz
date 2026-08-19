import { chromium } from 'file:///C:/Users/Nico/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const origin = process.env.PTG_TEST_ORIGIN || 'http://127.0.0.1:8790';
const output = process.env.PTG_TEST_OUTPUT || `${process.env.LOCALAPPDATA}/ptg-promotion-visual`;
const cart = [{
  id: 'patagonia-fc-performance-tracksuit',
  name: 'Patagonia FC Performance Tracksuit',
  basePrice: 115,
  price: 115,
  qty: 1,
  variantId: 2,
  variant: '',
  size: 'XS',
  personalisation: { name: '', number: '' },
  personalisationPrices: { name: 0, number: 0 }
}];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PTG_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
});
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${origin}/cart`, { waitUntil: 'networkidle' });
    await page.evaluate(value => {
      localStorage.setItem('ptg-cart', JSON.stringify(value));
      localStorage.setItem('ptg-fulfilment', 'pickup');
    }, cart);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Return to Cart' }).click();
    await page.locator('#discount-code').fill('spring');
    await page.locator('[data-promotion-apply]').click();
    await page.getByText('SPRING applied. You saved $23.00.').waitFor();
    const total = await page.locator('#cart-total').textContent();
    if (!String(total).includes('92.00')) throw new Error(`${viewport.name} total was ${total}`);
    await page.locator('[data-promotion-status]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}-${viewport.name}.png` });
    const bodyWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    if (bodyWidth.scroll > bodyWidth.client) throw new Error(`${viewport.name} has horizontal overflow.`);
    await page.close();
  }
  for (const theme of ['dark', 'sky']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/cart`, { waitUntil: 'networkidle' });
    await page.evaluate(({ cartValue, themeValue }) => {
      localStorage.setItem('ptg-cart', JSON.stringify(cartValue));
      localStorage.setItem('ptg-fulfilment', 'pickup');
      localStorage.setItem('ptg-theme', themeValue);
    }, { cartValue: cart, themeValue: theme });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Return to Cart' }).click();
    await page.locator('#discount-code').fill('SPRING');
    await page.locator('[data-promotion-apply]').click();
    await page.getByText('SPRING applied. You saved $23.00.').waitFor();
    await page.locator('[data-promotion-status]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}-${theme}.png` });
    await page.close();
  }
  process.stdout.write('Promotion cart visual checks passed on desktop and mobile.\n');
} finally {
  await browser.close();
}
