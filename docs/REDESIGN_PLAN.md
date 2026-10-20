# Forgetting Forecast — Synthwave Redesign Plan (Hackathon)

Theme: **Retro-Futurism / Synthwave / Y2K**. A "1986 weather station that forecasts your memory."
Goal: a judge opens the app and understands the product in under 60 seconds, and it looks like nothing else in the room.

This file is the source of truth for the coding agents. Each task below is self-contained: give an agent the
**Agent preamble** plus one task section.

---

## 0. Why the app looks bad right now (verified 2026-10-20)

1. **Tailwind is not installed.** Every page and component in `src/app/**` and `src/components/**` is written with
   Tailwind utility classes (`bg-brand-600`, `text-neutral-500`, `lg:ml-[var(--layout-sidebar-width)]`, `space-y-6`, ...),
   but `package.json` has no `tailwindcss` and there is no PostCSS config. **Those classes do nothing**, so most of the UI
   renders unstyled. This is the main problem, and fixing it is Task T0.
2. **Two competing style systems.** `src/app/globals.css` (imported by `layout.tsx`) is a minified legacy stylesheet
   from the old single-page version. Only the auth pages (`auth-page`, `auth-card`, ...) still use its classes.
   `src/styles/globals.css` and `src/styles/tokens.ts` are **imported nowhere** (dead code).
3. **Font mismatch.** `layout.tsx` loads Inter through `next/font`, while the legacy CSS also imports DM Sans and Manrope
   from Google Fonts.
4. **No landing page.** `/` is the protected dashboard, so a judge's first screen is a sign-in form.
5. **No demo data.** The seed script creates only 4 concepts, so the forecasts, calibration and history screens look empty.

The fix: install Tailwind v4 and use `@theme` tokens set to a synthwave palette. That brings every existing class back to
life in the new theme at once. Then redesign each screen on top of that.

---

## 1. Design system

### 1.1 Palette (dark-first; there is no light mode for the hackathon)

| Token | Hex | Use |
|---|---|---|
| `void` | `#07040f` | Page background (behind the grid) |
| `night` | `#0f0826` | App background |
| `panel` | `#170d33` | Panel / card surface (85% opacity over the grid) |
| `panel-hi` | `#22154a` | Raised surface, hover |
| `line` | `#3a2a6e` | Borders, grid lines |
| `ink` | `#f1ecff` | Primary text |
| `ink-dim` | `#a99fd6` | Secondary text (≥4.5:1 on `panel`) |
| `magenta` | `#ff2bd6` | Primary action, brand |
| `cyan` | `#22e4ff` | Forecast line, links, focus ring |
| `sunset` | `#ff8a3d` | Highlights, warnings in the gradient |
| `sun` | `#ffe14d` | Sun / accent text |
| `violet` | `#8b5cf6` | Secondary accent |
| `strong` | `#39ffb0` | Status: retained / strong |
| `watch` | `#ffd23f` | Status: review soon |
| `due` | `#ff3d7f` | Status: due now / at risk |

Gradients:
- **Sunset**: `linear-gradient(180deg, #ffe14d 0%, #ff8a3d 40%, #ff2bd6 75%, #8b5cf6 100%)`. Used on the hero sun, the primary CTA and the brand mark.
- **Chrome** (Y2K headings): `linear-gradient(180deg, #ffffff 0%, #c9c3ff 45%, #5b4aa8 50%, #e8e4ff 55%, #ffffff 100%)` with `background-clip:text`.

Glow: `--glow-magenta: 0 0 8px #ff2bd6aa, 0 0 24px #ff2bd655`, and the same for cyan. Use it only on key numbers, the active
nav item and the primary button, never on body text.

**Rule:** colour is never the only signal. Every status shows a text label or icon as well (`STRONG`, `WATCH`, `DUE`).

### 1.2 Typography (load with `next/font/google`; remove the CSS `@import`s)

| Role | Font | Notes |
|---|---|---|
| Display (page titles, big numbers) | **Orbitron** 700/900 | Uppercase, `letter-spacing: .08em`. Titles use the chrome gradient. |
| UI / body | **Chakra Petch** 400/500/600 | Techy but readable at 14px |
| Data / mono (percentages, timestamps, IDs) | **JetBrains Mono** 400/600 | `font-variant-numeric: tabular-nums` |

