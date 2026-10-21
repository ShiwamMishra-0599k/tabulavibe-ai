# Supabase setup: Google (Gmail) + GitHub sign-in, saved reports, sign-in-only uploads

When Supabase is configured, people **sign up / sign in with Google (Gmail) or GitHub**, can **save
reports**, and (with `TABULAVIBE_REQUIRE_SIGN_IN=true`) **must be signed in to upload or analyse files**.
The backend enforces this on every upload/analysis endpoint (`401` without a valid session); the website
only mirrors it.

All steps happen in your own accounts. Client secrets are pasted **only into Supabase**, never into
TabulaVibe, the repo, Vercel or a chat.

> Checked against supabase.com docs on 2026-10-21. Dashboard menus move around; follow the closest match.

## Values you will need

| Name | Value |
|---|---|
| Live site | `https://tabulavibe-ai.vercel.app` |
| Local site | `http://localhost:5180` |
| Supabase callback | `https://<project-ref>.supabase.co/auth/v1/callback` (shown in step 3.1) |

## What gets stored

| Table | Contents | Who can read it |
|---|---|---|
| `profiles` | Name, email, avatar URL and provider (`google`/`github`). Created automatically on first sign-in | The account owner only |
| `reports` | Report title, file name, row/column counts, analysis settings, **aggregated** results, data-quality summary, optional AI commentary | The account owner only |

Uploaded files and their rows are **never stored**. Row Level Security (RLS) enforces "own rows only" in the
database, and the backend uses only the public anon/publishable key plus the user's own access token.

**Cost (Free plan, supabase.com/pricing, 2026-10-21):** 500 MB database, 50,000 monthly active users, 5 GB
egress, up to 2 active free projects. **Free projects pause after one week without activity** (restore from the
dashboard). Do not add a payment method if the ₹0 budget must hold.

## 1. Create the project

1. <https://supabase.com/dashboard> → **New project**. Name `tabulavibe`, a strong database password (keep it in
   your password manager; TabulaVibe never needs it), region **South Asia (Mumbai)**, plan **Free**.

## 2. Create the tables

1. **SQL Editor → New query** → paste all of
   [`supabase/migrations/20261021000000_profiles_and_reports.sql`](../supabase/migrations/20261021000000_profiles_and_reports.sql) → **Run**.
2. **Table Editor**: `profiles` and `reports` exist and both show **RLS enabled**.

## 3. GitHub sign-in

1. Supabase: **Authentication → Sign In / Providers → GitHub** → copy the **Callback URL**.
2. GitHub: <https://github.com/settings/developers> → **OAuth Apps → New OAuth App**:
   - Application name: `TabulaVibe AI`
   - Homepage URL: `https://tabulavibe-ai.vercel.app`
   - Authorization callback URL: the Supabase callback URL
   - Leave "Enable Device Flow" off → **Register application**
3. **Generate a new client secret**. Copy the **Client ID** and the secret.
4. Supabase GitHub provider: **Enable**, paste Client ID + Client Secret → **Save**.

## 4. Google (Gmail) sign-in

1. <https://console.cloud.google.com> → create a project `tabulavibe` (no billing needed).
2. **Google Auth Platform → Branding**: app name `TabulaVibe AI`, your support email, developer contact email.
   Don't upload a logo (a logo triggers Google's verification review).
3. **Audience**: User type **External**. To let *any* Gmail user sign in, click **Publish app** (with only the
   basic scopes below no review is needed). While it stays in *Testing*, only addresses under **Test users** can sign in.
4. **Data Access**: add the scope `openid` (`email` and `profile` are included by default). Nothing else.
5. **Clients → Create client → Web application**, name `TabulaVibe web`:
   - Authorized JavaScript origins: `https://tabulavibe-ai.vercel.app` and `http://localhost:5180`
   - Authorized redirect URIs: the Supabase callback URL from step 3.1
6. Copy the **Client ID** and **Client Secret** → Supabase **Authentication → Sign In / Providers → Google**:
   **Enable**, paste both → **Save**.

## 5. Allowed addresses

Supabase **Authentication → URL Configuration**:

- Site URL: `https://tabulavibe-ai.vercel.app`
- Redirect URLs: `https://tabulavibe-ai.vercel.app/**` and `http://localhost:5180/**`

## 6. Connect TabulaVibe

From Supabase **Project Settings → API Keys** copy the **Project URL** and the **publishable** key
(`sb_publishable_…`, or the legacy `anon` key). Both are public by design. **Never** use the
`service_role` / `sb_secret_…` key: it bypasses RLS, and the backend refuses to start with it.

**Live site (Vercel → Project `tabulavibe-ai` → Settings → Environment Variables, Production + Preview):**

```ini
TABULAVIBE_SUPABASE_URL=https://<project-ref>.supabase.co
TABULAVIBE_SUPABASE_ANON_KEY=<publishable key>
TABULAVIBE_REQUIRE_SIGN_IN=true
```

Then redeploy (Deployments → ⋯ → Redeploy, or push to `main`).

**Local (`backend/.env`, gitignored):** the same three lines plus
`TABULAVIBE_ALLOWED_ORIGINS=http://localhost:5180,http://127.0.0.1:5180`. Restart the backend.

`TABULAVIBE_REQUIRE_SIGN_IN=true` without the Supabase URL and key makes the backend **refuse to start**, so a
missing setting can never silently leave uploads open.

## 7. Check it

1. Open the site signed out: the upload area says **Sign in to upload your data** and samples are locked.
   `curl -X POST https://tabulavibe-ai.vercel.app/api/profile -F file=@any.csv` returns `401 auth_required`.
2. **Sign up** → **Sign up with Google** (or GitHub) → approve. You return signed in; your name and picture
   appear in the header and a row appears in `profiles`.
3. Upload a file or load a sample → Analyse → Report → **Save to my reports** → **My reports**.
4. **Sign out**: the open file closes and uploads lock again.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sign-in dialog says "available after OAuth is configured" | Supabase variables not set on this deployment, or not redeployed |
| `redirect_uri_mismatch` (Google) | The Google client's redirect URI must be exactly the Supabase callback URL |
| Google: "access blocked" / "app not verified" | Publish the app (step 4.3) or add the address as a test user |
| GitHub: "redirect_uri is not associated with this application" | The OAuth app's callback URL must be exactly the Supabase callback URL |
| After sign-in you land on the wrong site | Add that site to Supabase **Redirect URLs** (step 5) |
| "Your sign-in has expired" | Sign out and in again; check the Supabase project isn't paused |
| "No TabulaVibe profile exists" | Run the SQL from step 2 (it also back-fills existing accounts) |
| Backend won't start: `REQUIRE_SIGN_IN=true needs …` | Add the Supabase URL and key, or set `TABULAVIBE_REQUIRE_SIGN_IN=false` |
