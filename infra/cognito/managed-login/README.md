# The sign-in page: Cognito's managed login

Sign-in, sign-up and forgot-password are Cognito's own pages, at each pool's domain, for the portal
and the phone alike. Since 2026-11-12 they are Cognito's **managed login**, the second version of
those pages (`ManagedLoginVersion` 2), where they were the classic hosted UI (version 1: one CSS
file over a fixed list of class names, Arial, a 350 px card). A domain shows one version to every
client on it. Managed login dresses each app client in a _style_: a settings object and a set of
images, which the console's branding editor or the API sets. It needs the pool on the
**Essentials** or **Plus** plan (on Lite, classic is all there is); both pools are on Essentials.
The page's words are AWS's: no setting changes them (a `lang` query picks another of AWS's
languages).

This folder is Bali's style, one for every client so they can't drift; the pools differ only in
the logo.

- `settings.json`: the style's settings, in Bali's tokens (`docs/DESIGN.md`): the stone-50 page,
  the white card at radius 20, green-700 pill buttons and links, stone-100 fields with
  `border-input` edges, the green-600 focus ring, headings in `text-primary`, labels in
  `text-secondary`, the logo above the card. Light mode only: its dark-mode values are still AWS's
  blue, so `colorSchemeMode` stays `LIGHT`.
- `logo-dev.png` and `logo-prod.png`: the lockup, the mark beside "Bali", dev's with a Dev tag so a
  tester knows which pool they are on. Cognito takes a form logo between 1:1 and 4:1, and the
  lockup, 140 × 32 px drawn at 3x, is 4.375:1, so it sits on a 4:1 canvas, 420 × 105, its pixels
  unchanged. `make-logo.mjs` draws them (its header says how) to the pixel; its PNGs compress
  differently, so a redraw changes the files' bytes, never the picture. The mark's one source is
  `apps/web/public/icon.svg`, which is also the page's favicon.
- `request.mjs`: prints the request that gives one client the style (the settings, the pool's logo
  and the favicon), for the AWS CLI.
- `managed-login.test.mjs` (`npm run test:infra`): fails on a word under 4.5:1 against what it
  sits on, a field's edge or the focus ring under 3:1, dark mode turned on, a typography key or
  weight Cognito didn't take, a logo outside 1:1 to 4:1, or an asset Cognito doesn't know or won't
  take.

## Where it is

| Pool                        | Its domain                                                        | Client                                                  | Its style                              |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| dev, `us-east-1_YTloqilwT`  | `bali-dev`, managed login since 2026-11-12                        | `bali-web-dev`, `2f0vj9o545imu4qth5phanki1v`            | `cbeebf20-d5b7-4e9b-a224-2f838078b0ba` |
|                             |                                                                   | `bali-ios-dev-public`, `7u6trs6gv805oi35ima29em6oe`     | `ef4f008c-9737-4454-9b97-ee61903d8026` |
|                             |                                                                   | `bali-android-dev-public`, `1njpekb5sg8nd6lkb53rpimjke` | `e885a39b-0ea5-48aa-8c2f-522660f42a9e` |
| prod, `us-east-1_C55e0fhX8` | `us-east-1c55e0fhx8`, classic until the owner switches it (below) | `bali-web`, `36meb9r9h0cdrt2a1schcv9abs`                | `31bab39d-64bb-4cba-8486-2fe12508c6e7` |
|                             |                                                                   | `bali-ios`, `5dr74i0iqnth9p4c4k594r27aj`                | `b1c89cc3-dcff-4910-86d2-0beeaf80962a` |

Dev's demo client, `bali-ios` (`6qcvcp0ubqmb8gunkt1d6dpkeo`), signs the demo's actors in by
password through Cognito's API (`USER_PASSWORD_AUTH`, `docs/DEPLOY.md`), never on these pages, so
it needs no style.

## Applying it

After a change to `settings.json` or a logo, update each style, with the AWS CLI signed in to the
account; `dev` or `prod` picks the pool's logo:

```bash
node infra/cognito/managed-login/request.mjs dev > /tmp/bali-style.json
aws cognito-idp update-managed-login-branding --region us-east-1 \
  --user-pool-id us-east-1_YTloqilwT \
  --managed-login-branding-id cbeebf20-d5b7-4e9b-a224-2f838078b0ba \
  --cli-input-json file:///tmp/bali-style.json
```