### 1.3 Signature elements (use all of them, sparingly)

1. **Perspective grid floor.** A fixed background layer: a CSS `linear-gradient` grid in `line` colour, rotated with `perspective(600px) rotateX(60deg)` and fading to `void` at the horizon. The grid scrolls slowly (`translateY` animation) and stops under `prefers-reduced-motion`.
2. **Striped sunset sun.** A circle with the sunset gradient and horizontal "venetian" gaps cut with `mask-image: repeating-linear-gradient`. Used on the landing hero, auth pages and the big empty states.
3. **CRT scanlines.** A full-screen `::after` overlay with `repeating-linear-gradient` at 3% opacity and `pointer-events:none`. It can be switched off in Settings (stored in `localStorage`, read inside try/catch).
4. **Window chrome panels (Y2K).** Panels get a thin title bar: a mono uppercase label, three small dots or squares on the right, and a 1px inner bevel highlight. Component: `<TerminalPanel title="FORECAST.EXE">`.
5. **Glossy bevel buttons.** The primary button uses the sunset gradient, a 1px white inner top highlight and a magenta glow on hover/focus. The secondary button is a transparent outline in `line` that turns cyan on hover.
6. **The neon forecast curve.** A cyan glowing predicted-recall line over a grid, with observed attempts as magenta (correct) or hollow (incorrect) dots and a dashed "now" marker. This is the product's hero visual.

### 1.4 Motion

- 150–250ms ease-out on hover and focus. No bouncy springs.
- One "boot" moment: on first dashboard load, the forecast curve draws in (`stroke-dashoffset`) over 900ms.
- Every animation is turned off under `@media (prefers-reduced-motion: reduce)`.

### 1.5 Voice and microcopy (adds the theme cheaply)

- Section labels in mono caps: `// TODAY'S TRANSMISSION`, `SIGNAL STRENGTH`, `MEMORY WEATHER`.
- Metaphor: retention is a **weather forecast**. "72% chance of recall in 7 days." "Fog rolling in: 3 concepts."
- Keep it honest. Every forecast is labelled **ESTIMATE**, observed results are labelled **OBSERVED**, and sample data is
  labelled **SAMPLE DATA**. The product spec requires this, and judges reward it.

---

## 2. Guardrails for every task

- **Do not touch** `src/server/**`, `src/domain/**`, `src/app/api/**`, `supabase/**` or `src/lib/forecast.ts`, except where T10 says so. This is a UI redesign.
- **No new UI or chart libraries.** Use Tailwind v4, `lucide-react` (already installed), `clsx` and hand-written SVG. Tailwind and its PostCSS plugin are the only new dependencies.
- Reuse `src/components/ui/*` and `cn()` from `src/lib/utils.ts`. Don't create duplicate primitives.
- Accessibility: visible cyan focus ring, keyboard reachable, `aria-label` on icon buttons, chart `<title>`/`<desc>` plus a text summary.
- Mobile: works at 375px, with no horizontal scroll and a 16px gutter.
- Every task ends with `npm run typecheck`, `npm run lint` and `npm run build` passing, plus browser screenshots at 1440px and 375px.

---

## 3. Task graph

```
T0 Foundation ──┬─► T1 Primitives ──┬─► T2 Shell ──┬─► T5 Dashboard
                │                   │              ├─► T6 Review workspace
                │                   ├─► T4 Landing + Auth
                │                   │              ├─► T7 Library + Concept detail
                └─► T3 Charts ──────┴──────────────├─► T8 Analytics + History + Model Lab
                                                   └─► T9 Settings + Toasts/Dialogs
T10 Demo data (independent, start any time) ─────────────────────────────► T11 QA + pitch polish (last)
```

- **Sequential:** T0 first, alone.
- **Parallel wave 1:** T1, T3, T10.
- **Parallel wave 2:** T2, T4.
- **Parallel wave 3:** T5, T6, T7, T8, T9 (each owns its own page files).
- **Last:** T11.

