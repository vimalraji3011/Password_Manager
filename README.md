# Office Password Management

An internal credential vault for organization passwords. Next.js 15 (App Router),
TypeScript, Tailwind CSS, shadcn/ui-style components, Framer Motion — with a
JSON-file datastore and no database.

---

## Quick start

```bash
npm install
npm run genkey          # prints JWT_SECRET and MASTER_ENCRYPTION_KEY
cp .env.example .env.local
#   → paste the two generated secrets into .env.local
npm run seed            # creates ./data with two accounts + demo vault
npm run dev             # http://localhost:3000
```

Default accounts created by the seed (change both after first sign-in):

| Role         | Email                | Password       |
| ------------ | -------------------- | -------------- |
| System Admin | `admin@company.com`  | `Admin@12345`  |
| Viewer       | `viewer@company.com` | `Viewer@12345` |

`npm run seed` refuses to overwrite an existing `data/users.json`. Pass
`-- --force` to recreate the datastore, or `-- --no-demo` for accounts only.

---

## The two kinds of password

This is the single most important design decision in the codebase.

| | Login passwords | Stored credentials |
| --- | --- | --- |
| Where | `data/users.json` | `data/sources.json` |
| Algorithm | **bcrypt**, cost 12 | **AES-256-GCM** |
| Reversible | No — one way, by design | **Yes** — that is the point |
| Key | none (salted hash) | `MASTER_ENCRYPTION_KEY` |

Vault credentials must be readable again by an authorised user, so they are
*encrypted*, never hashed. AES-**GCM** specifically, because it is authenticated:
hand-editing `data/sources.json` makes decryption fail loudly instead of
returning garbage.

> **Back up `MASTER_ENCRYPTION_KEY`.** Lose it and every stored credential is
> permanently unreadable. Rotating `JWT_SECRET` only signs everyone out.

---

## Roles

| Capability | System Admin | Viewer |
| --- | :---: | :---: |
| View organizations and sources | ✅ | ✅ |
| Search the vault | ✅ | ✅ |
| Reveal a password | ✅ | ❌ |
| Create / edit / delete organizations | ✅ | ❌ |
| Create / edit / delete sources | ✅ | ❌ |
| Reset another user's password | ✅ | ❌ |
| Approve reveal-password resets | ✅ | ❌ |
| View the audit log | ✅ | ❌ |
| Request a reveal-password reset | ✅ | ✅ |
| Edit own profile / password | ✅ | ✅ |

Passwords render as `••••••••` everywhere except inside a completed reveal.

Enforcement is layered, deliberately: `middleware.ts` redirects before a page
renders, every API route re-checks via `withAuth({ role })`, and the reveal
endpoint checks the role a third time. Hiding a button is not a security control.

---

## The reveal flow

Clicking the eye icon does **not** simply decrypt:

1. Viewer accounts are refused outright (403).
2. Rate limited to 10 attempts per admin per 5 minutes.
3. The admin must retype **their own login password** — a stolen session cookie
   alone is not enough to read secrets.
4. The credential is decrypted, returned once with `Cache-Control: no-store`,
   and displayed for **10 seconds**. When the countdown ends the plaintext is
   dropped from React state, not merely hidden with CSS.
5. The reveal is written to the audit log and the other admins are emailed.

---

## The two reset flows

**Reset user password** (`/reset-user-password`, admin) — the admin does *not*
choose the new password. They trigger the same emailed 6-digit code the user
would get from *Forgot password*, and the user sets their own. An admin who could
set another user's password could impersonate them, and the audit log would show
the user's actions rather than the admin's.

**Reset view password** (`/reset-view-password`) — the password confirmed before
a reveal *is* the user's login password, so a self-service reset would let anyone
holding a hijacked session mint themselves a new one. Instead:

```
user requests → admin approves out of band → single-use link emailed to the user
              → user sets a new password → link invalidated
```

The admin never sees the link. Only its SHA-256 hash is stored, and it expires
after 30 minutes.

---

## Email (Brevo SMTP)

Set `SMTP_*` and `FROM_EMAIL` in `.env.local`. While `EMAIL_DEV_MODE=true` — or
whenever SMTP is unconfigured — messages are printed to the server console
instead of sent, so the whole app is usable before Brevo is provisioned.

Notifications are sent for: source created / updated / deleted, organization
deleted, password revealed, reset requested / approved / rejected, and both reset
code emails.

Two rules hold throughout `lib/mailer.ts`:

- **No credential ever appears in an email.** Templates take a source name and an
  actor, never a password. OTPs are the one exception, and they are single-use,
  short-lived and hashed at rest.
- **Email failure never fails the user's action.** `sendMail` resolves with
  `{ sent: false }` rather than throwing, so a credential update still succeeds
  when SMTP is down.

---

## Storage

```
data/
├── users.json            bcrypt hashes, roles, last login
├── organizations.json    organizations
├── sources.json          credentials (AES-256-GCM envelopes)
├── audit.json            append-only audit trail (capped at 5,000 entries)
└── reset-requests.json   OTP + approval state
```

`lib/json-storage.ts` provides the whole persistence layer:

- **Atomic writes.** Data goes to a temp file in the same directory, is `fsync`ed,
  then `rename()`d over the target. `rename` is atomic on NTFS and POSIX, so a
  crash mid-write cannot leave a half-written vault.
- **Serialised access.** Every operation on a file goes through a promise chain,
  which eliminates the read-modify-write race two concurrent requests would
  otherwise hit.