The request names two images, the logo and the favicon. An update changes only what it names, and
an image a style doesn't hold is Cognito's own: dev's two styles, read back with
`--return-merged-resources` on 2026-11-12, had every image they don't hold filled from Cognito's.

A new client, however it was made, has no style, and managed login shows it no page until it has
one: the second command below gives it Bali's. Android's dev client, made in the console on
2026-11-12, had none either, its page saying "Unavailable", where this file had said the console
gives a new client Cognito's default style. The first command finds a client's style, if it has
one, for the update above. Either way, add its row above.

```bash
aws cognito-idp describe-managed-login-branding-by-client --region us-east-1 \
  --user-pool-id <pool> --client-id <client> --query ManagedLoginBranding.ManagedLoginBrandingId
aws cognito-idp create-managed-login-branding --region us-east-1 \
  --user-pool-id <pool> --client-id <client> --cli-input-json file:///tmp/bali-style.json
```

**Check:** the style's settings read back as `settings.json` holds them, then the page itself, in a
private window, 1 to 4 minutes after the change:

```bash
aws cognito-idp describe-managed-login-branding --region us-east-1 \
  --user-pool-id <pool> --managed-login-branding-id <style> --query ManagedLoginBranding.Settings
```

The portal's on dev:
`https://bali-dev.auth.us-east-1.amazoncognito.com/login?client_id=2f0vj9o545imu4qth5phanki1v&response_type=code&scope=openid+email+profile&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback`;
on prod:
`https://us-east-1c55e0fhx8.auth.us-east-1.amazoncognito.com/login?client_id=36meb9r9h0cdrt2a1schcv9abs&response_type=code&scope=openid+email+profile&redirect_uri=https%3A%2F%2Fapp.getbali.app%2Fauth%2Fcallback`.
`/signup` and `/forgotPassword` with the same query show the other two pages: managed login keeps
classic's `/signup`, which the app's Sign up opens (seen on dev, 2026-11-12).

## The domain's switch, and back

Prod's domain is still classic. Switching it is the owner's step (PLAN's Open owner items):

```bash
aws cognito-idp update-user-pool-domain --region us-east-1 \
  --domain us-east-1c55e0fhx8 --user-pool-id us-east-1_C55e0fhX8 --managed-login-version 2
```

AWS takes up to 4 minutes to show the new version, and keeps none of the pages' own sign-in
sessions across a switch: whoever is on them signs in again. So switch outside class hours.
**Check:** this reads `2`; then sign in once on prod's page above.

```bash
aws cognito-idp describe-user-pool-domain --region us-east-1 \
  --domain us-east-1c55e0fhx8 --query DomainDescription.ManagedLoginVersion
```

**Rollback:** the same command with `--managed-login-version 1`. A pool keeps its classic CSS and
logo through a switch (dev's still held its upload of 2026-10-06 after its own, read back
2026-11-12), so classic comes back as it was. The classic files, `infra/cognito/hosted-ui/`, left
the repo when this folder replaced them; git's history keeps them.

## Username and password on one page

A client with choice-based sign-in (`ALLOW_USER_AUTH` among its authentication flows) gets
managed login's identifier-first form: the username alone, then the password on a page of its own,
where other ways to sign in can be offered. Bali's clients leave it off, so the two fields share
one page (the owner's ask, 2026-11-12): dev's first two clients had it until then, Android's was
made without it, and prod's never did. Keep
it off on every client that signs in on these pages (`docs/RUNBOOKS.md`, runbook 2, step 8).
**Check:** this lists `ALLOW_REFRESH_TOKEN_AUTH` and `ALLOW_USER_SRP_AUTH` alone.

```bash
aws cognito-idp describe-user-pool-client --region us-east-1 \
  --user-pool-id <pool> --client-id <client> --query UserPoolClient.ExplicitAuthFlows
```

## The headings' weight: keys AWS doesn't document

AWS documents no font setting, but Cognito takes and keeps `categories.global.typography` (found
2026-11-12): `fontWeight` with `headingXl`, `headingL`, `headingM`, `headingS`, `headingXs` and
`button`, each 300, 400 or 700 and nothing else; `fontSize` with `displayL`, `headingXl` to
`headingXs`, `bodyM` and `bodyS`. Bali sets every heading's weight to 400 and `headingXl`'s size to
28, so "Sign in" isn't a heavy bold. Being undocumented, they may stop working whenever AWS changes
the page: the headings would turn bold again, and nothing else would change. A field's label stays
bold, since no setting reaches it, and the font is AWS's own.
