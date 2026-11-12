import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const EMAIL = 'team@getbali.app';
// Each page: its path, its title and its heading.
const PAGES = [
  ['/', "Bali: One tap locks a student's apps until the bell.", "One tap locks a student's apps until the bell."],
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

test('an address with a malformed #section still opens the page', async ({ page }) => {
  await open(page, '/#%E0%A4%A');
  await expect(page.getByRole('heading', { level: 1, name: PAGES[0][2] })).toBeVisible();
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
      if (href.startsWith('#')) expect(ids[path].filter((id) => id === href.slice(1)), `${path}: ${href}`).toHaveLength(1);
      else if (href.startsWith('/')) {
        const [to, hash] = href.split('#');
        expect(PATHS, `${path}: ${href}`).toContain(to);
        if (hash !== undefined) expect(ids[to].filter((id) => id === hash), `${path}: ${href}`).toHaveLength(1);
      } else expect(href, path).toMatch(/^https:\/\/[a-z0-9.-]+\/|^mailto:team@getbali\.app$/);
    }
  }
  await open(page, '/');
  // One address to write to, the team's.
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: EMAIL })).toHaveAttribute('href', `mailto:${EMAIL}`);
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
  // Bring each block into view until it has risen in, so every one has, and each picture has its size.
  for (const block of await page.locator('[data-reveal]').all()) {
    await block.scrollIntoViewIfNeeded();
    await expect(block).toHaveAttribute('data-in', '1');
  }
  await expect(page.locator('[data-reveal]:not([data-in])')).toHaveCount(0);
  await page.evaluate(() => { document.querySelector('.bs-hero-art').kept = true; });
  const button = page.getByRole('button', { name: `Copy address ${EMAIL}` });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByRole('button', { name: `Copied ${EMAIL}` })).toBeVisible();
  await expect(page.locator('.bs-contact [aria-live]')).toHaveText('Email address copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(EMAIL);
  // Saying so redraws the page: what was on screen before stays, risen in and at its size.
  await expect(page.locator('[data-reveal]:not([data-in])')).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector('.bs-hero-art').kept)).toBe(true);
  for (const fit of await page.locator('.bs-fit').all()) await expect(fit).toHaveAttribute('style', /--k:/);
  // And the button says Copy address again.
  await expect(page.getByRole('button', { name: `Copy address ${EMAIL}` })).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.bs-contact [aria-live]')).toHaveText('');
});

test('a copy that fails says so, and the address stays on screen', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } }),
  );
  await open(page, '/');
  const button = page.getByRole('button', { name: `Copy address ${EMAIL}` });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByRole('button', { name: `Couldn’t copy ${EMAIL}` })).toBeVisible();
  await expect(page.locator('.bs-contact [aria-live]')).toHaveText('Couldn’t copy. The address is shown above.');
  await expect(page.getByRole('link', { name: EMAIL })).toBeVisible();
});

test('the hero’s Bali block has no rings around it, at any width', async ({ page }) => {
  await open(page, '/');
  // On phones the hero shows the teacher's screen alone (the owner, 2026-11-11), so the block shows on wider screens.
  if (page.viewportSize().width >= 600) await expect(page.locator('.hs-block')).toBeVisible();
  await expect(page.locator('.hs-rings')).toHaveCount(0);
});

test('the words inside the pictures of the product can’t be selected, and the page’s own words can', async ({ page }) => {
  for (const path of ['/', '/guides/first-class', '/guides/emergency-unlock']) {
    await open(page, path);
    const found = await page.evaluate(() => {
      const how = (el) => { const s = getComputedStyle(el); return s.userSelect || s.webkitUserSelect; };
      const shots = [...document.querySelectorAll('.bs-shot')];
      const all = shots.concat(...shots.map((el) => [...el.querySelectorAll('*')]));
      return { shots: shots.length, selectable: all.filter((el) => how(el) !== 'none').length, heading: how(document.querySelector('main h1')) };
    });
    expect(found.shots, path).toBeGreaterThan(0);
    expect(found.selectable, path).toBe(0);
    expect(found.heading, path).not.toBe('none');
  }
});