- **Self-healing.** A missing file is created from its default; a corrupt file is
  quarantined as `*.corrupt-<timestamp>` rather than crashing the app.

`data/*.json` is **gitignored** — it holds bcrypt hashes and encrypted
credentials and must never be committed.

The `Collection<T>` API (`all`, `byId`, `insert`, `update`, `remove`,
`removeWhere`) is shaped like a repository so a future SQL migration can replace
the implementation without touching callers.

---

## Security summary

| Concern | Implementation |
| --- | --- |
| Login passwords | bcrypt, cost 12 |
| Stored credentials | AES-256-GCM, authenticated |
| Sessions | JWT (HS256, `jose`) in an HTTP-only, SameSite=Lax cookie, 8 h |
| CSRF | `x-requested-with` header + Origin/Host check on every mutation |
| Rate limiting | Login (5 / 5 min), OTP request (3 / 10 min), OTP verify (6 / 10 min), reveal (10 / 5 min) |
| Account enumeration | Login and forgot-password give identical responses for unknown addresses |
| Input validation | Zod schemas shared by the API and the forms |
| OTP / token storage | SHA-256 hashed, single-use, constant-time comparison |
| Headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Indexing | `robots: noindex, nofollow` — an internal vault should never be indexed |

`jose` rather than `jsonwebtoken` because `middleware.ts` runs in the Edge
runtime, where Node's `crypto` is unavailable.

---

## Project structure

```
app/
├── layout.tsx                     root layout, fonts, providers
├── globals.css                    design tokens (light + dark), glass/aurora
├── login/  forgot-password/  reset-password/
├── reset-view-password/verify/    public, token-authenticated
├── (app)/                         authenticated shell — adds no URL segment
│   ├── layout.tsx                 sidebar + topbar + notices
│   ├── dashboard/
│   ├── organizations/  organizations/[id]/
│   ├── profile/  reset-user-password/  reset-view-password/  audit/
│   ├── error.tsx  loading.tsx
└── api/
    ├── auth/{login,logout,me,forgot-password,verify-otp,reset-password}
    ├── organizations/  organizations/[id]/
    ├── sources/  sources/[id]/  sources/[id]/reveal/  sources/generate-password/
    ├── reset-requests/  reset-requests/[id]/decide/  reset-requests/complete/
    ├── users/  users/reset-password/  profile/  profile/password/
    ├── audit/  search/
components/
├── ui/          shadcn/ui-style primitives (button, dialog, table, …)
├── layout/      sidebar, topbar, search palette, theme toggle
├── auth/  organizations/  sources/  resets/  audit/  profile/  dashboard/  shared/
hooks/           use-api, use-debounced-value, use-media-query, use-countdown
lib/             json-storage, crypto, auth, session, api, validation,
                 audit, mailer, notify, repository, rate-limit, constants
types/           domain model
middleware.ts    the single gate in front of every page
scripts/         seed.mjs, genkey.mjs
```

---

## UI notes

- **Light and dark mode.** Every colour resolves through HSL custom properties in
  `globals.css`, so the two themes differ by that one block. No component
  hard-codes a colour.
- **Responsive.** `body` has `overflow-x: hidden` and the main column has
  `min-w-0`, so the page never scrolls sideways. Wide tables scroll inside their
  own container; below `md` the credential table becomes stacked cards, because
  a horizontally scrolling table would put the reveal and copy buttons out of
  reach on a phone.
- **Sidebar.** A permanent, collapsible rail from `lg` up; an off-canvas drawer
  below it, which closes on navigation and on `Escape`. The active-item highlight
  is a shared `layoutId` pill, so it slides rather than blinks.
- **Animation.** Framer Motion for page transitions, card entrances and the
  wizard steps; CSS for the ambient blobs and the button ripple, so they cost
  nothing per frame. Everything stops under `prefers-reduced-motion: reduce`.
- **Search.** `Ctrl`/`Cmd` + `K` opens a keyboard-driven palette over
  organizations, sources, usernames and URLs. In-flight requests are aborted when
  a newer one starts, so results can never arrive out of order.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (also type-checks and lints) |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run seed` | Bootstrap `data/`. `-- --force` to recreate, `-- --no-demo` for accounts only |
| `npm run genkey` | Generate `JWT_SECRET` and `MASTER_ENCRYPTION_KEY` |

---

## Deployment notes

The JSON datastore is a real constraint, and an intentional one:

- **Single instance only.** Atomic writes protect against a crash, not against
  two processes writing the same file. Do not run multiple replicas.
- **Persistent disk required.** `data/` must survive restarts, which rules out
  ephemeral filesystems (Vercel's included). A small VM or container with a
  mounted volume is the right shape.
- **Rate limiting is process-local.** `lib/rate-limit.ts` uses an in-memory Map;
  horizontal scaling would need Redis behind the same interface.
- **HTTPS.** Session cookies set `secure` in production, so the app must be
  served over TLS or nobody will be able to sign in.

---

## Built for migration

The architecture keeps these options open without paying for them now:

- **Database.** `Collection<T>` is a repository interface; swap the
  implementation, leave the callers alone.
- **Multi-user.** Nothing assumes two accounts — roles are data, and
  `lib/auth.ts` holds a capability matrix rather than scattered `role === 'admin'`
  checks.
- **WhatsApp OTP / QR login.** `lib/reset-flow.ts` already separates
  "issue a token" from "verify a token"; a new channel only needs a new sender.
- **CSV import/export, browser extension.** The API is a clean JSON envelope
  (`{ ok, data }` / `{ ok, error, fields }`) behind a documented CSRF header.
