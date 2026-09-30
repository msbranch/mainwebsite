# Protection Assessment — result-page browser tests

`staging-poller.mjs` drives a real Chromium browser against the site files in this
repo and proves the result page resolves its personalized-summary state correctly.

The page's own `assessment.js` runs unmodified. A tiny test-only entry (active only
when `PA_CONFIG.testResultId` is set **and** the URL hash is `#pa-test-result`) jumps
straight to the result screen and starts the real poller against a seeded result.

## Modes

| Mode | What it proves | Needs |
|---|---|---|
| `statematrix` | only a validated AI reflection (`complete`) renders; `fallback` / `expired` / `timeout` **hide** the personalized-summary block entirely (no generic fallback summary is ever substituted) and never leave an indefinite spinner; the two follow-up CTAs click through to their exact confirmation copy and repeat clicks are idempotent; nothing sensitive is logged. | nothing external (a local stub speaks the GET contract) |
| `pending` | against the **real staging** API, a seeded pending result shows the loader while `status=pending`. | `PA_API_BASE`, `PA_RESULT_ID`, `PA_RESULT_TOKEN` |
| `complete` | against the **real staging** API, once the seeded result is `complete` the loader is replaced by the validated AI reflection paragraphs. | same env |

Every mode also fails if the browser console leaks the result token, the visitor's
email or last name, or a serialized API payload.

## Run

```bash
# Deterministic state matrix + CTA flow (no network):
PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright \
  node test/staging-poller.mjs statematrix

# Real staging (seed produced by the staging-only seed-result diagnostic — a
# synthetic record in the isolated intake table; NOTHING is written to the real
# Lead Desk owner partition):
PA_API_BASE=https://<staging-api> PA_RESULT_ID=test-poller-001 PA_RESULT_TOKEN=<seed-token> \
  node test/staging-poller.mjs pending
# …seed the same result to complete, then:
PA_API_BASE=https://<staging-api> PA_RESULT_ID=test-poller-001 PA_RESULT_TOKEN=<seed-token> \
  node test/staging-poller.mjs complete
```

In CI this is run end-to-end (seed → pending → complete) by
`morgan-branch-lead-desk/.github/workflows/staging-poller-e2e.yml`, which produces
the seed through the staging diagnostic and uploads the screenshots.