test('a triple-click on a name in the hero’s picture selects nothing, and on the headline selects it', async ({ page }) => {
  await open(page, '/');
  await page.locator('.hs-card .hs-cname').click({ clickCount: 3 });
  expect(await page.evaluate(() => String(getSelection()))).toBe('');
  await page.locator('#h-hero').click({ clickCount: 3 });
  expect(await page.evaluate(() => String(getSelection()))).toContain('One tap locks');
});

test('narrower screens get a Menu: it opens, its links go where they say, and it closes on a choice', async ({ page }) => {
  await open(page, '/');
  const width = page.viewportSize().width;
  const summary = page.locator('.bs-menu > summary');
  if (width >= 1080) {
    await expect(summary).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    return;
  }
  const signIn = page.locator('.bs-end > .bs-btn-s');
  if (width < 600) await expect(signIn).toBeHidden();
  else await expect(signIn).toBeVisible();
  await summary.click();
  const panel = page.getByRole('navigation', { name: 'Sections' });
  await expect(panel.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', 'https://bali-portal.vercel.app/login');
  await expect(panel.getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides/first-class');
  await panel.getByRole('link', { name: 'Questions' }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#faq')).toBeInViewport();
  // Escape closes it and puts the focus back on Menu; so does a tap outside it.
  await summary.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(summary).toBeFocused();
  await summary.click();
  await expect(panel).toBeVisible();
  await page.locator('#faq h2').click();
  await expect(panel).toBeHidden();
});

test('on phones the hero shows the teacher’s screen on its own, large enough to read', async ({ page }) => {
  await open(page, '/');
  const cropped = () => page.locator('.hs').evaluate((el) => el.hasAttribute('data-crop'));
  if (page.viewportSize().width < 600) {
    expect(await cropped()).toBe(true);
    await expect(page.locator('.hs-phone')).toBeHidden();
    // The tiles' names draw at 11 px or more on the screen (about 11.7 px on a 375 px phone, 12.2 px at 390).
    const size = await page.locator('.hs-card .hs-nm').first().evaluate((el) => (parseFloat(getComputedStyle(el).fontSize) * el.getBoundingClientRect().width) / el.offsetWidth);
    expect(size).toBeGreaterThanOrEqual(11);
  } else {
    expect(await cropped()).toBe(false);
    await expect(page.locator('.hs-phone')).toBeVisible();
  }
});

test('a tablet or a narrow laptop keeps the whole hero picture; only a phone crops it', async ({ page }) => {
  for (const width of [600, 768, 1024, 1180]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, '/');
    expect(await page.locator('.hs').evaluate((el) => el.hasAttribute('data-crop')), `${width} px`).toBe(false);
    await expect(page.locator('.hs-block'), `${width} px`).toBeVisible();
    await expect(page.locator('.hs-phone'), `${width} px`).toBeVisible();
    // Below 1080 px the Menu takes the place of the section links, with Sign in still beside it.
    await expect(page.locator('.bs-menu > summary'), `${width} px`).toBeVisible({ visible: width < 1080 });
    await expect(page.locator('.bs-end > .bs-btn-s'), `${width} px`).toBeVisible();
  }
});

test('while a tile changes state, its old words are gone before its new ones come in', async ({ page }) => {
  await open(page, '/');
  const at = (ms) => page.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), ms);
  const opacity = (selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => Number(getComputedStyle(el).opacity)), selector);
  // The hero: Sofia's tile (data-i 4) turns from Not here to Focused between 3000 and 3150 ms of its class.
  await at(3075);
  expect(await opacity('.hs-tile[data-i="4"] .hs-t-not > *')).toEqual([0, 0]);
  const next = (await opacity('.hs-tile[data-i="4"] .hs-t-on'))[0];
  expect(next).toBeGreaterThan(0);
  expect(next).toBeLessThan(1);
  // The Emergency Unlock card: the teacher's tile turns from Focused to Unlocked between 1850 and 2000 ms.
  await at(1925);
  expect(await opacity('.bs-ut-on > *')).toEqual([0, 0]);
  const unlocked = (await opacity('.bs-ut-unl'))[0];
  expect(unlocked).toBeGreaterThan(0);
  expect(unlocked).toBeLessThan(1);
});