Hackathon cut line: **T0 to T6 plus T10 is the minimum to demo.** T7 to T9 are next. T11 always runs.

---

## Agent preamble (paste before every task)

> You are working in `forgetting-forecast/` (Next.js 15 App Router, React 19, TypeScript, Supabase).
> We are redesigning the UI in a Retro-Futurism / Synthwave / Y2K style. Read `docs/REDESIGN_PLAN.md` sections 1 and 2 first;
> they are binding. Only edit the files your task lists. Don't change backend, API or domain code.
> Before finishing, run `npm run typecheck && npm run lint && npm run build`, open the affected pages in a browser at 1440px and
> 375px, fix what looks wrong, and report exactly what you ran and saw. If something could not be verified, say "not verified".

---

## T0 — Foundation: install Tailwind v4 + synthwave tokens  *(blocking, do first)*

**Files:** `package.json`, new `postcss.config.mjs`, `src/app/globals.css` (rewrite), `src/app/layout.tsx`.
Delete `src/styles/globals.css` and `src/styles/tokens.ts` (both unused; confirm with grep first).

Steps:
1. `npm i -D tailwindcss @tailwindcss/postcss postcss`. Create `postcss.config.mjs` with `{ plugins: { '@tailwindcss/postcss': {} } }`.
2. Rewrite `src/app/globals.css`:
   - `@import "tailwindcss";`
   - An `@theme { ... }` block that defines every colour the codebase already uses, so existing classes start working:
     - `brand-50…950` → the magenta ramp (600 = `#ff2bd6`).
     - `neutral-50…950` → **inverted dark ramp** (50 = `night`, 100 = `panel`, 200 = `panel-hi`, 300 = `line`, 500 = `ink-dim`, 900 = `ink`). This one trick turns every existing `bg-neutral-50` / `text-neutral-900` into dark mode.
     - `success-*` → the `strong` ramp, `warning-*` → `watch`, `danger-*` → `due`, `info-*` → `cyan`.
     - The section 1.1 tokens as named colours (`void`, `night`, `panel`, `line`, `ink`, `ink-dim`, `magenta`, `cyan`, `sunset`, `sun`, `violet`, `strong`, `watch`, `due`).
     - `--font-display`, `--font-sans`, `--font-mono` wired to the next/font CSS variables.
   - The layout variables already referenced in code: `--layout-sidebar-width: 260px`, `--layout-sidebar-collapsed-width: 76px`, `--layout-header-height: 64px`.
   - Base layer: `body` background `night`, colour `ink`; the scanline overlay (`body::after`, toggled by `html[data-scanlines="off"]`); the grid-floor class `.synth-grid`; utilities `.text-chrome`, `.glow-magenta`, `.glow-cyan`, `.bg-sunset`; the reduced-motion block.
   - Port the legacy `.auth-*` and `.input-*` classes into restyled synthwave equivalents so auth keeps working until T4 replaces them. Drop every other legacy class (confirm none are referenced with grep).
3. Search the codebase for `bg-white`, `text-black`, `border-gray`, `bg-gray`, `text-gray` and other hard-coded light colours. Replace them with token classes.
4. `layout.tsx`: load Orbitron, Chakra Petch and JetBrains Mono through `next/font/google` as CSS variables. Set `<html className="dark">` and add `<meta name="theme-color" content="#0f0826">`. Retitle the page to "Forgetting Forecast — Memory Weather".

**Done when:** the existing pages render dark and themed, with no unstyled raw HTML, and the build passes. Take screenshots of `/`, `/review`, `/library` and `/auth/signin`.

---

## T1 — UI primitives  *(after T0)*

**Files:** `src/components/ui/*` (restyle the existing components and add new ones), `src/components/ui/index.ts`.

