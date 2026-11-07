import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const EMAIL = 'eshan.shah@vanderbilt.edu';
const JONATHAN = 'jonathan.n.bani-esraili@vanderbilt.edu';
// Each page: its path, its title and its heading.
const PAGES = [
  ['/', 'Bali: Lock the phone. Train the mind.', 'Lock the phone. Train the mind.'],
  ['/guides/first-class', 'Run your first class with Bali · Bali', 'Run your first class with Bali.'],
  ['/guides/emergency-unlock', 'Emergency Unlock, explained · Bali', 'Emergency Unlock, explained.'],
  ['/guides/families', 'A note for families · Bali', 'A note for families.'],
  ['/research', 'What the research says about phones in class · Bali', 'What the research says about phones in class.'],
  ['/compare', 'How schools keep phones out of class · Bali', 'How schools keep phones out of class.'],
  ['/phone-laws', 'Phone laws by state · Bali', 'Phone laws by state.'],
];
const PATHS = PAGES.map(([path]) => path);
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

const test = base.extend({
  // Every test fails on a page error or a console error, which includes anything the security policy blocks.
  page: async ({ page }, use) => {
    const problems = [];
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text()}`);
    });
    await page.addInitScript(() =>
      document.addEventListener('securitypolicyviolation', (e) => console.error(`blocked by the security policy: ${e.violatedDirective} ${e.blockedURI}`)),
    );
    await use(page);
    expect(problems, 'errors on the page').toEqual([]);
  },
});

const open = async (page, path) => {
  const response = await page.goto(path);
  await expect(page.locator('html')).toHaveClass(/is-drawn/);
  return response;
};

for (const [path, title, heading] of PAGES) {
  test(`${path} draws, with its title and heading`, async ({ page }) => {
    await open(page, path);
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  });
}

test('nothing scrolls sideways', async ({ page }) => {
  test.setTimeout(120_000);
  const size = page.viewportSize();
  const widths = size.width < 768 ? [size.width, 320] : [size.width];
  for (const width of widths) {
    await page.setViewportSize({ width, height: size.height });
    for (const path of PATHS) {
      await open(page, path);
      for (const at of [0, 0.5, 1]) {
        await page.evaluate((f) => scrollTo(0, document.documentElement.scrollHeight * f), at);
        const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        expect(scrollWidth, `${path} at ${width}px, ${at * 100}% down`).toBeLessThanOrEqual(innerWidth);
      }
    }
  }
});

test('an address with a section opens at that section, from any page', async ({ page }) => {
  await open(page, '/#mission');
  await expect(page.locator('#mission')).toBeInViewport();
  await open(page, '/research');
  await page.locator('footer').getByRole('link', { name: 'Our mission' }).click();
  await expect(page).toHaveURL(/\/#mission$/);
  await expect(page.locator('html')).toHaveClass(/is-drawn/);
  await expect(page.locator('#mission')).toBeInViewport();
});

test('every link goes somewhere real', async ({ page }) => {
  test.setTimeout(90_000);
  const ids = {};
  const links = {};
  for (const path of PATHS) {
    await open(page, path);
    ids[path] = await page.evaluate(() => [...document.querySelectorAll('[id]')].map((el) => el.id));
    // Links inside a product picture are part of the drawing: the picture is inert.
    links[path] = await page.locator('a[href]').evaluateAll((as) => as.filter((a) => !a.closest('[inert]')).map((a) => a.getAttribute('href')));
  }
  for (const [path, hrefs] of Object.entries(links)) {
    expect(hrefs.length, path).toBeGreaterThan(10);
    for (const href of hrefs) {
      if (href.startsWith('#')) expect(ids[path], `${path}: ${href}`).toContain(href.slice(1));
      else if (href.startsWith('/')) {
        const [to, hash] = href.split('#');
        expect(PATHS, `${path}: ${href}`).toContain(to);
        if (hash !== undefined) expect(ids[to], `${path}: ${href}`).toContain(hash);
      } else expect(href, path).toMatch(/^https:\/\/[a-z0-9.-]+\/|^mailto:(eshan\.shah|jonathan\.n\.bani-esraili)@vanderbilt\.edu$/);
    }
  }
  await open(page, '/');
  for (const address of [EMAIL, JONATHAN]) await expect(page.getByRole('link', { name: address })).toHaveAttribute('href', `mailto:${address}`);
});

test('the old addresses lead to real pages', async ({ page }) => {
  for (const { source, destination } of vercel.redirects) {
    if (!destination.startsWith('/')) {
      expect(destination, source).toMatch(/^https:\/\/bali-portal\.vercel\.app\/[a-z]+$/);
      continue;
    }
    // On the deployed site Vercel sends the old address on; served locally, the new one opens directly.
    await open(page, process.env.BASE_URL ? source : destination);
    const [to, hash] = destination.split('#');
    expect(new URL(page.url()).pathname, source).toBe(to);
    if (hash) await expect(page.locator(`#${hash}`), source).toHaveCount(1);
  }
});

