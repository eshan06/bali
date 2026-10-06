# The sign-in page: Cognito's Hosted UI (classic)

Sign-in, sign-up and forgot-password are Cognito's own pages, in both pools, for the portal and
the phone alike. Cognito lets a pool set one logo and one CSS file, always together, over a fixed
list of class names (`docs/DESIGN.md`; D2d in `docs/PLAN.md`). These are Bali's:

- `hosted-ui.css`: one file for both pools, so they can't drift. Bali's tokens on Cognito's
  classes. A property outside AWS's per-class list is marked "if kept": the page holds without
  it, and the dev upload shows which ones Cognito keeps. One exception to "holds": without the
  focus ring's `box-shadow`, a focused field shows Bootstrap's own blue glow.
- `logo-prod.png` and `logo-dev.png`: the lockup, the mark beside "Bali", dev's with a Dev tag so
  a tester knows which pool they are on. A transparent 140 × 32 px canvas drawn at 3x, under
  10 KB each. `make-logo.mjs` draws them (its header says how); the mark's one source is
  `apps/web/public/icon.svg`.
- `hosted-ui.test.mjs` (`npm run test:infra`): fails on a selector Cognito doesn't allow, an
  at-rule, a logo over 100 KB, an upload over Cognito's cap, or a field's edge under 3:1
  against the field or the card.

A pool's version is its logo plus the shared CSS. Upload the two together: Cognito never takes
one alone, and the per-client override is not used, so both app clients take the pool's default.

## Uploading to dev

The labels are AWS's, from its developer guide ("Customizing hosted UI (classic) branding", read
2026-10-05). If the console has moved one, the nearest match is the one.

1. Sign in to the AWS console, open **Amazon Cognito** → **User pools**, and choose dev's pool,
   `us-east-1_YTloqilwT` (its domain is `bali-dev.auth.us-east-1.amazoncognito.com`).
2. In the left navigation, under **Branding**, choose **Domain** and check that **Branding
   version** reads **Hosted UI (classic)**. It does today; nothing to change.
3. Under **Branding**, choose **Managed login**.
4. Under **Hosted UI settings**, find **Style** and choose **Edit**. This is the pool-wide
   default, the one to use: the portal's client (`bali-web-dev`) and the phone's
   (`bali-ios-dev-public`) both take it, since neither has a style of its own. The other place,
   **App clients** → a client → **Hosted UI (classic) style** → **Override**, styles one client
   and wins over the default; leave it alone.
5. Logo: **Choose file** (or **Replace current file**) → `infra/cognito/hosted-ui/logo-dev.png`.
6. CSS: **Choose file** (or **Replace current file**) → `infra/cognito/hosted-ui/hosted-ui.css`.
   Skip the **CSS template.css** link: that is AWS's starting point, and this file is one already.
7. **Save changes**.
8. Look, in a private window; a change can take up to a minute to show. The portal's dev client:
   `https://bali-dev.auth.us-east-1.amazoncognito.com/login?client_id=2f0vj9o545imu4qth5phanki1v&response_type=code&scope=openid+email+profile&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback`.
   `/signup` and `/forgotPassword` with the same query show the other two pages.

## Uploading to production

The same steps in `bali-production` (`us-east-1_C55e0fhX8`; domain
`us-east-1c55e0fhx8.auth.us-east-1.amazoncognito.com`), with `logo-prod.png` and the same
`hosted-ui.css`. Its clients are `bali-web` and `bali-ios`. Look at
`https://us-east-1c55e0fhx8.auth.us-east-1.amazoncognito.com/login?client_id=36meb9r9h0cdrt2a1schcv9abs&response_type=code&scope=openid+email+profile&redirect_uri=https%3A%2F%2Fbali-portal.vercel.app%2Fauth%2Fcallback`.

## What classic can't change

Cognito's own stylesheet sets these and offers no class for them: the font (Arial); every word,
"Username" and the forgot-password heading included; the grey page and the card's shadow; the
card's width (350 px) and its 15 px inner padding; the links' blue (`.redirect-customizable` sits
on the "Need an account?" line as well as on the links, so a colour there would recolour the
sentence and leave "Sign up" blue); the placeholders' grey. The "if kept" properties are the ones
AWS's per-class list doesn't name: the card's and the fields' corners, the pill button and its
border, the focus ring, 16 px field text (under 16, iPhone Safari zooms into a field) and the
space under a field.
