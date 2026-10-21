# TabulaVibe AI: AWS ₹0 deployment research (checked 2026-10-21)

## 1. AWS Free Tier (accounts created on or after 15 Jul 2025)
- **Credits:** $100 when you sign up, plus up to $100 more for completing activities, so $200 in total. Both plans get them. Credits must be used within 12 months. [docs](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html), [blog](https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits/)
- **Free plan:** You are never charged. It covers only selected services. It ends after **6 months or when the credits run out, whichever comes first**. The account then **closes automatically**. AWS keeps your content for **90 days**, and you can upgrade to the paid plan within that window to keep it. After that the account and its resources are deleted. Joining AWS Organizations or Control Tower, among other things, upgrades the account to paid automatically. [docs](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
- **Paid plan:** All services are available. Usage beyond your credits is billed pay-as-you-go. The account does not close when credits run out. [docs](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
- **Always Free:** More than 30 services, on both plans. A free-plan account gets *only* the Always Free offers. [free](https://aws.amazon.com/free/), [tracking](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/tracking-free-tier-usage.html)
  - **Lambda:** 1M requests and 400,000 GB-s per month. [pricing](https://aws.amazon.com/lambda/pricing/)
  - **CloudWatch:** 5 GB of logs per month, shared across ingestion, archive storage and Logs Insights scans. Also 10 custom metrics, 10 alarms and 3 dashboards. [pricing](https://aws.amazon.com/cloudwatch/pricing/)
  - **CloudFront (pay-as-you-go):** 1 TB data out, 10M HTTP/S requests and 2M CloudFront Function invocations per month. [pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)
  - **S3:** **UNVERIFIED / probably none.** The S3 pricing page mentions only the $200 credits for new customers, not a permanent GB allowance. S3 does not appear in the Always Free list of the tracking doc. [s3 pricing](https://aws.amazon.com/s3/pricing/)
- **CloudFront flat-rate "Free" plan ($0):** [docs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html), [pricing](https://aws.amazon.com/cloudfront/pricing/)
  - Allowance is 1M requests and 100 GB per month. There are **no overage charges**. If you keep exceeding the allowance, AWS may slow delivery (for example, serve from fewer edge locations) instead of billing you.
  - Includes WAF with up to 5 rules and IP rate limiting, DDoS protection, free ACM TLS, OAC, CloudFront Functions, 5 GB of S3 storage credits, and a Route 53 zone with 1M extra queries.
  - Not included: custom cache or origin policies, VPC origins and origin failover. Lambda@Edge is billed separately.
  - It does **not** require an S3 origin. The S3 credits apply whether or not S3 is the origin.
  - Limits: 3 Free plans per account and 1 apex domain per plan.
  - **Conflicts with the free account plan:** the account-level rules say accounts "using AWS Free Tier" are **not eligible**. This most likely means free-plan accounts. Whether paid-plan accounts that still hold credits count is **UNVERIFIED**.
- **S3 in ap-south-1 (Mumbai):** Standard storage is **$0.025/GB-month** for the first 50 TB. GET requests cost **$0.0004 per 1,000**. PUT/POST/LIST requests cost **$0.005 per 1,000**. A 5 MB site with 100k GETs comes to about $0.04 a month. Source: the AWS price list JSON that backs the S3 pricing page (`b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/s3/...`), [s3 pricing](https://aws.amazon.com/s3/pricing/)

## 2. Lambda Function URLs
- **Pricing:** No separate charge. You pay normal request and duration charges plus data transfer. Response streaming is billed per GB after the first 6 MB of each response. [pricing](https://aws.amazon.com/lambda/pricing/)
- **Payload limits:** 6 MB request and 6 MB response for synchronous calls, and 200 MB for a streamed response. The request line plus headers is limited to 1 MB. [quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
  - Binary bodies arrive base64-encoded (`isBase64Encoded`). Base64 adds about 33%, so the practical limit for a raw upload is about **4.5 MB**. This is my inference. [invocation](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- **Event format:** Same as API Gateway payload format **2.0**. [invocation](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)
- **Auth type NONE:** Anyone who has the URL can invoke the function, so a flood of requests drives up your bill.
  - Since Oct 2025, the function policy must allow both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`, the latter with the `lambda:InvokedViaFunctionUrl` condition. SAM and the console add this automatically. [auth](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)
- **CORS:** Built in. You can set AllowOrigins, AllowMethods, AllowHeaders, ExposeHeaders, AllowCredentials and MaxAge. Don't also send CORS headers from the app, or responses carry duplicate headers. [config](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html)
- **Throttling:** Uses reserved concurrency. Maximum RPS is 10 × reserved concurrency, and requests above that get a 429. Setting reserved concurrency to 0 turns the URL off. [config](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html)
- **New accounts:** They have reduced concurrency quotas, which AWS raises automatically as you use it. The doc does not give the exact number; "10" is **UNVERIFIED**. [quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
  - You can reserve at most "unreserved account concurrency minus 100". [concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
  - So on a quota of 10 you **cannot reserve any positive value**. Setting 0 to throttle completely should still work. This is my inference.
  - Use CloudFront WAF rate limiting or checks inside the app instead.

## 3. Runtimes and package size
- **Python runtimes:** `python3.14` and `python3.13` (Amazon Linux 2023) are GA. Both deprecate **30 Jun 2029**, block creates 31 Jul 2029, and block updates 31 Aug 2029. `python3.12` deprecates 31 Oct 2028. `python3.15` is in public preview, with GA targeted for Nov 2026. [runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)
- **Lambda naming change:** Lambda now calls classic functions "Event Functions". It also has a separate **Lambda Web Functions** product (HTTP servers, 512 MB package limit, **no free tier listed**, $0.30 per 1M requests). Avoid it for a ₹0 budget. [pricing](https://aws.amazon.com/lambda/pricing/), [quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- **Package limits:** 50 MB zipped for direct upload (larger zips go through S3, which `sam deploy` handles). **250 MB unzipped** including layers. Up to 5 layers. [quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- **Feasibility:** I measured the cp313 manylinux x86_64 wheels. pandas 3.0.6 is 39.0 MB unzipped and numpy 2.5.4 is 56.4 MB, about 95 MB together. Add openpyxl, FastAPI and pydantic-core and the total is probably about 110–120 MB. **That fits in a plain zip.** [pandas](https://pypi.org/project/pandas/), [numpy](https://pypi.org/project/numpy/)
  - Alternative: the **AWS SDK for pandas** managed layer (awswrangler 3.17.1). It exists for Python 3.13 and 3.14, x86_64 and arm64, in ap-south-1 (3.13 is version `:16`, 3.14 is `:11`). ARN format: `arn:aws:lambda:ap-south-1:336392948345:layer:AWSSDKPandas-Python313[-Arm64]:N`. [layers](https://aws-sdk-pandas.readthedocs.io/en/stable/layers.html)
  - The layer fixes the pandas/numpy versions and adds pyarrow and boto3, so it is larger. Use it only if the build gets painful.
- **arm64 vs x86_64 (Mumbai):** Duration costs **$0.0000133334/GB-s** on arm64 and **$0.0000166667/GB-s** on x86. arm64 is about 20% cheaper. Requests cost $0.20 per 1M on both. Source: AWS price list JSON, [pricing](https://aws.amazon.com/lambda/pricing/)

## 4. Budgets
- Budget monitoring and notifications are **free**, including a cost budget with email alerts. The first 2 action-enabled budgets are free, then $0.10 per budget per day. Emailed reports cost $0.01 each. [pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/)
- Free Tier usage alerts are **on automatically** for standalone accounts. They email the root address at **85%** of a free limit. A "zero spend budget" template alerts at 100%. [tracking](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/tracking-free-tier-usage.html)
- Budget data is refreshed up to 3 times a day, so alerts lag behind actual spend. [budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)

## 5. Tooling on Windows
- **SAM CLI:** Latest is **v1.169.0** (13 Oct 2026). [releases](https://github.com/aws/aws-sam-cli/releases), [pypi](https://pypi.org/project/aws-sam-cli/)
  - Install the MSI from `https://github.com/aws/aws-sam-cli/releases/latest/download/AWS_SAM_CLI_64_PY3.msi`. Enable Windows long paths and install Git. [install](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
  - winget is **not documented** by AWS (UNVERIFIED).
- **`sam build --use-container`:** Needs Docker. Build images exist for Python 3.14 and 3.13 (`public.ecr.aws/sam/build-python3.14` and `public.ecr.aws/sam/build-python3.13`). The doc's own example uses python3.14. [images](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-image-repositories.html)
- **AWS CLI v2:** Run `msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi`. There is also `AWSCLIV2-User.msi`, which installs for the current user only. [install](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

## 6. Mangum vs Lambda Web Adapter
- **Mangum 0.22.0** (22 Aug 2026): needs Python 3.10 or later and is classified up to 3.15. Its only dependency is typing-extensions. [pypi](https://pypi.org/project/mangum/), [releases](https://github.com/Kludex/mangum/releases)
  - Its test suite now runs against a real Lambda runtime through a **Function URL** (HTTP v2 / format 2.0) and API Gateway v1. It supports lifespan.
  - It is a generic ASGI adapter, so it works with FastAPI 0.156 and Starlette 1.x. No incompatibility is documented. An explicit FastAPI or Starlette version matrix is UNVERIFIED.
- **AWS Lambda Web Adapter** (image 1.1.0, layer version 30): Runs uvicorn as-is on port 8080, either as a layer with `AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap` plus a `run.sh`, or as a container. [repo](https://github.com/awslabs/aws-lambda-web-adapter)
  - Supports Function URLs, API Gateway, ALB and response streaming.
  - Downside: a second process and a readiness check add complexity and cold-start time.
- **Recommendation:** Use **Mangum** for the simplest zip deployment.

## 7. PyPI latest (as of 2026-10-21)
| Package | Version | Requires-Python | 3.13 / 3.14 |
|---|---|---|---|
| fastapi | 0.156.4 | >=3.10 | yes / yes (needs starlette>=0.46, pydantic>=2.9) |
| starlette | 1.9.0 | >=3.11 | yes / yes |
| pydantic | 2.14.1 | >=3.10 | yes / yes |
| pandas | 3.0.6 | >=3.11 | yes / yes (cp313 and cp314 wheels) |
| numpy | 2.5.4 | >=3.12 | yes / yes (cp313 and cp314 wheels) |
| openpyxl | 3.1.5 (2024) | >=3.8 | pure Python; classifiers stop at 3.11, so 3.14 is not officially listed |
| python-multipart | 0.0.32 | >=3.10 | yes / yes |
| uvicorn | 0.54.0 | >=3.10 | yes / yes |
| httpx | 0.28.1 (2024) | >=3.8 | pure Python; classifiers stop at 3.12 |
| pytest | 9.1.1 | >=3.10 | yes / yes |
| mangum | 0.22.0 | >=3.10 | yes / yes |
| ruff | 0.17.1 | >=3.7 | yes / yes |

Source: `https://pypi.org/pypi/<pkg>/json` (for example [fastapi](https://pypi.org/project/fastapi/)).

## 8. Gemini API free tier
- **Model availability changed:** Gemini 2.5 Flash, Flash-Lite and Pro are not deprecated (no shutdown date). However, Google is "**limiting access to the 2.5 models to users who have actively used them in the past**". For new projects Google says to use **`gemini-3.5-flash-lite`** or **`gemini-3.8-flash`**, both stable. [models](https://ai.google.dev/gemini-api/docs/models), [deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- **Free tier models:** The pricing page shows a free tier for 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, 3 Flash Preview, the 2.5 models and others. 3.1 Pro Preview has **no** free tier. [pricing](https://ai.google.dev/gemini-api/docs/pricing)
- **Free rate limits:** The docs do not publish numbers. They say to check AI Studio. Limits apply per project, and the daily request limit (RPD) resets at midnight Pacific time. Specific RPM/RPD figures are **UNVERIFIED**. [rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- **Data use:** On the free tier, "Used to improve our products" is **Yes** (it is No on paid). Human reviewers may read prompts. Google says not to submit sensitive or personal data. Users must be 18 or older. [pricing](https://ai.google.dev/gemini-api/docs/pricing), [terms](https://ai.google.dev/gemini-api/terms)
- **Regions:** **India is supported.** Apps offered to users in the EEA, UK or Switzerland must use paid services only. [regions](https://ai.google.dev/gemini-api/docs/available-regions), [terms](https://ai.google.dev/gemini-api/terms)
- **REST call:** `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with headers `x-goog-api-key: $GEMINI_API_KEY` and `Content-Type: application/json`. Body: `{"contents":[{"parts":[{"text":"..."}]}],"generationConfig":{"responseMimeType":"application/json","responseSchema":{...}}}`. [api](https://ai.google.dev/api/generate-content), [quickstart](https://ai.google.dev/gemini-api/docs/quickstart)
  - The quickstart now leads with a newer `v1beta/interactions` endpoint, but it uses the same header.
  - The API reference examples pass the key as `?key=`. That `x-goog-api-key` also works on `generateContent` is my inference from the quickstart.
