# Mind Dump

**Live:** https://gamernishant.github.io/mind-dump/

Empty your head: every thought becomes a tile. Click a tile when it's handled, and see how many days the rest have been waiting.

## Features

- **Tiles**: type a thought and press <kbd>Enter</kbd> (or paste a list and hit **Split into N** for one tile per line).
- **Click to clear**: the tile animates away into History, with an **Undo** toast.
- **History** (`/history`): cleared dumps grouped by day. You can restore, delete forever, or clear all.
- **Drag & drop** reordering: mouse, touch (press and hold) and keyboard (focus the grip, then Space plus the arrow keys).
- **Days pending** badge on every tile. The badge color warms with age: fresh → 3d → 7d → 14d+.
- **Sorting**: My order, Priority, Newest, Oldest (most pending), A→Z, Z→A, Shortest, Longest. Dragging in a sorted view adopts that order as "My order". There is also a search box.
- **Accounts**: email + password sign-up, sign-in, and password reset. Each user only ever sees their own data, enforced by Postgres row-level security.
- **Live sync** across devices through Supabase Realtime. Light, dark and auto themes. Responsive from 320px phones to wide desktops.
- Shortcuts: <kbd>n</kbd> or <kbd>/</kbd> focuses the composer; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> splits a multi-line dump.
- **Planner (Today)**: tap **+ Today** on a tile to queue it; the tile stays in the dump. Today is an ordered queue of **Blocks** (timed deep work with a first action and a minimum) and **Tasks**, with caps. **Start** opens a focus timer. **Skip** asks you to start for 2 minutes, shrink it, or skip with a reason and a destination. Repeating tiles add themselves each day and unfinished items carry over. A **Morning Check** and an evening **Shutdown** bracket the day. An hour log shows where the time went, by day or by **week**; for "Other" hours you can say what they were. **Rules** holds your if-then plans, and a short quote greets you each day.
- **Habits**: a habit stack for small daily things. They show highlighted on Today, one tap logs them, and the Habits page shows streaks, consistency and history.
- **Priority**: mark tiles High, Medium or Low (in the edit dialog). They get a flag and can be sorted by priority.
- **Edit or remove queue items**: tap the pencil on any Today item to rename it, set its priority or kind, or remove it when it's no longer relevant (optionally clearing its tile too). Undo is always offered.
- A warm "Sunrise" look, a greeting by name, and small confetti bursts when you finish things.
- **Backup**: **Download my data** in the account menu saves everything as a JSON file.

Docs: [DESIGN.md](DESIGN.md) covers architecture and decisions; [FLOW.md](FLOW.md) traces the code from entry to exit.

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · dnd-kit · Supabase (Auth + Postgres + Realtime) · sonner · Vitest · Playwright

```
src/
  domain/      plain types (Dump, AppUser)
  lib/         pure logic: days pending, sorting, fractional positions, text helpers
  data/        Backend interface + two implementations
    supabase/  cloud backend (auth, dumps, realtime)
    local/     device-only backend (localStorage); used when Supabase isn't configured
  state/       DumpsStore: optimistic updates, rollback, per-item request ordering
  auth/ theme/ hooks/ components/ pages/
supabase/migrations/   schema + RLS policies (run once)
e2e/                   Playwright tests (run against device-only mode)
```

Ordering uses fractional `position` values, so a drag rewrites a single row. Positions are re-spaced automatically when they get too close.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests
npm run test:e2e     # browser tests (desktop + mobile), needs: npx playwright install chromium
npm run build
```

The committed `.env` points at the live Supabase project, so `npm run dev` uses the real backend. For **device-only mode** (accounts and dumps stored in the browser, with no network needed), create `.env.local` containing `VITE_SUPABASE_URL=` and `VITE_SUPABASE_ANON_KEY=` (both empty). The Playwright suite always runs in device-only mode; `npx playwright test -c playwright.cloud.config.ts` smoke-tests a production build against the real backend, and `-c playwright.live.config.ts` does the same against the deployed site.

## Connect Supabase (free)

1. Create a project at [supabase.com](https://supabase.com) (the free tier is fine).
2. **SQL Editor → New query**: paste [`supabase/migrations/20261017000000_init.sql`](supabase/migrations/20261017000000_init.sql) and click **Run**. Do the same with [`supabase/migrations/20261018000000_planner.sql`](supabase/migrations/20261018000000_planner.sql) (the planner table). If you skip it, the Today page shows a setup card with the SQL and a link to the editor.
3. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key** into `.env`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   ```
4. **Authentication → URL Configuration**:
   - Set **Site URL** to your deployed URL.
   - Add `<your-url>/**` and `http://localhost:5173/**` under **Redirect URLs**.

   These are needed for the email-confirmation and password-reset links.
5. **Email (important).** Supabase's built-in mailer only delivers to members of your Supabase organization, and only a few emails per hour. Pick one:
   - Turn off **Authentication → Sign In / Providers → Email → Confirm email**, so anyone can sign up and use the app at once (password-reset emails still need option b), **or**
   - Set up free custom SMTP (e.g. Resend or Brevo) under **Authentication → Emails → SMTP Settings**, so confirmation and password-reset emails reach everyone.

The anon key is meant to be public. Row-level security is what keeps each user's data private.

## Deploy (free)

**GitHub Pages** (workflow included):

1. Push to a GitHub repo on branch `main`.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

The Supabase URL and publishable key are read from the committed `.env` (they are public values), so no repo secrets or variables are needed.

Each push then tests, builds and deploys to `https://<user>.github.io/<repo>/`.

**Vercel / Netlify / Cloudflare Pages**: import the repo. Use build command `npm run build` and output directory `dist`, and add the two env vars. SPA rewrites are already configured (`vercel.json`, `public/_redirects`).

Note: free Supabase projects pause after about a week without activity. Unpause the project from the dashboard if that happens.
