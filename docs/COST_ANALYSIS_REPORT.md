# AI Presentation Coach — AWS Cost Analysis Report

**Pricing Model:** ON DEMAND (pay-as-you-go) | **No Free Tier Applied** | **Region:** us-east-1  
**Generated:** March 9, 2026 | **Pricing source:** AWS Pricing API (effective 2026-02-01)

---

## Overview

The AI Presentation Coach is a fully serverless application built on AWS. This report analyses the **true cost per user session** (15-minute practice presentation + 5-minute live Q&A) and the **daily steady-state cost** when no users are active, with **no free tier credits applied**.

---

## Session Assumptions

| Parameter | Value |
|---|---|
| Presentation duration | 15 minutes |
| Speaking pace | ~150 wpm → ~2,250 words → ~3,000 tokens |
| Live voice Q&A duration | 5 minutes (Nova Sonic) |
| Bedrock Haiku 4.5 input tokens | ~7,000 (transcript + persona + PDF + metrics) |
| Bedrock Haiku 4.5 output tokens | ~2,000 (structured feedback JSON) |
| Nova 2 Lite QA analytics input | ~4,000 tokens |
| Nova 2 Lite QA analytics output | ~1,500 tokens |
| AgentCore CPU utilisation | ~30% active (I/O wait is not billed) |
| AgentCore peak memory | 512 MB |
| S3 storage per session | ~50 MB (video ~45 MB + PDF ~3 MB + JSON ~2 MB) |
| Estimated sessions per month | ~100 (S3 storage caps at ~5 GB due to 30-day lifecycle policy) |
| DynamoDB reads per session | ~5 RRUs (persona lookups) |
| API Gateway calls per session | ~10 REST calls |
| Lambda invocations per session | 3 (presigned URL ~2 s, analytics ~15 s, persona CRUD ~1 s) |

---

## Unit Pricing Reference

| Service | Dimension | Unit | Price (USD) |
|---|---|---|---|
| Amazon Transcribe | Standard Streaming | per second | $0.0004 |
| Amazon Bedrock — Claude Haiku 4.5 | Input tokens | per 1M tokens | $1.00 |
| Amazon Bedrock — Claude Haiku 4.5 | Output tokens | per 1M tokens | $5.00 |
| Amazon Bedrock — Nova 2 Sonic | Voice conversation | per minute | ~$0.017 |
| Amazon Bedrock — Nova 2 Sonic | Speech input | per 1K tokens | $0.0034 |
| Amazon Bedrock — Nova 2 Sonic | Speech output | per 1K tokens | $0.0136 |
| Amazon Bedrock — Nova 2 Lite | Input tokens | per 1M tokens | $0.06 |
| Amazon Bedrock — Nova 2 Lite | Output tokens | per 1M tokens | $0.24 |
| Amazon Bedrock Guardrails | Content filter | per 1,000 text units | $0.15 |
| Bedrock AgentCore Runtime | CPU | per vCPU-hour (active only) | $0.0895 |
| Bedrock AgentCore Runtime | Memory | per GB-hour | $0.00945 |
| AWS Lambda | Requests | per 1M requests | $0.20 |
| AWS Lambda | Compute | per GB-second | $0.0000166667 |
| Amazon API Gateway (REST) | API calls | per 1M calls (first 333M) | $3.50 |
| Amazon S3 | Storage (Standard) | per GB-month | $0.023 |
| Amazon S3 | PUT requests | per 1,000 | $0.005 |
| Amazon S3 | GET requests | per 1,000 | $0.0004 |
| Amazon DynamoDB | Read Request Units | per 1M RRUs | $0.125 |
| Amazon DynamoDB | Write Request Units | per 1M WRUs | $0.625 |
| Amazon DynamoDB | Storage | per GB-month | $0.25 |
| Amazon Cognito (Essentials) | Monthly Active Users | per MAU | $0.015 |
| Amazon ECR | Container storage | per GB-month | $0.10 |
| AWS Amplify Hosting | Storage | per GB-month | $0.023 |
| AWS Amplify Hosting | Data transfer out | per GB | $0.15 |
| Amazon CloudWatch Logs | Ingestion | per GB | $0.50 |
| Amazon CloudWatch Logs | Storage | per GB-month | $0.03 |

---

## Cost Per User Session (15-Minute Presentation)