test('Copy address copies it, says so, and leaves the rest of the page as it was', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium lets a test grant clipboard access');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, '/');
  // Scroll down the page once, so every block has risen in and each picture has its size.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
  });
  await expect(page.locator('[data-reveal]:not([data-in])')).toHaveCount(0);
  await page.evaluate(() => { document.querySelector('.bs-hero-art').kept = true; });
  for (const address of [EMAIL, JONATHAN]) {
    const button = page.getByRole('button', { name: `Copy address ${address}` });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(page.getByRole('button', { name: `Copied ${address}` })).toBeVisible();
    await expect(page.locator('.bs-contact [aria-live]')).toHaveText('Email address copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  }
  // Saying so redraws the page: what was on screen before stays, risen in and at its size.
  await expect(page.locator('[data-reveal]:not([data-in])')).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector('.bs-hero-art').kept)).toBe(true);
  for (const fit of await page.locator('.bs-fit').all()) await expect(fit).toHaveAttribute('style', /--k:/);
  // And the button says Copy address again.
  await expect(page.getByRole('button', { name: `Copy address ${JONATHAN}` })).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.bs-contact [aria-live]')).toHaveText('');
});

test('a copy that fails says so, and the address stays on screen', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } }),
  );
  await open(page, '/');
  const button = page.getByRole('button', { name: `Copy address ${JONATHAN}` });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByRole('button', { name: `Couldn’t copy ${JONATHAN}` })).toBeVisible();
  await expect(page.locator('.bs-contact [aria-live]')).toHaveText('Couldn’t copy. The address is shown above.');
  await expect(page.getByRole('link', { name: JONATHAN })).toBeVisible();
});

test('the questions open', async ({ page }) => {
  await open(page, '/');
  const question = page.getByText('Does it work without Wi-Fi?');
  await question.scrollIntoViewIfNeeded();
  await question.click();
  await expect(page.getByText('A tap locks the apps right away with no signal')).toBeVisible();
});

test('with Reduce Motion nothing moves and every block shows', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of PATHS) {
    await open(page, path);
    // The block's tap waits a beat before it starts, when it starts at all.
    await page.waitForTimeout(400);
    const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.effect?.target?.className?.baseVal || a.effect?.target?.className || 'animation'));
    expect(moving, path).toEqual([]);
    for (const block of await page.locator('[data-reveal]').all()) await expect(block, path).toHaveCSS('opacity', '1');
  }
});

// The page is drawn by a script; if that can't run, the page says so and how to reach us.
base('a page whose drawing fails to load says so', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/boards.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.DCB = {};' }));
  await page.goto('/');
  await expect(page.locator('#app')).toHaveText("This page didn't load. Refresh to try again, or email eshan.shah@vanderbilt.edu.");
  expect(errors).toEqual(['No board Main.dc.html']);
});

test('no serious accessibility problems', async ({ page }) => {
  test.setTimeout(120_000);
  // Reduce Motion holds every page still, so nothing is caught halfway through rising in.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of PATHS) {
    await open(page, path);
    // The big step numbers on the home page and in the guide (01, 02, …) are drawn faint on purpose and
    // hidden from screen readers: decoration, which WCAG's contrast rule leaves out.
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('.bs-step-n').exclude('.pg-step-n').analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${path} ${v.id}: ${v.nodes.length} × ${v.nodes[0].target.join(' ')}`)).toEqual([]);
  }
});

test('the security policy is sent with every page', async ({ page }) => {
  for (const path of PATHS) {
    const csp = (await open(page, path)).headers()['content-security-policy'];
    expect(csp, path).toContain("script-src 'self';");
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).not.toContain('unsafe-eval');
  }
});
