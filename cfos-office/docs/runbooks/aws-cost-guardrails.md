# Runbook — AWS cost guardrails for Bedrock

**Status:** manual. AWS infra changes are a runbook, not automation (Session B1
constraint 6). Lewis runs these commands by hand from a shell with AWS
credentials for the account that owns the Bedrock usage. Region is **eu-west-1**
throughout (Rule 5 — EU or nothing).

These are the *outer* guardrails (AWS-side spend tripwires + budget alerts).
The *inner* guardrails live in the app and are already shipped: `LLM_DISABLED=1`
(kill switch), `user_profiles.llm_blocked_at` (per-user block), per-surface burst
+ daily caps (`src/lib/ai/llm-guard.ts`), and per-call cost metering into
`llm_usage_log` (`src/lib/ai/rates.ts`). This runbook is what catches a runaway
*before* the monthly bill, independent of the app.

Prerequisites: `aws` CLI v2, authenticated (`aws sts get-caller-identity`), and
permission for `sns:*`, `cloudwatch:PutMetricAlarm`, and `budgets:*`.

---

## 1. SNS topic + email subscription (the alert channel)

Everything below notifies this topic. Create it once.

```bash
# Create the topic (idempotent — returns the ARN if it already exists).
aws sns create-topic \
  --name cfo-bedrock-cost-alerts \
  --region eu-west-1 \
  --output text --query TopicArn
# → arn:aws:sns:eu-west-1:<ACCOUNT_ID>:cfo-bedrock-cost-alerts
# Export it for the commands below:
export ALERT_TOPIC_ARN="arn:aws:sns:eu-west-1:<ACCOUNT_ID>:cfo-bedrock-cost-alerts"

# Subscribe an email address (repeat per recipient).
aws sns subscribe \
  --topic-arn "$ALERT_TOPIC_ARN" \
  --protocol email \
  --notification-endpoint lewis@example.com \
  --region eu-west-1
# → then click the confirmation link in the email. Verify:
aws sns list-subscriptions-by-topic --topic-arn "$ALERT_TOPIC_ARN" --region eu-west-1
# SubscriptionArn should NOT read "PendingConfirmation".
```

---

## 2. CloudWatch alarm — the loop tripwire (invocation spike)

Fires when Bedrock invocations exceed **100 in a single 5-minute window** — the
signature of a runaway loop (the 2026-07-05 class of incident). `AWS/Bedrock`
namespace, `eu-west-1`. This alarms on the aggregate `Invocations` metric across
all models; to scope to one model, add `--dimensions Name=ModelId,Value=<id>`.

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name cfo-bedrock-invocation-spike \
  --alarm-description "Bedrock invocations > 100 in a 5-min window — likely a runaway loop. Check llm_usage_log and consider LLM_DISABLED=1 in Vercel." \
  --namespace AWS/Bedrock \
  --metric-name Invocations \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$ALERT_TOPIC_ARN" \
  --region eu-west-1
```

Verify + smoke-test the wiring (forces the alarm to fire once so you confirm the
email path end to end, then let it settle back):

```bash
aws cloudwatch describe-alarms --alarm-names cfo-bedrock-invocation-spike --region eu-west-1
aws cloudwatch set-alarm-state \
  --alarm-name cfo-bedrock-invocation-spike \
  --state-value ALARM --state-reason "runbook smoke test" \
  --region eu-west-1
# You should get an email within ~1 min. It returns to OK on the next evaluation.
```

**On fire:** open `llm_usage_log` (`select call_type, count(*), sum(computed_cost_usd)
from llm_usage_log where created_at >= now() - interval '15 min' group by 1 order by 2 desc;`),
identify the surface/user, and if it's genuinely runaway set `LLM_DISABLED=1` in
the Vercel env (all guarded routes refuse in seconds, no deploy) or block the one
account with `update user_profiles set llm_blocked_at = now() where id = '<uuid>';`.

---

## 3. AWS Budgets — monthly cost alerts at 50 / 80 / 100%

A monthly cost budget with three notification thresholds. **Lewis sets
`BUDGET_LIMIT`** (the monthly ceiling in USD) — pick a number comfortably above
normal beta spend but well below a "something is wrong" level.

```bash
export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export BUDGET_LIMIT="200"   # ← Lewis: set the monthly USD ceiling

cat > /tmp/cfo-bedrock-budget.json <<JSON
{
  "BudgetName": "cfo-bedrock-monthly",
  "BudgetType": "COST",
  "TimeUnit": "MONTHLY",
  "BudgetLimit": { "Amount": "${BUDGET_LIMIT}", "Unit": "USD" },
  "CostFilters": { "Service": ["Amazon Bedrock"] }
}
JSON

# Three notifications: 50% / 80% (ACTUAL spend) and 100% (FORECASTED).
cat > /tmp/cfo-bedrock-notifications.json <<JSON
[
  { "Notification": { "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 50, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "SNS", "Address": "${ALERT_TOPIC_ARN}" } ] },
  { "Notification": { "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 80, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "SNS", "Address": "${ALERT_TOPIC_ARN}" } ] },
  { "Notification": { "NotificationType": "FORECASTED", "ComparisonOperator": "GREATER_THAN", "Threshold": 100, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "SNS", "Address": "${ALERT_TOPIC_ARN}" } ] }
]
JSON

aws budgets create-budget \
  --account-id "$ACCOUNT_ID" \
  --budget file:///tmp/cfo-bedrock-budget.json \
  --notifications-with-subscribers file:///tmp/cfo-bedrock-notifications.json
```

> **SNS + Budgets caveat:** AWS Budgets publishes into `us-east-1`, so the SNS
> topic used by Budgets must allow the Budgets service to publish to it. If the
> budget notifications don't arrive, either (a) add an SNS access policy granting
> `budgets.amazonaws.com` `sns:Publish` on the topic, or (b) use email
> subscribers directly in the budget notifications (`"SubscriptionType": "EMAIL",
> "Address": "lewis@example.com"`) instead of SNS. The CloudWatch alarm in §2 is
> the primary fast tripwire; Budgets is the slower monthly backstop.

Verify:

```bash
aws budgets describe-budget --account-id "$ACCOUNT_ID" --budget-name cfo-bedrock-monthly
```

---

## Teardown (if ever needed)

```bash
aws cloudwatch delete-alarms --alarm-names cfo-bedrock-invocation-spike --region eu-west-1
aws budgets delete-budget --account-id "$ACCOUNT_ID" --budget-name cfo-bedrock-monthly
aws sns delete-topic --topic-arn "$ALERT_TOPIC_ARN" --region eu-west-1
```