| Service | What Runs | Calculation | Cost |
|---|---|---|---|
| **Amazon Transcribe Streaming** | 15 min real-time speech-to-text | $0.0004/sec × 900 sec | **$0.3600** |
| **Bedrock — Nova 2 Sonic** | 5 min bidirectional voice Q&A | $0.017/min × 5 min | **$0.0850** |
| **Bedrock — Claude Haiku 4.5** | Post-session analytics (1 Converse call) | ($1.00/1M × 7,000) + ($5.00/1M × 2,000) | **$0.0170** |
| Bedrock AgentCore Runtime | 5 min container session (30% CPU active) | (90s × 1 vCPU × $0.0895/3600) + (300s × 0.5 GB × $0.00945/3600) | $0.0026 |
| Amazon S3 | 50 MB stored + 15 requests | $0.023/GB × 0.05 GB + requests | $0.0012 |
| Bedrock — Nova 2 Lite | QA analytics (1 Converse call) | ($0.06/1M × 4,000) + ($0.24/1M × 1,500) | $0.0006 |
| Bedrock Guardrails | 1 persona customisation check | $0.15/1,000 × 1 text unit | $0.0002 |
| AWS Lambda | 3 invocations, 2.25 GB-sec total | ($0.20/1M × 3) + ($0.0000166667 × 2.25) | $0.0000 |
| Amazon API Gateway | 10 REST API calls | $3.50/1M × 10 | $0.0000 |
| Amazon DynamoDB | 5 persona read requests | $0.125/1M × 5 | $0.0000 |
| Amazon Cognito | 1 MAU (billed monthly, not per session) | $0.015 / sessions-in-month | $0.0150* |
| **Total per session** | | | **~$0.467** |

*\*Cognito is a monthly per-user charge. At 1 session/user/month the full $0.015 applies. At 10 sessions/user/month it's $0.0015/session.*

### Cost Composition (per session)

| Cost Driver | Amount | Share |
|---|---|---|
| Amazon Transcribe (streaming) | $0.3600 | 77.1% |
| Nova 2 Sonic (voice Q&A) | $0.0850 | 18.2% |
| Claude Haiku 4.5 (analytics) | $0.0170 | 3.6% |
| AgentCore Runtime | $0.0026 | 0.6% |
| S3 + all other services | $0.0024 | 0.5% |
| **Total** | **$0.467** | **100%** |

---

## Daily Steady-State Cost (No Active Users)

These are the costs that accrue even when nobody is using the app — persistent infrastructure.

| Service | What Costs at Idle | Daily Cost | Monthly Cost |
|---|---|---|---|
| AWS Amplify Hosting | 0.1 GB storage + ~1 GB/month transfer | ~$0.0050 | $0.152 |
| Amazon S3 | ~5 GB max (100 sessions × 50 MB, 30-day lifecycle) | ~$0.0038 | $0.115 |
| Amazon CloudWatch Logs | ~0.1 GB/month ingestion + 0.5 GB retained | ~$0.0022 | $0.065 |
| Amazon ECR | AgentCore Docker image ~0.5 GB | ~$0.0017 | $0.050 |
| Amazon DynamoDB | <1 MB persona table storage | ~$0.0000 | $0.0003 |
| Lambda, API Gateway, Transcribe, Bedrock | Not invoked = not billed | $0.00 | $0.00 |
| **Total idle cost** | | **~$0.013/day** | **~$0.38/month** |

> **Key insight:** All compute (Lambda, Transcribe, Bedrock, AgentCore) is pure pay-per-use. When no sessions are running, those costs are exactly $0. The only persistent costs are storage (Amplify, S3, ECR, CloudWatch) totalling ~$0.38/month at 100 sessions. A 30-day S3 lifecycle policy automatically deletes session data after one month, so storage never grows beyond ~5 GB regardless of how long the app runs.

---

## Cost Scaling by Number of Sessions per Month

Totals include the $0.27/month steady-state cost (Amplify + ECR + CloudWatch). Cognito assumes 1 unique user per session. All rows use standard Transcribe rate — volume discounts only apply above **16,667 sessions/month** (250,000 minutes).

| Sessions/month | Transcribe | Bedrock (all) | AgentCore | S3 | Cognito | **Total/month** | **Per session** |
|---|---|---|---|---|---|---|---|
| 10 | $3.60 | $1.03 | $0.03 | $0.01 | $0.15 | **~$5.09** | $0.509 |
| 50 | $18.00 | $5.14 | $0.13 | $0.06 | $0.75 | **~$24.35** | $0.487 |
| 100 | $36.00 | $10.28 | $0.26 | $0.12 | $1.50 | **~$48.44** | $0.484 |
| 500 | $180.00 | $51.38 | $1.32 | $0.60 | $7.50 | **~$241.10** | $0.482 |
| 1,000 | $360.00 | $102.75 | $2.63 | $1.20 | $15.00 | **~$481.93** | $0.482 |
| 5,000 | $1,800.00 | $513.75 | $13.16 | $6.02 | $75.00 | **~$2,408.56** | $0.482 |

---

## Detailed Example: 100 Sessions in a Month