- Restyle `Button` (primary = glossy sunset bevel; secondary = outline; ghost; danger = `due`), keeping its API. Restyle `Card`, `Badge` and `Input` (dark field, `line` border, cyan focus glow).
- Add:
  - `TerminalPanel` (window-chrome panel; props `title`, `actions?`, `children`)
  - `StatTile` (label in mono caps, big Orbitron value with optional glow, a delta or foot line, an `estimate | observed` tag)
  - `StatusPill` (`strong | watch | due | pending`, always with a text label)
  - `ProgressRing` (SVG, value 0–1, accessible label)
  - `EmptyState` (sun icon, title, body, action)
  - `Skeleton` (shimmer, static under reduced motion)
  - `Toast` + `ToastProvider` (simple context, aria-live polite, auto-dismiss 4s)
  - `Dialog` (native `<dialog>` element, focus trap via the element itself, Esc to close)
  - `SunsetSun` (the striped sun, props `size`)
- Add a `/dev/ui` page that renders every primitive in every state. It is the visual QA sheet for the other agents. Exclude it from the nav.

**Done when:** `/dev/ui` shows every component in every state at 1440px and 375px and keyboard focus is visible on everything.

---

## T2 — App shell  *(after T1)*

**Files:** `src/components/layout/AppShell.tsx`, `Sidebar.tsx`, `Header.tsx`.

- Fixed background: a `.synth-grid` floor in the bottom 40% of the viewport and a faint horizon glow line.
- Sidebar: brand mark (a small striped sun plus "FORGETTING / FORECAST" in Orbitron), nav items with lucide icons, the active item with a magenta left bar and glow, and a due-count badge on Review. Order: Dashboard, Review, Library, Forecasts/Analytics, History, Model Lab, Settings.
- Under 1024px: hide the sidebar and show a **bottom tab bar** (Dashboard, Review, Library, Analytics, More) plus a header menu button.
- Header: a breadcrumb in mono, a "▶ START REVIEW (n due)" primary button, a user menu, and a "SAMPLE DATA" pill whenever the demo account is active.
- Remove the `mounted` spinner flash. Render the shell on the server and handle the responsive behaviour with CSS instead of `window.innerWidth` state.

**Done when:** navigation works on desktop and mobile, there is no layout shift on load, and the bottom bar works at 375px.

---

## T3 — Chart components  *(after T0; parallel with T1)*

**Files:** new `src/components/charts/` (`ForecastCurve.tsx`, `RetentionBars.tsx`, `CalibrationChart.tsx`, `Sparkline.tsx`, `index.ts`).
Read `src/lib/forecast.ts` and `src/types/index.ts` to get the real data shapes. **Don't change them.**

- `ForecastCurve`: x = time (past observations plus future horizon), y = recall probability 0–100%. Cyan glowing line for predicted recall; magenta dots for correct observed attempts and hollow `due` dots for incorrect ones; dashed vertical "NOW" line; dashed horizontal target line (for example 80%); optional uncertainty band **only when the data provides one**. Horizon switcher: 1D / 7D / 30D. Boot animation via `stroke-dashoffset`. Pure SVG with `viewBox`, so it is responsive.
- `RetentionBars`: horizontal bars per concept, coloured by status, with a label and percentage in mono.
- `CalibrationChart`: a reliability diagram (predicted bucket against observed frequency) with the diagonal as reference, and `n` shown per bucket. Buckets with n < 5 are drawn hollow and marked "low sample".
- `Sparkline`: a small trend line for stat tiles.
- Every chart includes `<title>`, `<desc>` and a visually hidden text summary of its numbers.
- Add the charts to `/dev/ui` with fixture data. Inline the fixture data in the dev page; never put it in production code.

**Done when:** the charts render correctly with 0, 1 and many points (an empty state shows for zero) and look right at 375px.

---

## T4 — Public landing + auth pages  *(after T1)*

**Files:** new `src/app/welcome/page.tsx`, `src/components/auth/AuthForms.tsx`, `src/app/auth/**/page.tsx`, `src/components/auth/ProtectedRoute.tsx` (redirect target only).

- `/welcome` (public, shown to signed-out users instead of an instant sign-in redirect):
  - Hero: a giant striped sun setting into the grid floor, the chrome-text headline "KNOW WHAT YOU'LL FORGET.", the subline "Forgetting Forecast predicts your recall and tells you what to review before it fades.", the CTAs "▶ TRY THE DEMO" and "Sign up".
  - A 3-step strip: **RECALL → FORECAST → INTERVENE**.
  - A static ForecastCurve preview labelled SAMPLE DATA.
  - An honesty block: "Every forecast is checked against your real delayed results."
