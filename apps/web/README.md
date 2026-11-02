# Bali demo site

The one-page demo at bali-web-psi.vercel.app (Vercel project `bali-web`, production branch `demo`,
root directory `apps/web`). It is built from the owner-approved Claude Design canvas "Bali demo site"
(https://claude.ai/artifact/EdpxNeVy1iiEHqUcy7UwXs, version 12, 2026-11-02): seven scroll chapters,
each a headline and a real product screen in front of Bali's ring.

`public/` is the whole site, served as is: `vercel.json` skips the install and build steps.

- `index.html`: the page, with the canvas's app and portal screens inlined as inert pictures, and
  its script: it fits each scene beside the headline and drives every `b-` animation from the
  scroll position (live mode, only without Reduce Motion and in windows up to 1600px tall).
- `site.css`: the page's styles; `v2.css`: the portal stylesheet the screens are drawn with (its
  narrow-width rules off, so a portal screen always shows its desktop layout).
- `fonts/`: Instrument Sans and JetBrains Mono, the portal's own self-hosted files (OFL).

Change the design on the canvas first; this page follows it.
