# Deploying to Vercel (from GitHub)

**Live:** <https://tabulavibe-ai.vercel.app> · Vercel project `shiwam/tabulavibe-ai` (Hobby) · Git: `ShiwamMishra-0599k/tabulavibe-ai`, production branch `main`.

Check any deployment with the full browser suite (desktop + Pixel 7, no local servers):

```powershell
cd frontend; $env:E2E_BASE_URL = 'https://tabulavibe-ai.vercel.app'; npx playwright test; Remove-Item Env:E2E_BASE_URL
```

One Vercel project serves everything on one domain, using [Vercel Services](https://vercel.com/docs/services)
(configured in [`vercel.json`](../vercel.json)):

| Path | Service | What runs |
|---|---|---|
| `/api/*` | `api` (`backend/`) | FastAPI as one Python 3.14 Vercel Function (entrypoint `app.main:app`) |
| everything else | `web` (`frontend/`) | The Vite build (`npm run build` → `dist/`) from Vercel's CDN |

Because the browser and the API share one origin, no CORS configuration is needed. Every push to `main`
deploys to production (confirmed 2026-10-21); every other branch or pull request gets its own preview URL.

> Checked against vercel.com/docs on 2026-10-21. **Services is in beta**: if Vercel changes the format,
> see the fallback at the end.

## Limits that matter (Hobby plan, from vercel.com/docs/functions/limitations, 2026-10-21)

| Limit | Value | How TabulaVibe handles it |
|---|---|---|
| Request **and** response body | 4.5 MB | On Vercel (`VERCEL=1`) the upload limit defaults to **3.5 MB**, so cleaned-CSV downloads also stay under 4.5 MB |
| Python bundle size | 500 MB uncompressed | About 150 MB (pandas + numpy + openpyxl); tests and scripts are excluded |
| Max duration | 300 s | Set to 30 s (`maxDuration`); a typical request takes well under 1 s once warm |
| Memory | 2 GB / 1 vCPU | Enough for the 100,000-row / 2,000,000-cell limits |
| Region | `iad1` (US East) by default | Change it in Project → Settings → Functions (Mumbai `bom1` is closer to Indian users) |

**Cost:** the Hobby plan is free within its included usage, and Vercel's terms limit Hobby to
**personal, non-commercial** use. Using TabulaVibe for paid client work needs the Pro plan (check the current
pricing before then). Hobby has no overage billing: it stops serving when the limits are hit instead of charging.

## Automatic production settings

Vercel sets `VERCEL=1` at runtime, so the backend automatically uses:

- `TABULAVIBE_APP_ENV=production`: `/api/docs` and the OpenAPI schema are hidden
- `TABULAVIBE_MAX_UPLOAD_MB=3.5`

An environment variable you set in Vercel always overrides these defaults.

## Deploy (first time)

1. Make sure the code is on GitHub (`main` of `ShiwamMishra-0599k/tabulavibe-ai`).
2. Go to <https://vercel.com/new> → **Continue with GitHub** (sign up or sign in with your GitHub account).
3. **Import Git Repository** → choose `tabulavibe-ai`. If it is not listed, choose **Adjust GitHub App
   Permissions** and give Vercel access to this repository only.
4. Leave **Root Directory** as `./` (the repository root, where `vercel.json` lives). Vercel reads the two
   services from `vercel.json`, so no framework, build or output settings are needed.
5. Environment variables: none are required. Optional ones are listed below.
6. **Deploy**. The first build installs npm and Python packages and takes a few minutes.
7. Open the production URL (`https://<project>.vercel.app`) and check:
   - `/api/health` returns `{"status":"ok","version":"0.3.0"}`
   - load a sample → Analyse → Run analysis → Report → download both CSVs
   - `/api/docs` returns 404 (production)

### Alternative: Vercel CLI

```powershell
npx vercel@65.0.0 login          # opens the browser; choose "Continue with GitHub"
npx vercel@65.0.0 link           # creates or links the project (run from the repo root)
npx vercel@65.0.0 git connect    # connects the GitHub repo so pushes deploy automatically
npx vercel@65.0.0 deploy --prod
```

## Optional environment variables (Project → Settings → Environment Variables)

| Variable | When |
|---|---|
| `TABULAVIBE_SUPABASE_URL`, `TABULAVIBE_SUPABASE_ANON_KEY` | Turn on sign-in and saved reports (see [SUPABASE_SETUP.md](SUPABASE_SETUP.md)) |
| `TABULAVIBE_AI_PROVIDER=gemini`, `TABULAVIBE_GEMINI_API_KEY` | Turn on AI commentary (mark the key as **Sensitive**) |
| `TABULAVIBE_GITHUB_REPO` | Change or hide (empty) the navbar star badge |

Redeploy after changing variables (Deployments → ⋯ → Redeploy).

### If you enable Supabase sign-in on Vercel

Add the production URL in four places (replace `<project>`):

- Supabase → Authentication → URL Configuration: Site URL `https://<project>.vercel.app`, Redirect URL `https://<project>.vercel.app/**`
- Google Cloud OAuth client → Authorized JavaScript origins: `https://<project>.vercel.app`
- GitHub OAuth app → Homepage URL: `https://<project>.vercel.app`
- (Optional) preview deployments: add `https://*-<your-vercel-username>.vercel.app/**` to Supabase Redirect URLs

## Verified locally

First production deployment (2026-10-21, commit `6866091`, build 40 s, Python function about 52 MB):
all API checks, the 3.5 MB limit (413), hidden docs, security headers (`X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy`, HSTS from Vercel, immutable `/assets` caching) and all 8 Playwright journeys passed.

Before that, `vercel dev -L` (Vercel CLI 65.0.0, no login) ran both services from this `vercel.json`. Through the Vercel
router: `/` served the frontend, and `/api/health`, `/api/samples/retail-sales`, `/api/profile`,
`/api/analyze`, `/api/export/cleaned` and `/api/github` worked. `/api/docs` returned 404 and the upload limit
was 3.5 MB (the `VERCEL=1` defaults). The security headers in `vercel.json` are not applied by the local dev
server, so check them on the first real deployment (`curl -I https://<project>.vercel.app/`).

## Fallback if Services changes

Deploy two Vercel projects from the same repository: Root Directory `frontend` (Vite preset, set
`VITE_API_BASE_URL` to the API project's URL) and Root Directory `backend` (FastAPI preset). Then set
`TABULAVIBE_ALLOWED_ORIGINS` on the API project to the frontend's URL. Fix TECHNICAL_REFERENCE finding F10
(500 responses without CORS headers) before relying on this cross-origin setup.