- Change ProtectedRoute so it redirects signed-out users to `/welcome` instead of the sign-in page.
- Auth pages: centred `TerminalPanel` titled `LOGIN.EXE` / `NEW_USER.EXE` over the sun and grid, restyled inputs, inline errors. Behaviour and Supabase calls stay as they are.
- Remove the temporary `.auth-*` CSS from T0 once nothing references it.

**Done when:** signed-out `/` goes to `/welcome`, signup, signin and password reset still work end to end, and everything looks right at 375px.

---

## T5 — Dashboard ("Memory Weather")  *(after T2, T3)*

**Files:** `src/app/page.tsx` only. It keeps calling the existing `/api/dashboard` and `/api/review-queue` through `src/lib/api.ts`.

Layout, top to bottom:
1. **Next-action hero:** "// TODAY'S TRANSMISSION — 5 concepts are fading. ~6 min." with a big primary button **START REVIEW**. When nothing is due, show "All signals strong" plus the next due time.
2. **4 StatTiles:** Due now · At risk in 7d · Delayed recall accuracy (OBSERVED) · Forecast calibration (Brier, with an n count). Show "—" plus "needs more reviews" when there is not enough data. Never invent numbers.
3. **Main row:** `ForecastCurve` for the most at-risk concept (with a concept switcher) on the left, and the **review queue** on the right (rank, concept, recall %, StatusPill, a one-line "why", and a play button per row).
4. **Upcoming risk:** `RetentionBars` for concepts that cross below the target within the next 7 days.
- Loading uses Skeletons; errors use a `TerminalPanel` with "SIGNAL LOST" and a retry button; new users get an EmptyState that leads to "Add your first concept".

**Done when:** it shows real API data and reads in about 5 seconds: what to do next is obvious. Screenshots with data, empty and error states.

---

## T6 — Review workspace  *(after T2)*

**Files:** `src/app/review/page.tsx` only. Keep the submit logic, the timing capture and the `/api/reviews` contract **exactly** as they are.

- A focused full-height "arcade cabinet" layout: the prompt in a large `TerminalPanel`, with progress as segmented neon pips ("3 / 8").
- Flow: prompt → answer textarea → confidence (1–5 as 5 chunky segmented buttons) → **REVEAL** → the correct answer slides in → self-grade (**✗ MISSED** / **✓ GOT IT**) → a short "forecast updated: 64% → 81% in 7d" flash using the API response values → next.
- Keyboard: `Enter` reveal / submit, `1`–`5` confidence, `←` missed, `→` got it, `Esc` pause. Show a key-hint row under the controls.
- Pausing must stop the latency timer. Check how the current code measures time and keep that intact.
- Session complete screen: a sun rising, a summary (correct / total, average confidence, concepts moved to strong), and "Back to dashboard" / "Review more".
- Save failure: never show success. Show a "NOT SAVED — retry" toast and keep the answer.

**Done when:** a full session works keyboard-only and the attempts appear in History afterwards (check the network tab shows 2xx).

---

## T7 — Library + Concept detail  *(after T1, T3)*

**Files:** `src/app/library/page.tsx`, `src/app/concepts/[id]/page.tsx`.

- Library: search plus a subject filter (chips); a grid of concept "cartridges" (title, subject tag, ProgressRing recall %, StatusPill, last reviewed); an "+ ADD CONCEPT" Dialog (title, subject, prompt, expected answer, importance) that replaces any modal or native confirm. Delete goes through a confirm Dialog and then a toast.
- Concept detail: header with an edit button; a large `ForecastCurve`; a "Why it's prioritized" panel listing only the factors the API actually returns; an attempts timeline (OBSERVED); a forecast log (ESTIMATE, immutable, with evaluated/pending tags if the data has them); a "Review this now" button.

**Done when:** create, edit and delete work against the API and the detail page shows real history.

---

## T8 — Analytics + History + Model Lab  *(after T3)*