test('every page’s footer names Bali Focus Inc.', async ({ page }) => {
  for (const path of PATHS) {
    await open(page, path);
    await expect(page.locator('.bs-foot-bar')).toContainText('© 2026 Bali Focus Inc.');
  }
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

// A page that can't be drawn shows the state the canvas's SiteStates board draws, and Refresh tries again.
base('a page that didn’t load says so, and Refresh tries again', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/boards.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.DCB = {};' }));
  await page.goto('/#contact');
  await expect(page.getByRole('heading', { level: 1, name: 'This page didn’t load.' })).toBeVisible();
  await expect(page.locator('#app')).toContainText('Refresh to try again. If it still doesn’t load, email team@getbali.app.');
  await expect(page.getByRole('link', { name: EMAIL })).toHaveAttribute('href', `mailto:${EMAIL}`);
  expect(errors).toEqual(['No board Main.dc.html']);
  await page.unroute('**/boards.js');
  await page.getByRole('link', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/is-drawn/);
  // The same address again, its #section and all.
  await expect(page).toHaveURL(/\/#contact$/);
  await expect(page.locator('#contact')).toBeInViewport();
});

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });
  test('each page says it needs JavaScript, and how to reach us', async ({ page }) => {
    for (const path of PATHS) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'This page needs JavaScript.' }), path).toBeVisible();
      await expect(page.getByRole('link', { name: EMAIL }), path).toHaveAttribute('href', `mailto:${EMAIL}`);
    }
  });
});

// The runtime on its own, with two small boards in place of the site's.
const PROBE = [
  'window.DCB = {};',
  'window.DCB["Main.dc.html"] = { tpl: ' + JSON.stringify('<p class="p" data-x="{{x}}">{{label}}</p><span class="n">0</span><button type="button" data-dc-on-click="{{go}}">Go</button><dc-import name="Kid" n="{{n}}"></dc-import>') + ', helmet: "", heads: [], make: function (DCLogic) {',
  '  class Component extends DCLogic {',
  '    renderVals() { const s = this.state || {}; return { x: s.x || "a", label: s.label || "one", n: s.n || "1", go: () => { window.clicks = (window.clicks || 0) + 1; this.setState({ x: "b", label: "two", n: "2" }); } }; }',
  '  }',
  '  return Component;',
  '} };',
  'window.DCB["Kid.dc.html"] = { tpl: "<i>{{n}}</i>", helmet: "", heads: [], make: function (DCLogic) {',
  '  class Component extends DCLogic {',
  '    renderVals() { return { n: this.props.n }; }',
  '    componentDidMount() { (window.seen = window.seen || []).push("mount " + this.props.n); }',
  '    componentWillUnmount() { window.seen.push("unmount " + this.props.n); }',
  '  }',
  '  return Component;',
  '} };',
].join('\n');

test('a redraw keeps what components set, changes what the drawing changed, and remounts a board only for new props', async ({ page }) => {
  await page.route('**/boards.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: PROBE }));
  await open(page, '/');
  // What a component sets after drawing: a property, an attribute, and a count it writes itself.
  await page.evaluate(() => {
    const p = document.querySelector('p.p');
    p.kept = true;
    p.dataset.in = '1';
    document.querySelector('span.n').textContent = '42';
  });
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('p.p')).toHaveText('two');
  await expect(page.locator('p.p')).toHaveAttribute('data-x', 'b');
  const after = () => page.evaluate(() => ({ kept: document.querySelector('p.p').kept, in: document.querySelector('p.p').dataset.in, count: document.querySelector('span.n').textContent, kid: document.querySelector('i').textContent, seen: window.seen, clicks: window.clicks }));
  expect(await after()).toEqual({ kept: true, in: '1', count: '42', kid: '2', seen: ['mount 1', 'unmount 1', 'mount 2'], clicks: 1 });
  // The same props again: the imported board stays, and the button's handler was swapped, not added.
  await page.getByRole('button', { name: 'Go' }).click();
  await expect.poll(() => page.evaluate(() => window.clicks)).toBe(2);
  expect(await after()).toEqual({ kept: true, in: '1', count: '42', kid: '2', seen: ['mount 1', 'unmount 1', 'mount 2'], clicks: 2 });
});

test('no serious accessibility problems', async ({ page }) => {
  test.setTimeout(120_000);
  // Reduce Motion holds every page still, so nothing is caught halfway through rising in.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of PATHS) {
    await open(page, path);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
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
