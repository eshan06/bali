# The teacher web portal (`apps/web`)

A Next.js (App Router) portal for teachers: sign in, see your classes, run a
session, and watch the live grid. It talks to the same Fastify API as the phone
apps — read-through-the-events-feed, no direct database access — and authenticates
with the same Cognito user pool over a **public PKCE** client (no client secret in
the browser).

This phase the portal runs **locally** against the Railway **dev** API; there is no
Vercel deploy yet.

## Run it locally

```bash
npm ci
npm run dev -w @bali/web     # Next dev server on http://localhost:3000
```

It needs the API reachable and a Cognito app client configured (below). Config is
read from `NEXT_PUBLIC_*` variables, baked in at build time — none are secret (the
PKCE flow uses a public client), so they are safe to expose in the bundle. Put them
in `apps/web/.env.local`:

| Variable | Example | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | The Fastify API base URL. Point at the Railway dev API to run against it. |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | `https://bali-dev.auth.us-east-1.amazoncognito.com` | The hosted-UI domain (no trailing slash). |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | `abc123…` | The **web** app client id (distinct from the phone client). |
| `NEXT_PUBLIC_REDIRECT_URI` | `http://localhost:3000/auth/callback` | Must exactly match a callback URL registered on the app client. |
| `NEXT_PUBLIC_COGNITO_SCOPES` | `openid email profile` | Space-separated OAuth scopes. |

The defaults in `src/lib/config.ts` already point at a local setup
(`http://localhost:3001` API, `http://localhost:3000/auth/callback` redirect), so
only the Cognito domain and client id must be supplied to sign in.

## Cognito app client — author action (needs the AWS console)

The portal is a browser SPA, so it uses the **authorization-code + PKCE** grant with
a public client — there is no secret to hold. Create a dedicated **web** app client
in the *same* user pool the API validates against (`AUTH_ISSUER` / `AUTH_AUDIENCE`
in `docs/DEPLOY.md`); do **not** reuse the phone client, because the callback URLs
and grant settings differ.

In the AWS console → Cognito → the dev user pool → **App integration → App clients**:

1. **Create app client.**
   - Type: **Public client** (SPA). **Do not** generate a client secret — a browser
     cannot keep one, and the code sends none.
   - Name it something like `bali-web-dev`.
2. **Hosted UI / OAuth.**
   - **Allowed callback URLs:** `http://localhost:3000/auth/callback` (add the
     deployed portal origin later, when there is one).
   - **Allowed sign-out URLs:** `http://localhost:3000/login`.
   - **Identity providers:** Cognito user pool (plus any federated IdPs the pool
     already uses).
   - **OAuth grant types:** **Authorization code grant** only. Leave *Implicit* off.
   - **OpenID Connect scopes:** `openid`, `email`, `profile`.
3. **Hosted UI domain.** If the pool has no hosted-UI domain yet, create one under
   **App integration → Domain** (e.g. `bali-dev`). This is the
   `NEXT_PUBLIC_COGNITO_DOMAIN`.
4. **Copy the app client id** into `NEXT_PUBLIC_COGNITO_CLIENT_ID`.

The portal builds the hosted-UI authorize URL itself (`src/lib/auth.ts`) with a
freshly generated PKCE `code_verifier`/`code_challenge` (S256) and a `state` nonce,
exchanges the code for tokens at `/oauth2/token` on the callback, and sends the
resulting access token as a bearer on every API call. No tokens ever appear in a
query string, and the SSE stream is read with `fetch` + `ReadableStream` (not
`EventSource`) so it can carry the `Authorization` header.

> Both `NEXT_PUBLIC_REDIRECT_URI` and the app client's **Allowed callback URL** must
> be byte-for-byte identical, or Cognito rejects the exchange. That mismatch is the
> most common first-run failure.

## Making a teacher

Every first sign-in provisions the caller as a **student** (see
`findOrCreateStudent` in `packages/db/src/queries.ts`); teacher rows are flipped out
of band. After a would-be teacher has signed in **once** (so their row exists), flip
their role against `DATABASE_URL`:

```sql
UPDATE users SET role = 'teacher' WHERE cognito_id = '<their Cognito sub>';
```

The `cognito_id` is the user's `sub` claim (visible in the Cognito console under
**Users**, or in the JWT). The teacher-only endpoints (`requireTeacher` in
`apps/api/src/auth/teacher.ts`) return 403 until this is set, so the class-management
screens stay empty until the flip.

## The API side: CORS

A browser calling the API cross-origin needs CORS. The API adds it only when
`CORS_ORIGINS` is set (comma-separated origins, e.g. `http://localhost:3000`); unset
— the default — means no CORS headers at all, which is correct while only native
apps and server-to-server call it. Set `CORS_ORIGINS` on the dev API to the portal's
origin. The allowed request header is the `Authorization` bearer; there are no
cookies, so the API runs CORS without credentials mode.

## Known gap — token renewal

The portal stores only the Cognito **access token** (sessionStorage, per tab).
There is no refresh token and no silent renewal, so when the ~1h access token
expires the next API call or stream read returns 401 and the teacher is dropped
to `/login` — mid-class if it happens then. This is deliberate for the Phase 2
skeleton, not an oversight: the honesty rule still holds (only a definitive 401
ever signs anyone out), and renewal lands with the real portal UI. It is tracked
in `docs/PLAN.md`'s decision log.