| Service | Calculation | Cost |
|---|---|---|
| Amazon Transcribe | 100 × 900 sec × $0.0004/sec | $36.00 |
| Bedrock — Nova 2 Sonic | 100 × 5 min × $0.017/min | $8.50 |
| Bedrock — Claude Haiku 4.5 | 100 × (7K×$1/1M + 2K×$5/1M) | $1.70 |
| Bedrock — Nova 2 Lite | 100 × (4K×$0.06/1M + 1.5K×$0.24/1M) | $0.06 |
| Bedrock Guardrails | 100 × $0.15/1,000 text units | $0.02 |
| Bedrock AgentCore Runtime | 100 × (90s CPU + 300s×0.5GB memory) | $0.26 |
| Amazon S3 | 100 × 50 MB storage + requests | $0.12 |
| Amazon Cognito | 100 MAUs × $0.015 | $1.50 |
| AWS Lambda | 100 × 3 invocations, 2.25 GB-sec | $0.00 |
| Amazon API Gateway | 100 × 10 REST calls | $0.00 |
| Amazon DynamoDB | 100 × 5 RRUs | $0.00 |
| Steady-state (Amplify + ECR + CloudWatch) | Fixed monthly | $0.27 |
| **Total** | | **$48.44** |
| **Per session** | | **$0.484** |

---

## Detailed Example: 1,000 Sessions in a Month

| Service | Calculation | Cost |
|---|---|---|
| Amazon Transcribe | 1,000 × 900 sec × $0.0004/sec | $360.00 |
| Bedrock — Nova 2 Sonic | 1,000 × 5 min × $0.017/min | $85.00 |
| Bedrock — Claude Haiku 4.5 | 1,000 × (7K×$1/1M + 2K×$5/1M) | $17.00 |
| Bedrock — Nova 2 Lite | 1,000 × (4K×$0.06/1M + 1.5K×$0.24/1M) | $0.60 |
| Bedrock Guardrails | 1,000 × $0.15/1,000 text units | $0.15 |
| Bedrock AgentCore Runtime | 1,000 × (90s CPU + 300s×0.5GB memory) | $2.63 |
| Amazon S3 | 1,000 × 50 MB storage + requests | $1.20 |
| Amazon Cognito | 1,000 MAUs × $0.015 | $15.00 |
| AWS Lambda | 1,000 × 3 invocations, 2.25 GB-sec | $0.04 |
| Amazon API Gateway | 1,000 × 10 REST calls | $0.04 |
| Amazon DynamoDB | 1,000 × 5 RRUs | $0.00 |
| Steady-state (Amplify + ECR + CloudWatch) | Fixed monthly | $0.27 |
| **Total** | | **$481.93** |
| **Per session** | | **$0.482** |

---

## Limitations and Exclusions

- Data transfer costs between AWS services within the same region (intra-region transfer is free)
- Secrets Manager (only used in optional GitHub CI/CD mode)
- S3 storage accumulation over time is shown as a per-session addition only — long-term storage growth depends on retention policies
- Cross-region Bedrock inference routing overhead (cross-region inference profiles are used but pricing is same as regional)
- AWS Support plan costs

---

## Cost Optimisation Recommendations

### Immediate Actions (Highest Impact)

1. **Transcribe is 77% of cost ($0.36/session)** — Transcribe volume discounts kick in at 250,000 minutes/month, dropping from $0.0004/sec to $0.00025/sec (saving 37.5%). At **16,667+ sessions/month** (250,000 minutes ÷ 15 min/session) you hit this tier — significantly reducing per-session cost at scale.
2. **Nova Sonic is 18% of cost ($0.085/session)** — The `SESSION_DURATION_SEC: 300` cap is already enforced in the AgentCore stack.
3. **API Gateway REST → HTTP API** — Switching from REST API ($3.50/M calls) to HTTP API ($1.00/M calls) saves 71% on API Gateway with no functional impact for this use case.
4. **Cognito Lite tier** — If passwordless auth and custom access tokens aren't required, Lite tier costs $0.005/MAU vs $0.015/MAU on Essentials — a 67% reduction (saves $100/month at 10,000 MAUs).

### Best Practices

- **AgentCore I/O wait is free** — The consumption-based billing model means time waiting for Nova Sonic inference doesn't incur CPU charges. This is already factored into the $0.0026/session estimate.
- **Bedrock prompt caching** — If many users share the same persona, the persona system prompt (~1,500 tokens) can be cached, reducing Haiku 4.5 input token costs by up to 90%.
- **AWS Budgets alerts** — Set budget alerts at $50 and $100/month thresholds on Transcribe and Bedrock to catch unexpected usage spikes early.
- **DynamoDB BatchGetItem** — Replace individual persona `GetItem` calls with `BatchGetItem` to reduce both latency and RRU consumption.

---

## Conclusion

The AI Presentation Coach has a **marginal cost of ~$0.47 per 15-minute session**, dominated by Amazon Transcribe ($0.36) and Nova 2 Sonic ($0.085). The architecture is genuinely serverless — **idle cost is ~$0.013/day (~$0.38/month)** with zero compute charges when no users are active. A 30-day S3 lifecycle policy caps storage at ~5 GB (at 100 sessions/month), keeping S3 costs flat at ~$0.12/month with no long-term accumulation.

At 100 sessions/month the total bill is approximately **$48/month**. At 1,000 sessions/month it scales linearly to approximately **$483/month**, with Transcribe volume discounts beginning to reduce per-session cost above ~280 sessions/month.
