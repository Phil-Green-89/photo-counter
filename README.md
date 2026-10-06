# Photo Counter

A free, installable web app that counts items in a photo (pipe ends, rebar, lumber, boxes…).
Built for people who don't type much: big picture buttons, one number on screen, tap to fix.

```
phone (PWA, works offline)                      Supabase free tier (opt-in only)
┌────────────────────────────┐   insert-only   ┌──────────────────────────┐
│ camera → count → fix dots  │ ──────────────▶ │ feedback table (RLS)     │
│ IndexedDB feedback queue   │   anon key      │ feedback-images bucket   │
└────────────────────────────┘                 └────────────┬─────────────┘
                                                            │ service key (local only)
                                       training/export_dataset.py → YOLO dataset
                                       eval/report.py → accuracy by lighting
```

## Run it

```bash
cd app
npm install
npm run dev          # http://localhost:5173
```

Works with no backend at all. Feedback upload only turns on when both variables in `app/.env.example`
are set (copy it to `app/.env`).

## Test it

| Command (in `app/`) | What it covers |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm test` | Unit: counting, lighting buckets, habit memory, offline queue order, sync behaviour (fake backend) |
| `npm run test:e2e` | Real Chromium on a phone profile: draw box → count → remove/add/undo → zoom → consent → upload |
| `python -m unittest training.test_pipeline` (repo root) | YOLO export + accuracy report |

`npm run ci` runs the first three; GitHub Actions runs everything on every PR.

## Backend (Supabase, free, no card)

1. Create a project at supabase.com.
2. Run `supabase/migrations/0001_feedback.sql` in the SQL editor (or `supabase db push`).
3. Put the **anon** key and project URL in `app/.env` (and as repo *variables* `SUPABASE_URL`, `SUPABASE_ANON_KEY` for deploys).

Security model: the public key can only **insert**. Row-level security has no read, update or delete policy for
it, the photo bucket is private (JPEG, ≤1.5 MB), rows are size/shape-checked, and the app asks before sharing anything.
Reading data needs the **service** key, which only lives on your machine for the export script. Never put it in the app.

Limitation: anyone with the public key can insert junk (inserts are only shape-checked). Fine for a pilot; add
Supabase rate limits or a Cloudflare Turnstile + edge function before wide release.

## Learn from corrections

```bash
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… python training/export_dataset.py out/
python eval/report.py out/records.jsonl     # MAE / ±1 / 👍 per lighting bucket
yolo train data=out/data.yaml model=yolo11n.pt   # Kaggle/Colab free GPU
```

Poor-light and 👎 photos upload first, so the weakest cases arrive first.

## Deploy (free)

Push to `main` → `.github/workflows/deploy.yml` publishes to GitHub Pages
(Settings → Pages → Source: *GitHub Actions*; needs a public repo on a free account).

## What exists vs what's next

- ✅ Tap-one counting (template matching), lighting score + contrast boost, zoom/pan editing, item grid with habit memory, offline feedback queue, opt-in sync, export + report tooling, CI.
- ⏭ ONNX models: YOLO-nano pipe detector, DINOv2-small tap-one counter, tiled inference (see plan; needs a phone speed test first).
- Not verified: the SQL migration has not been run against a real Supabase project yet.
