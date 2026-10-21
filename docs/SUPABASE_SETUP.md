# Supabase setup: sign-in and saved reports

TabulaVibe works fully without an account. When Supabase is configured, people can also **sign up / sign in
with Google (Gmail) or GitHub** and **save reports** to reopen later. This guide connects a Supabase project
in about 20 minutes. All steps are done in your own browser accounts; nothing here is automated.

> Checked against supabase.com on 2026-10-21. Dashboard menus move around; follow the closest match.

## What gets stored

| Table | Contents | Who can read it |
|---|---|---|
| `profiles` | Name, email, avatar URL and provider (`google`/`github`) from the sign-in provider. Created automatically on first sign-in. | The account owner only |
| `reports` | Report title, file name, row/column counts, analysis settings, **aggregated** results, data-quality summary, optional AI commentary | The account owner only |

Uploaded files and their rows are **never stored**. Row Level Security (RLS) enforces "own rows only" inside
the database. The backend uses only the public anon/publishable key plus the signed-in user's own access token,
so it cannot read anyone else's data even if it had a bug.

## Cost (Free plan, as listed on supabase.com/pricing on 2026-10-21)

500 MB database per project, 50,000 monthly active users, 5 GB egress, up to 2 active free projects.
**Free projects pause after one week without activity.** Restore them from the dashboard. A saved report is
typically 5–50 kB, so 500 MB holds many thousands. Do not add a payment method if the ₹0 budget must hold.

## 1. Create the project

1. Sign in at <https://supabase.com/dashboard> (you already use GitHub for this) → **New project**.
2. Name `tabulavibe`. Set a strong database password and save it in your password manager; TabulaVibe never needs it.
3. Region: **South Asia (Mumbai)** for Indian users. Plan: **Free**.

## 2. Create the tables

1. **SQL Editor → New query**.
2. Paste the whole of [`supabase/migrations/20261021000000_profiles_and_reports.sql`](../supabase/migrations/20261021000000_profiles_and_reports.sql) → **Run**.
   It is safe to run again.
3. Check **Table Editor**: `profiles` and `reports` exist, and both show **RLS enabled**.

## 3. Turn on GitHub sign-in

1. Supabase: **Authentication → Sign In / Providers → GitHub**. Copy the **Callback URL**
   (`https://<project-ref>.supabase.co/auth/v1/callback`).
2. GitHub: <https://github.com/settings/developers> → **OAuth Apps → New OAuth App**.
   - Application name: `TabulaVibe AI`
   - Homepage URL: `http://localhost:5180` (change it after deployment)
   - Authorization callback URL: the Supabase callback URL from step 1
3. **Register application → Generate a new client secret**.
4. Back in Supabase, enable GitHub, paste the **Client ID** and **Client Secret** → **Save**.
   The secret lives only in Supabase. Never put it in TabulaVibe's `.env`.

## 4. Turn on Google (Gmail) sign-in

1. <https://console.cloud.google.com> → create or select a project (no billing needed).
2. **Google Auth Platform → Branding**: app name `TabulaVibe AI`, your support email. Audience: **External**.
   While the app is in *Testing*, add your Gmail address(es) under **Audience → Test users**.
3. **Data Access (Scopes)**: add `openid` (email and profile are included by default). No sensitive scopes.
4. **Clients → Create client → Web application**.
   - Authorized JavaScript origins: `http://localhost:5180`
   - Authorized redirect URIs: the Supabase callback URL from step 3.1
5. Copy the **Client ID** and **Client Secret** → Supabase **Authentication → Sign In / Providers → Google**,
   enable it, paste both → **Save**.

## 5. Allow TabulaVibe's address

Supabase: **Authentication → URL Configuration**

- Site URL: `http://localhost:5180`
- Redirect URLs: add `http://localhost:5180/**` (later also your CloudFront URL, e.g. `https://dxxxx.cloudfront.net/**`)

## 6. Connect the backend

1. Supabase: **Project Settings → API Keys**. Copy the **Project URL** and the **publishable** key
   (`sb_publishable_…`; on older projects, the legacy `anon` key).
2. Edit `backend/.env` (gitignored; create it from `.env.example`):

   ```ini
   TABULAVIBE_ALLOWED_ORIGINS=http://localhost:5180,http://127.0.0.1:5180
   TABULAVIBE_SUPABASE_URL=https://<project-ref>.supabase.co
   TABULAVIBE_SUPABASE_ANON_KEY=<publishable or anon key>
   ```

   **Never** use the `service_role` / `sb_secret_…` key: it bypasses RLS. The backend refuses to start with it.
3. Restart the backend. `GET /api/config` now shows `"storage": {"enabled": true, …}` and the header shows
   **Sign in / Sign up**.

## 7. Try it

1. Open <http://localhost:5180> → **Sign up** → **Sign up with Google** (or GitHub) → approve.
2. You return signed in; your name appears in the header and a row appears in `profiles`.
3. Load a sample → Analyse → **Run analysis** → **Report & export** → **Save to my reports**.
4. **My reports** lists it; open it, print it, delete it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No Sign in button | `TABULAVIBE_SUPABASE_URL`/`_ANON_KEY` not set, or backend not restarted |
| `redirect_uri_mismatch` (Google) | The Google client's redirect URI must be exactly the Supabase callback URL |
| Google says "access blocked" / "app not verified" | Add your Gmail address as a test user (step 4.2) |
| After sign-in you land on the wrong address | Add the address to Supabase **Redirect URLs** (step 5) |
| "Your sign-in has expired" | Sign out and in again; check the project is not paused |
| "No TabulaVibe profile exists" | The SQL in step 2 was not run (it also creates profiles for existing accounts) |
| Saving fails with HTTP 404 from the database | The `reports` table is missing: run step 2 |
