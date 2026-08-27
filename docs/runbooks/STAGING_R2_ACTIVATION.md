# Runbook: activate private staging R2 evidence storage

**Owner:** Riley Hinsperger | **Frequency:** once, then only for approved recovery
or replacement | **Last updated:** 2026-08-25 | **Last run:** never

## Purpose

Create and prove one private Cloudflare R2 bucket for synthetic staging evidence
without connecting production, prospect data, autonomous work, or unbounded
spend. This runbook is a release gate, not authorization to run it.

Current state: R2 is not enabled, no bucket or R2 binding exists, the engine
Worker has never been deployed, and the only HEAD adapter is fixture-only. Stop
unless every prerequisite below is checked and Riley gives the exact approval.

## Fixed staging contract

| Setting | Required value |
|---|---|
| Bucket | `axiom-revenue-engine-evidence-staging` |
| Access | Private; no `r2.dev` URL and no custom/public domain |
| Storage class | Standard only |
| Future engine binding | `EVIDENCE_BUCKET`, staging environment only |
| Automatic lifecycle | `shadow/30d/v1/` only, delete after 30 days |
| Qualification policy | Review after 180 days; never lifecycle-delete automatically |
| Smoke data | One generated synthetic artifact; no business/prospect data |
| Runtime state | Execution off, autonomy off, job cost cap US$0 until smoke approval |

