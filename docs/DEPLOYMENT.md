# Deployment (AWS)

_Pricing and free-tier facts were checked on 2026-10-21 against official AWS pages. Sources and caveats
are in [RESEARCH_NOTES_2026-10.md](RESEARCH_NOTES_2026-10.md). Re-check before deploying: AWS pricing changes._

## Status

**Not deployed.** On 2026-10-21 this machine had no AWS CLI, no SAM CLI and no AWS credentials, so
the account plan, eligibility and free-tier status could not be checked. The ₹0 constraint could not be
evaluated for a specific account. Everything that does not need an account has been done and verified:

| Check | Result |
|---|---|
| `cfn-lint 1.58.0 infra/template.yaml` (SAM transform) | passed, 0 findings |
| Lambda package built with `pip` inside `public.ecr.aws/lambda/python:3.14` (arm64) | 152.5 MB unzipped (limit 250 MB), 46.5 MB zipped |
| Packaged function invoked through the Lambda Runtime Interface Emulator with Function URL v2 events | health 200 with correct CORS origin; analyze 200 with hand-verified values; XLSX profile 200; `/api/docs` 404 in production |
| `backend/tests/test_lambda.py` (Mangum + base64 multipart Function URL events) | 4 passed |

Emulator timings (22 s cold start, 2–9 s warm) came from QEMU emulating arm64 on an x86 PC. They do not predict real Lambda performance.

## Architecture

```
            HTTPS                               HTTPS (public Function URL, CORS = CloudFront origin only)
Browser ───────────▶ CloudFront ──OAC──▶ S3 (private bucket: index.html, JS, CSS)
   │
   └──────────────────────────────────────────▶ Lambda (python3.14, arm64, 1024 MB, 20 s) ──▶ CloudWatch Logs (7-day retention)
AWS Budgets: monthly cost budget with email alerts (50% actual, 100% actual, 100% forecast)
```

There is no API Gateway, database, upload bucket, NAT gateway, load balancer, EC2, RDS or custom domain.
The Lambda role has no permissions beyond writing its own logs.

## Cost assessment

| Resource | Always-free allowance (both plans) | Expected demo usage | Cost risk |
|---|---|---|---|
| Lambda requests + compute | 1M requests and 400,000 GB-s per month | At 1 GB and about 1–2 s per request, roughly 200k–400k requests a month stay free | Low for a demo. **The public URL can be abused**: a sustained flood beyond the allowance is billed at $0.20 per 1M requests plus $0.0000133334 per GB-s (arm64, Mumbai) |
| Function URL | No separate charge | – | None |
| CloudFront (pay-as-you-go) | 1 TB transfer and 10M requests per month | Under 1 MB per visit | Very low |
| S3 (site + SAM artifact bucket) | **Probably no permanent free allowance** (UNVERIFIED) | About 1 MB of site files plus about 47 MB per deployed Lambda version in the SAM-managed bucket | **Not exactly ₹0:** $0.025/GB-month, so about $0.001–0.01 a month (₹1 or less) unless covered by credits. Delete old artifacts to keep it near zero |
| CloudWatch Logs | 5 GB per month | A few KB per request (no data logged) | Very low; retention is 7 days |
| AWS Budgets (cost budget + email) | Free | 1 budget | None |
| Data transfer Lambda → internet | Small free allowance (UNVERIFIED for this account) | Small JSON/CSV responses | Very low |

**Conclusion.** For demo traffic this design costs approximately ₹0. Two things prevent a guarantee:
- S3 storage likely has no permanent free tier.
- A public, unauthenticated endpoint can be abused.

Never present it as "free forever".

### Free-tier conditions to confirm in the account before deploying

- **Accounts created on or after 15 July 2025** choose a **Free plan** or a **Paid plan**.
  - The Free plan never charges. It covers selected services only and ends after **6 months or when credits run out**, whichever comes first.
  - The account then **closes automatically**. Data is kept for 90 days and then deleted unless you upgrade.
  - The Paid plan does not close, but bills usage beyond credits.
- Both plans get $100 in credits at sign-up, plus up to $100 more for completing activities. Credits expire after 12 months.
- Accounts created before 15 July 2025 follow the older 12-month free tier. Check the Billing console.
- The CloudFront **flat-rate Free plan** ($0, no overage charges) is listed as not available to accounts "using AWS Free Tier". The template uses standard pay-as-you-go CloudFront, whose always-free allowance covers this app.
- New accounts may have a low Lambda concurrency quota. Reserved concurrency (a hard request cap) then **cannot** be set to a positive value. Rely on the budget alerts and, if needed, the mitigations below.

### Mitigations if abuse or cost becomes a concern

1. Turn the API off immediately: `aws lambda put-function-concurrency --function-name <fn> --reserved-concurrent-executions 0`.
2. Put the API behind CloudFront with AWS WAF rate limiting. WAF has its own charges unless you use the flat-rate plan.
3. Delete everything with `sam delete --stack-name tabulavibe` and empty the SAM artifact bucket.

## Deployment checklist

Steps marked **(you)** need your decision or credentials.

1. **(you)** Decide the account: confirm the plan type (Free/Paid), the remaining credits and the creation date in *Billing → Free Tier*.
2. **(you)** Install the tools (official sources):
   - AWS CLI v2: `msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi`
   - SAM CLI: MSI from <https://github.com/aws/aws-sam-cli/releases/latest/download/AWS_SAM_CLI_64_PY3.msi>
   - Docker Desktop is already installed. It must be running.
3. **(you)** Create least-privilege credentials for an IAM Identity Center user or IAM user. Do **not** use root.
   - The deploying identity needs CloudFormation, Lambda, IAM (`iam:CreateRole`, `iam:PassRole` for the function role), S3, CloudFront, Logs and Budgets.
   - Then run `aws configure sso` (or `aws configure`) and verify with `aws sts get-caller-identity`.
4. Choose the region. Default `ap-south-1` (Mumbai), close to Indian users.
5. Deploy: `.\infra\deploy.ps1 -AlertEmail you@example.com`. The script:
   - runs the backend tests
   - stages the backend and runs `sam build --use-container` (arm64)
   - runs `sam deploy --resolve-s3`, which also creates the budget
   - builds the frontend with `VITE_API_BASE_URL` set to the Function URL
   - syncs the frontend to S3 and invalidates `index.html`
   - smoke-tests `/api/health`, `/api/config`, `/api/samples` and the site
6. **(you)** Confirm the AWS Budgets email subscription.
7. Verify the user journey on the deployed site, on desktop and phone:
   - load each sample
   - check the duplicates/invalid warnings
   - run sum of revenue by region, then by month
   - switch chart and table views
   - download the results and cleaned CSVs
   - print the report
   - upload a `.txt` file and confirm it is rejected
8. Optional AI: redeploy with `--parameter-overrides AiProvider=groq,nvidia GroqApiKey=<key> NvidiaApiKey=<nvapi- key> ForecastProvider=kumo`.
   - Use free developer keys (no payment method on either account).
   - The key is stored as a Lambda environment variable, readable by anyone with Lambda console access to the account.

## Teardown

```powershell
sam delete --stack-name tabulavibe --region ap-south-1
```

`sam delete` removes the stack, the site bucket, the log group and the budget. The bucket and log group use `DeletionPolicy: Delete`, and the bucket must be empty first: `aws s3 rm s3://<bucket> --recursive`.
