import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';

const EMAIL = 'eshan.shah@vanderbilt.edu';
const JONATHAN = 'jonathan.n.bani-esraili@vanderbilt.edu';
const PLAYER = 'https://www.youtube-nocookie.com/embed/iLtbApxTNTA?autoplay=1&rel=0';

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
  // YouTube stays offline: its player is stood in for, and the test sees every request made to it.
  youtube: async ({ page }, use) => {
    const asked = [];
    await page.route(/youtube/, (route) => {
      asked.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>' });
    });
    await use(asked);
  },
});

const root = (page) => page.locator('.bw');
const openLive = async (page) => {
  await page.goto('/');
  await expect(root(page)).toHaveClass(/is-live/);
  await page.waitForTimeout(400);
};

test('the first screen says what Bali is', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Tap in.' })).toBeVisible();
  await expect(page.locator('.b-lede')).toHaveText(
    "Bali locks students' apps for class. They tap their iPhone on your Bali block, the apps open again at the bell, and you see the whole room live.",
  );
  await expect(page.getByRole('link', { name: 'Skip the tour' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Contact us' })).toBeVisible();
  const phone = page.viewportSize().width < 768;
  await expect(page.getByRole('link', { name: phone ? 'Sign in' : 'Teacher sign in', exact: true })).toBeVisible();
});

test('nothing scrolls sideways', async ({ page }) => {
  const widths = page.viewportSize().width < 768 ? [page.viewportSize().width, 320] : [page.viewportSize().width];
  for (const width of widths) {
    await page.setViewportSize({ width, height: page.viewportSize().height });
    await page.goto('/');
    for (const at of [0, 0.5, 1]) {
      await page.evaluate((f) => scrollTo(0, document.documentElement.scrollHeight * f), at);
      const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      expect(scrollWidth, `${width}px wide, ${at * 100}% down`).toBeLessThanOrEqual(innerWidth);
    }
  }
});

for (const [name, heading, id] of [
  ['Skip the tour', 'Phones are winning the high school classroom.', 'details'],
  ['Contact us', 'Talk to us', 'contact'],
  ['Watch an animation', 'See Bali in a classroom', 'watch'],
]) {
  test(`${name} slings the bar off the ring, then lands on its section`, async ({ page }) => {
    await openLive(page);
    await page.getByRole('link', { name }).click();
    await expect(root(page)).toHaveClass(/is-slinging/);
    await expect(page.locator('.b-ch-1 .b-slingp[d]')).toHaveCount(1);
    const target = page.getByRole('heading', { name: heading });
    await expect(target).toBeFocused({ timeout: 3000 });
    await expect(target).toBeInViewport();
    await expect(root(page)).not.toHaveClass(/is-slinging/);
    await expect(page.locator('.b-slingp[d]')).toHaveCount(0);
    await expect(root(page)).toHaveClass(/is-past/);
    await expect(page.getByRole('link', { name: 'Skip the tour' })).toBeHidden();
    if (id === 'contact') await expect(page.locator('.b-fab')).toBeHidden();
  });
}

test('Skip works from the middle of the story, from that chapter\'s ring', async ({ page }) => {
  await openLive(page);
  await page.evaluate(() => scrollTo(0, innerHeight * 5.5));
  await page.waitForTimeout(1500);
  await page.getByRole('link', { name: 'Skip the tour' }).click();
  await expect(page.locator('.b-ch-4 .b-slingp[d]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Phones are winning the high school classroom.' })).toBeFocused({ timeout: 3000 });
});

test('only the chapter on screen takes keyboard focus', async ({ page }) => {
  await openLive(page);
  const watch = page.getByRole('link', { name: 'Watch an animation' });
  const talk = page.getByRole('link', { name: 'Talk to us' });
  await expect(talk).toHaveAttribute('tabindex', '-1');
  await expect(watch).not.toHaveAttribute('tabindex', '-1');
  await page.evaluate(() => scrollTo(0, innerHeight * 11.5));
  await expect(talk).not.toHaveAttribute('tabindex', '-1', { timeout: 3000 });
  await expect(watch).toHaveAttribute('tabindex', '-1');
});

test('in the story only the chapters that can show draw their screens', async ({ page }) => {
  await openLive(page);
  const drawn = () => page.evaluate(() => [...document.querySelectorAll('.b-ch')].map((c) => !c.classList.contains('b-off')));
  expect(await drawn()).toEqual([true, false, false, false, false, false, false]);
  await page.evaluate(() => scrollTo(0, innerHeight * 7));
  await expect.poll(drawn, { timeout: 3000 }).toEqual([false, false, false, true, true, false, false]);
});

// Paused opacity and transform CSS animations inside the zooming, circle-clipped chapters made Chrome leave
// parts of the chapter changes undrawn, so the chapters beneath showed through (the owner saw it scrolling back
// up fast, 2026-11-02; Playwright's Chromium doesn't show it, the installed Chrome does). Of the scroll-driven
// (b-) animations, only the chapter-wide zoom (.b-out, .b-in) and the ring's turn (an SVG group) may animate
// those; the rest is set from the scroll.
test('no opacity or movement CSS animations inside the scenes', async ({ page }) => {
  await openLive(page);
  const risky = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.animationName.startsWith('b-') && a.effect.getKeyframes().some((k) => 'opacity' in k || 'transform' in k))
      .map((a) => a.effect.target)
      .filter((el) => el.closest('.b-ch') && !el.matches('.b-out, .b-in, .b-arcrot'))
      .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute('class')}`),
  );
  expect(risky).toEqual([]);
  // And the scene effects still follow the scroll: the slide on chapter 5's phone rises in as it should.
  const slide = page.locator('.b-ch-5 .b-p-side figure');
  await expect(slide).toHaveCSS('opacity', '0');
  await page.evaluate(() => scrollTo(0, innerHeight * 8.2));
  await expect(slide).toHaveCSS('opacity', '1', { timeout: 4000 });
});

test('each screen picture\'s box is the size it is drawn at', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const off = await page.locator('.b-dev').evaluateAll((boxes) =>
    boxes.filter((b) => b.querySelector(':scope > .zoom')).map((b) => {
      const outer = b.getBoundingClientRect();
      const drawn = b.querySelector(':scope > .zoom').getBoundingClientRect();
      return Math.max(Math.abs(outer.width - drawn.width), Math.abs(outer.height - drawn.height));
    }),
  );
  expect(off.length).toBe(8);
  for (const px of off) expect(px).toBeLessThan(1.5);
});

test('with Reduce Motion the story stacks and Skip jumps straight there', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(root(page)).not.toHaveClass(/is-live/);
  await expect(page.locator('.b-ch.b-off')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Talk to us' })).not.toHaveAttribute('tabindex', '-1');
  await page.getByRole('link', { name: 'Skip the tour' }).click();
  const target = page.getByRole('heading', { name: 'Phones are winning the high school classroom.' });
  await expect(target).toBeFocused({ timeout: 500 });
  await expect(target).toBeInViewport();
  await expect(root(page)).not.toHaveClass(/is-slinging/);
});

test('the questions open', async ({ page }) => {
  await page.goto('/');
  const question = page.getByText('Is there an Android version?');
  await question.scrollIntoViewIfNeeded();
  await question.click();
  await expect(page.getByText('Coming soon!')).toBeVisible();
});

test('the video loads only when someone presses play', async ({ page, youtube }) => {
  await page.goto('/');
  await page.locator('#watch').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  expect(youtube).toEqual([]);
  await expect(page.locator('#watch iframe')).toHaveCount(0);
  await page.getByRole('link', { name: 'Play the Bali classroom demo' }).click();
  const player = page.locator('#watch iframe');
  await expect(player).toHaveAttribute('src', PLAYER);
  await expect(player).toHaveAttribute('title', 'Bali classroom demo');
  await expect.poll(() => youtube[0]).toBe(PLAYER);
});

test('each Copy address copies its own address and says so', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium lets a test grant clipboard access');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  for (const address of [EMAIL, JONATHAN]) {
    const button = page.getByRole('button', { name: `Copy address ${address}` });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(page.getByRole('button', { name: `Copied ${address}` })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  }
});

test('a copy that fails says so, and the address stays on screen', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } }),
  );
  await page.goto('/');
  const button = page.getByRole('button', { name: `Copy address ${JONATHAN}` });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByRole('button', { name: `Couldn’t copy ${JONATHAN}` })).toBeVisible();
  await expect(page.locator('.b-copymsg')).toHaveText('Couldn’t copy. The address is shown above.');
  await expect(page.getByRole('link', { name: JONATHAN })).toBeVisible();
});

test('every link goes somewhere real', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(15);
  for (const href of hrefs) {
    if (href.startsWith('#')) await expect(page.locator(href), href).toHaveCount(1);
    else expect(href).toMatch(/^https:\/\/|^mailto:(eshan\.shah|jonathan\.n\.bani-esraili)@vanderbilt\.edu$/);
  }
  for (const address of [EMAIL, JONATHAN]) await expect(page.getByRole('link', { name: address })).toHaveAttribute('href', `mailto:${address}`);
});

test('no serious accessibility problems', async ({ page }) => {
  await openLive(page);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0].target.join(' ')}`)).toEqual([]);
});

test('the security policy is sent', async ({ page }) => {
  const response = await page.goto('/');
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self';");
  expect(csp).toContain('frame-src https://www.youtube-nocookie.com;');
});