**Files:** `src/app/analytics/page.tsx`, `src/app/history/page.tsx`, `src/app/model/page.tsx`.

- Analytics: immediate vs delayed accuracy (paired bars), retention by subject, a `CalibrationChart` with a Brier score StatTile and n, and a plain-language reading ("When we say 70%, you were right 66% of the time (n=48)").
- History: a filterable log table in mono (date, concept, result, confidence, latency), styled as a terminal printout, paginated.
- Model Lab: restyle as "THE LAB". Keep the existing simulation but label it clearly as SIMULATION. Use sliders with neon tracks and the formula in a `TerminalPanel`.
- Remove the 5 or so inline `style={{}}` usages in analytics in favour of classes where it is practical.

**Done when:** every number traces back to API data, empty states appear when n is too low, and nothing is fabricated.

---

## T9 — Settings + global toasts/dialogs  *(after T1, T2)*

**Files:** `src/app/settings/page.tsx`, `src/app/layout.tsx` (mount `ToastProvider` only), plus any remaining `window.confirm` / `alert` calls (grep for them).

- Settings sections in TerminalPanels: Profile, Study preferences (daily goal, target recall %), Display (**scanlines on/off**, **reduce motion**), Data (export JSON button using the existing API data, delete account with a confirm Dialog), Sign out.
- Replace every `window.confirm` / `alert` call in the app with `Dialog` or `Toast`.

**Done when:** the toggles persist across reloads (with a safe `localStorage` fallback) and no native dialogs remain.

---

## T10 — Demo account + rich seed data  *(independent; start any time)*

> **Superseded by `docs/BACKEND_PLAN.md` → B8.** Run B8 instead. Don't run both. The notes below are kept for context only.

**Files:** `scripts/seed.ts` (and a new SQL file only if needed). This is the one task allowed near the database, and only through the seed script.

- Seed a **demo user** with about 15 concepts across 3 subjects (DSA, Databases, Biology) and **4–6 weeks of backdated review history**: a mix of correct and incorrect attempts with confidence and latency, so forecasts, the queue, calibration and history all have real content. Write it through the same tables and service paths the app uses so forecasts are computed for real, not hard-coded.
- Mark the account as demo (for example an email of `demo@forgetting-forecast.test` or a profile flag) so the header can show the **SAMPLE DATA** pill.
- `/welcome` "Try the demo" signs into this account. Credentials live in `.env.example` and the seed file, never in client code shown to users. If that isn't safe, fall back to a documented "demo login" in the README.
- Document it with `npm run db:seed` in the README.

**Done when:** seeding from a fresh DB gives a dashboard with 3–8 due items, a non-empty calibration chart and 100+ history rows.

---

## T11 — QA + pitch polish  *(last)*

- Contrast check of every text/background pair (≥4.5:1 for body, ≥3:1 for large text and UI). Fix `ink-dim` usages that fail.
- Keyboard-only run through: welcome → demo → dashboard → full review session → concept detail → analytics.
- `prefers-reduced-motion` on: no grid scroll, no curve draw-in, no shimmer.
- 375px, 768px and 1440px screenshots of every page. No horizontal scroll anywhere.
- Lighthouse (performance, accessibility, best practices) on `/welcome` and `/`; aim for 90+ accessibility.
- Favicon: the striped sun SVG. Open Graph image: the hero with sun and grid.
- `docs/DEMO_SCRIPT.md`: a 90-second judge walkthrough (problem → demo dashboard → one review → forecast updates → calibration proves honesty).
- Final `npm run typecheck && npm run lint && npm test && npm run build`.

---

## 4. Demo story for the judges (what all of this serves)

1. `/welcome`: the sun sets into the grid, "KNOW WHAT YOU'LL FORGET." → **Try the demo**.
2. Dashboard: "5 concepts are fading", with the neon curve dropping toward the target line.
3. Start a review and answer one card: the curve jumps up ("64% → 81% in 7 days").
4. Analytics: "When we say 70%, you were right 66% of the time." The forecasts are checked against reality.
5. Close: "Most study apps track what you studied. We forecast what you'll forget, and prove we were right."
