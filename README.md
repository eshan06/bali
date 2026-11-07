# Bali website (`demo3`)

getbali.app: the home page, three guides and three resource pages. This branch holds only the site;
the product lives on `main`. It replaces `demo2`, the one-page demo.

The design is the Claude Design canvas "Bali website"
(https://claude.ai/artifact/5Aohc3RHe7j69mVgXwyZhj). `canvas/` is a copy of the files the site uses
(canvas version 36, 2026-11-06). Change the design on the canvas first, then copy the changed files
in here.

| Path | Page | Board |
|---|---|---|
| `/` | Home | `Main.dc.html` |
| `/guides/first-class` | Run your first class | `GuideFirstClass.dc.html` |
| `/guides/emergency-unlock` | Emergency Unlock, explained | `GuideUnlock.dc.html` |
| `/guides/families` | A note for families | `GuideFamilies.dc.html` |
| `/research` | What the research says | `Research.dc.html` |
| `/compare` | How schools keep phones out of class | `Compare.dc.html` |
| `/phone-laws` | Phone laws by state | `PhoneLaws.dc.html` |

- `canvas/`: the canvas files: the seven pages, the boards they import (the hero, the timeline, the
  classroom, the Bali block, the start-of-class steps, the recap card, the app and portal screens),
  and the stylesheets (`v2.css` for the portal screens, `site.css` for the pages).
- `tools/build.mjs`: builds `dist/` with no dependencies. It bundles every board a page needs into
  `dist/boards.js` (each board's template, styles and component), rewrites links between boards to
  the paths above, swaps the canvas's Google Fonts for the self-hosted ones and its uploads for files
  in `static/`, and writes one small HTML page per path.
- `src/runtime.js`: draws a page from `boards.js` in the browser, as the canvas does: holes,
  `sc-for`, `sc-if`, `dc-import`, the helmet styles, and each board's component (`renderVals`,
  `setState`, `componentDidMount`). A redraw changes only what the drawing changed and keeps the
  elements, so what a component set up on them (observers, animations) stays. Nothing is evaluated
  from strings, so the security policy (`script-src 'self'`) holds.
- `tools/check.mjs`: quick checks on `dist/`: every page, link and asset resolves, no canvas link,
  upload path, Google Fonts link or inline script is left, and `boards.js` stays under 900 KB.
- `tools/serve.mjs`: serves `dist/` with the same headers Vercel sends (`npm run serve`, port 4173),
  so a page the security policy would break breaks here first.
- `tests/site.spec.mjs`: browser tests in Chrome and Safari's engine, at laptop and phone sizes:
  every page draws, nothing scrolls sideways, every link and old address goes somewhere real, the
  copy buttons, Reduce Motion, the message when a page can't draw, accessibility and the security
  policy.
- `static/`: the self-hosted fonts (OFL), the icon, and the Android screen picture.
- `vercel.json`: Vercel runs `node tools/build.mjs && node tools/check.mjs` and serves `dist/` with
  the security headers. A failed build never takes the site down: Vercel keeps the last good version.

## Shipping a change

1. `npm ci && npx playwright install --only-shell chromium webkit` (once).
2. `npm test`: builds, runs the quick checks, then the browser tests. All must pass.
3. `npm run serve` and open every page at laptop and phone widths: the animations play and the
   pages look as they do on the canvas.
4. The santa-loop review (two independent reviewers, as on `main`): only proven problems block.
5. Push to `demo3`.
6. Check the live site: `BASE_URL=https://www.getbali.app npx playwright test`.

## Vercel

Project `bali-web` (www.getbali.app). For this branch to be the live site, in the project's settings:

- **Git → Production Branch:** `demo3` (it was `demo2`).
- **Build and Deployment → Ignored Build Step:** `[ "$VERCEL_GIT_COMMIT_REF" != "demo3" ]` (it was
  `!= "demo2"`), so only this branch builds. It lives in the dashboard, not in `vercel.json`, because
  `bali-portal` builds from the same repository and would read it too.
- **Root Directory:** blank (the repository root).

Then redeploy, or push to `demo3`. `demo2` stays as it was, so switching the production branch back
is the way to roll back.

Commits carry the owner's identity only, with no Claude attribution of any kind.