As verified on 2026-08-25, R2 Standard pricing includes 10 GB-month, one million
Class A operations, and ten million Class B operations monthly, then lists
US$0.015/GB-month, US$4.50/million Class A, and US$0.36/million Class B. HEAD is
Class B and egress is free. Recheck the live dashboard and the official
[R2 pricing page](https://developers.cloudflare.com/r2/pricing/) immediately
before approval because pricing can change.

## Prerequisites

- [ ] Riley writes exactly: `I APPROVE ONE PRIVATE STAGING R2 BUCKET`.
- [ ] The Cloudflare dashboard shows the account, billing method, current R2
  price, and any activation commitment; the recorded worst-case monthly amount
  keeps total runtime at or below C$50.
- [ ] `docs/STAGING_INVENTORY.md` has been verified read-only in the same work
  cycle and still shows no R2 bucket or engine deployment.
- [ ] The working tree is clean and the exact candidate commit has green Ubuntu
  CI for safety, all migrations from zero, tests, type-check, lint, both builds,
  and both no-upload validations.
- [ ] The candidate configuration contains a dedicated engine `staging`
  environment. Never bind R2 to the default/production console configuration.
- [ ] The live adapter plus `cf:r2:lifecycle:staging` and
  `cf:r2:smoke:staging` commands exist, are fixture-tested, count provider
  operations, accept only fixed staging inputs, and cannot persist D1 rows,
  start Workflows, or authorize outreach.
- [ ] Any separate owner-preview candidate uses the ADR 0025 same-origin delivery
  boundary: authenticated session plus exact dossier match, five-minute maximum
  grant, WebP-only integrity validation, private/no-store response, and no R2
  URL or object key returned to the browser. This R2 activation alone does not
  authorize or deploy an owner-preview route.
- [ ] The pre-change configuration, deployed staging version if one exists, and
  exact rollback commit are recorded in the change record.
- [ ] Migrations 0059 and 0060 remain unapplied remotely unless separately
  backed up, approved, and rehearsed. This R2 procedure does not authorize them.

If any box is unchecked, stop. Do not improvise with dashboard object uploads,
generic Wrangler commands, or production bindings.

## Procedure

### Step 1 — capture the approved change record

Record the approval phrase, approver, timestamp, exact Git SHA, green CI run,
dashboard pricing, maximum monthly cost, bucket name, and rollback SHA in
`docs/STATUS.md`. Do not record account secrets or payment details.

**Expected result:** one reviewable record that proves scope and budget.

**If it fails:** stop; no provider mutation is allowed without the record.

### Step 2 — validate the candidate locally without provider access

From the repository root, run the standard release gate plus:

```powershell
npm run cf:engine:typegen:check
npm run cf:engine:dry-run
```

Inspect the dry-run binding table. It must name only the staging engine, show
`EVIDENCE_BUCKET` only in the staging environment, and keep execution `false`,
autonomy `OFF`, cost `0`, no routes, no cron, and no queue consumer.

**Expected result:** every command exits zero and no upload occurs.

**If it fails:** stop and fix the candidate in a new commit; never activate from
an unverified working tree.

### Step 3 — enable R2 and create the exact private bucket

After the owner approval and dashboard price capture, enable R2 in the Cloudflare
dashboard. Then run only:

```powershell
npx wrangler r2 bucket create axiom-revenue-engine-evidence-staging
npx wrangler r2 bucket list
```

Do not enable `r2.dev`, attach a domain, or add a CORS policy.

**Expected result:** the exact staging bucket appears once and is private.

**If it fails:** record the error code without tokens or account details. Stop;
do not retry with another name, account, or storage class.

### Step 4 — install only the shadow lifecycle rule

Run only the checked-in, reviewed command created for the candidate release:

```powershell
npm run cf:r2:lifecycle:staging
```

It must produce exactly one automatic delete rule: `shadow/30d/v1/` after 30
days. Inspect the provider result and save the redacted rule summary in
`docs/STAGING_INVENTORY.md`.

There must be no automatic rule for `qualification/180d/v1/`,
`outreach/active/v1/`, or `legal/hold/v1/`.

**Expected result:** one shadow rule and zero promoted-object delete rules.

**If it fails:** remove only the newly created incorrect rule, verify the rule
list again, and stop. Never delete objects as a lifecycle-rule rollback.

### Step 5 — deploy the inert staging engine binding

Only after the reviewed `env.staging` configuration exists, run:

```powershell
npx wrangler deploy --config wrangler.engine.jsonc --env staging --autoconfig false
```

**Expected result:** one staging engine version with the private R2 binding and
all execution/spend switches still off. No Workflow instance or D1 row starts.

**If it fails:** do not switch to the default environment. Use the rollback
section to restore or disconnect the exact staging version.

### Step 6 — run one synthetic smoke check

Run only the checked-in command:

```powershell
npm run cf:r2:smoke:staging
```

The command must generate its own small synthetic bytes, use one
content-addressed `shadow/30d/v1/` key, perform bounded create/HEAD/delete smoke
operations, validate exact metadata, and print only operation counts, object
size, normalized outcome, and estimated cost. It must never accept a URL,
business ID, local arbitrary file path, or prospect data.

**Expected result:** the synthetic object matches, the exact smoke key is removed,
the bucket is otherwise empty, and the recorded provider count/cost stays inside
the approved amount.

**If it fails:** stop. Preserve the exact synthetic key in the private change
record for targeted cleanup; do not list or recursively delete unrelated keys.

### Step 7 — verify and close

- [ ] Bucket remains private with Standard storage.
- [ ] Only the shadow 30-day lifecycle rule exists.
- [ ] The synthetic key is absent and no other object was touched.
- [ ] Engine execution/autonomy/cost remain `false`/`OFF`/`0`.
- [ ] Zero prospect, mailbox, D1, queue, form, or outreach action occurred.
- [ ] Actual Class A/Class B operation counts and estimated cost are recorded.
- [ ] `docs/STAGING_INVENTORY.md`, `docs/STATUS.md`, and any proven gotcha are
  updated in the same checkpoint.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Cloudflare error 10042 | R2 is not enabled | Stop and return to the owner/dashboard approval step. |
| Dry run shows default console or production D1 | Wrong config/environment | Stop; use `wrangler.engine.jsonc --env staging` only after that environment exists. |
| `r2.dev` or a custom domain is visible | Bucket was made public | Disable public access immediately, record an incident, and do not smoke-test. |
| Qualification lifecycle rule exists | Old 180-day expiry assumption returned | Remove only that rule, verify zero promoted delete rules, and add/repair the safety test. |
| HEAD result lacks exact metadata | Adapter or object drift | Treat it as indeterminate; do not persist availability or retry automatically. |
| Cost/operation count is missing | Smoke receipt is incomplete | Stop; a green provider result without a cost receipt is not an accepted test. |

## Rollback

1. Set staging engine execution `false`, autonomy `OFF`, and cost `0`; verify the
   exact deployed configuration.
2. Remove only the staging `EVIDENCE_BUCKET` binding in a reviewed commit and
   redeploy the recorded prior staging engine SHA. Never deploy the default
   environment as a substitute.
3. Remove only the exact synthetic smoke key through the checked-in smoke cleanup
   path. Do not use recursive deletion, a prefix wildcard, or a computed target.
4. Leave the private empty bucket in place while the incident is reviewed. Bucket
   deletion requires a second explicit phrase:
   `DELETE AXIOM STAGING R2 BUCKET`.
5. If that separate deletion is approved, first verify the exact account, exact
   bucket name, empty object count, saved configuration, and absent bindings;
   then run only:

```powershell
npx wrangler r2 bucket delete axiom-revenue-engine-evidence-staging
```

6. Re-run `npx wrangler r2 bucket list`, update inventories/status, and record
   whether the bucket can be recovered (provider bucket deletion is not treated
   as recoverable).

## Escalation

| Situation | Owner | Action |
|---|---|---|
| Price or activation terms exceed/obscure the C$50 ceiling | Riley | Do not enable R2; record the dashboard facts and choose a no-cost deferral. |
| Any production binding/resource appears | Riley plus integration owner | Stop, disable the candidate, preserve evidence, and open an incident review. |
| Public access or unknown objects appear | Riley plus integration owner | Disable access, stop all tests, and investigate before cleanup. |
| Provider state cannot be reconciled exactly | Integration owner | Keep execution off and do not assert a successful activation. |

## History

| Date | Run by | Notes |
|---|---|---|
| 2026-08-25 | Codex | Runbook created; no activation, bucket, binding, request, or charge. |
