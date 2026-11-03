# Bali demo site (`demo2`)

getbali.app: the one-page demo. This branch holds only the site; the product lives on `main`.

The design is the owner-approved Claude Design canvas "Bali demo site"
(https://claude.ai/artifact/EdpxNeVy1iiEHqUcy7UwXs). `canvas/` is a copy of its files as approved
(version 23, 2026-11-02; `VideoPlaying.dc.html` draws the video playing in place). Change the design on the canvas first, get the owner's approval, then copy the
changed files in here.

- `canvas/`: the approved canvas files: the page (`Main.dc.html`), the app and portal screens it shows,
  and the portal stylesheet they're drawn with (`v2.css`).
- `tools/build.mjs`: turns the canvas files into the site in `dist/` (no dependencies).
- `tools/check.mjs`: quick checks on `dist/`: every link and asset resolves, no canvas-only markup or
  inline script is left, size budgets, the security policy.
- `src/site.js`, `src/live.js`: the page's script (the scroll-driven chapters, Skip, Contact, Watch, the
  slingshot, the copy button, the video), ported from the canvas's component script.
- `static/`: the self-hosted fonts (OFL) and the icon.
- `tests/site.spec.mjs`: browser tests in Chrome and Safari's engine, at laptop and phone sizes.
- `vercel.json`: Vercel builds with `node tools/build.mjs && node tools/check.mjs` and serves `dist/`
  with the security headers. A failed build never takes the site down: Vercel keeps serving the last
  good version.

## Shipping a change

1. `npm ci && npx playwright install chromium webkit` (once).
2. `npm test`: builds, runs the quick checks, then the browser tests. All must pass.
3. The santa-loop review (two independent reviewers, as on `main`): only proven problems block.
4. Push to `demo2`. Vercel builds and deploys it: project `bali-web`, production branch `demo2`, root
   directory blank (the repo root), ignored build step `[ "$VERCEL_GIT_COMMIT_REF" != "demo2" ]`.
5. Check the live site: `BASE_URL=https://www.getbali.app npx playwright test`.

Commits carry the owner's identity only, with no Claude attribution of any kind.
