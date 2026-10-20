# Demo script (90 seconds)

Run `npm run db:reset-demo` before judging so the demo account is fresh, then `npm run dev`.

The demo account holds **simulated** sample data. Say so out loud, and the app labels it `SAMPLE DATA` everywhere.

## 0:00 — The problem (10 s)

> "Most study apps track what you studied. They can't tell you what you're about to forget, and they never check whether their own predictions were right. Forgetting Forecast does both."

Open `/welcome`. The sun sets into the grid: **KNOW WHAT YOU'LL FORGET.**

## 0:10 — The demo dashboard (20 s)

Click **Try the demo** (one click, signed in server-side; the password never reaches the browser).

- Point at **"N concepts are fading"** and the **Start review** button: the next action is obvious.
- Point at the four tiles. Two are `ESTIMATE` (due now, at risk in 7 days) and two are `OBSERVED` (delayed recall accuracy, Brier score), each with its sample size. A tile with too little data shows **—**, never a made-up number.
- Point at the neon curve: predicted recall falling toward the 80% target line, with the learner's real attempts as dots.

## 0:30 — One review (25 s)

Click **Start review**. Keyboard only:

1. Press `4` (confidence), `Enter` (reveal).
2. `→` then `Enter` to grade it **GOT IT**.
3. The screen flashes **FORECAST UPDATED: 11% → 15% in 7 days** from the server's updated state.

Mention that the prediction stored with this attempt was computed on the server **before** the answer was known, so it can't be forged or skewed by the client.

## 0:55 — Proof it isn't just a pretty curve (25 s)

Open **Analytics**.

- **Immediate vs delayed accuracy** with n for each.
- **Calibration chart**: "When the model said about 75%, you were right 87% of the time (n = 83)."
- **Model vs baseline**: the model's Brier score next to two simple baselines on the same attempts. Read the result out as computed, including when the model does **not** win. On the seeded demo data it does not beat "your past accuracy"; that is the honest answer and the point of the page.
- Open any concept → **Forecast log**: every forecast was saved before the outcome, can't be edited, and is marked pending / evaluated / expired.

## 1:20 — Close (10 s)

> "Most study apps track what you studied. We forecast what you'll forget, and prove whether we were right."

## If something goes wrong

| Symptom | Fix |
|---|---|
| "Could not start the demo" | `npm run db:seed` (creates the demo user), check `DEMO_PASSWORD` in `.env.local` |
| Dashboard shows nothing due | `npm run db:reset-demo` |
| Blank/unstyled page in dev | Restart `npm run dev` (clear `.next` if it persists) |
