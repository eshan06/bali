# Roadmap research — proposed future phases

Two investigations made on 2026-10-05, for phases that are **proposed, not scheduled**.
Nothing here is decided beyond the rulings it names; each phase starts with a docs PR and
a `docs/DECISIONS.md` entry, and anything that changes `docs/ARCHITECTURE.md` is discussed
with the owner first. `docs/PLAN.md` lists them under "Proposed future phases".

## A. SIS / LMS integration (rosters from the school's systems)

**For Vanderbilt: don't integrate now.** An LTI 1.3 tool registration in Brightspace and
Okta federation both need VUIT's approval, slower than the pilot itself.

**The smallest useful step: an expected roster.** The teacher pastes emails (or a CSV)
for a class; a student whose verified email matches sees that class offered on the
consent screen and joins with one press. The same table later backs a OneRoster CSV
import. It needs the student's email on the server: since S3 the API takes the access
token only, which carries no email, so this step decides how the server learns it
(the ID token's `email`, or Cognito's `GetUser` with the token).

**K-12, later, in this order:**

1. **Legal first.** California's CSDPA with its Exhibit E general offer, New Jersey's
   model DPA, the SDPC registry, and LAUSD's UDIPP. Which region comes first (Los Angeles
   or New Jersey) is the owner's open call (ISSUES #4).
2. **Clever SSO** (free to vendors): Clever as an OIDC identity provider on the Cognito
   pool. The Pre sign-up Lambda must then allow `PreSignUp_ExternalProvider` for that
   provider (today it gates by email domain). Clever's certification takes about 2–4
   weeks. Cognito bills SAML/OIDC federated users beyond 50 MAU.
3. **Rostering:** Clever Secure Sync (about $7–11k a year, by quote), or ClassLink /
   OneRoster (free to vendors), or Edlink (about $6k a year).
4. **LTI 1.3** launches and Names and Roles (NRPS) are handled by the API itself, not by
   Cognito.

**Data model additions** (an ARCHITECTURE change, so the owner's first): `roster_sources`,
`external_ids` and expected enrollments. Roster changes go through roster functions in
the transition engine (`packages/db/src/transitions.ts`), each with a deterministic
`event_id` so a re-sync is a replay.

**No grade or attendance writeback** until Apple answers ISSUES #3 (§3.3.3(P)'s "or
otherwise" sharing of Family Controls data) and a FERPA / data-agreement review says yes.

## B. Presenting and live questions (Top Hat-style)

**What Top Hat does:** PDF or PowerPoint slides presented with a projector view; students
follow the current slide on their own device; about 11 embedded question types with a
timer and a response count; attendance codes; participation grading; LMS sync through
LTI 1.3.

**Bali's twist.** Bali itself isn't shielded in practice: `PhoneScreenTime.swift` shields
`.all()`, yet Bali's Focus screen and Emergency Unlock work mid-session. So the locked
phone can show today's slide and the question in front of the student, with nothing else
open. Slides render with native PDFKit, not a `WKWebView`.

**Apple.** Answers are Bali's own data, not Family Controls data, but the feature
strengthens the "organizational setting" reading of Bali, so it goes into the
consultation with Apple (ISSUES #3). Slides and questions must work whether or not the
shields are on.

**How phones follow** without an architecture change: a foreground poll of
`GET /v1/sessions/{id}/presentation` about every 2 s, with an ETag and `304`, inside the
120-a-minute per-account budget (ISSUES #1). Server-sent events for students would be an
owner decision (students get no live feed today).

**Owner's ruling (2026-10-05): live-question results are totals only.** No teacher and
no projector ever sees one student's answer; the results are counts per choice.

**Slice 1 — live questions only, about 7 PRs:**

1. Docs and a decision entry.
2. `questions` and `responses` tables, written by new engine events.
3. The API: questions launched and closed, an idempotent answer (`event_id`), aggregate
   results only.
4. Privacy plumbing: answers handled by account deletion (C3), the record export (C5), the
   school's disposal and the retention run (C6a, C6b).
5. The portal: launching a question and the projector's results (after D2).
6. BaliCore: the poll.
7. iOS: the answer card.

**Slice 2 — slides, about 7 PRs:** a storage adapter (S3 and a fake); deck endpoints with a
presigned PUT and server-side PDF checks; a slide-change transition; the portal's deck
library and a PDF.js presenter (PDF.js pinned at 4.2.67 or later, the CSP's `worker-src`
allowing its worker); a PDFKit deck cached on the phone; load and demo coverage.

**Open questions for the owner:** polling or student SSE; the storage provider and a size
cap; whether a student must be tapped in to answer; presenting outside a focus session;
how long answers and decks are kept.
