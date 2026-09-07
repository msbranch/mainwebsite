# Financial Floor — guidance-request firewall (server-side contract)

**What this is.** The provider-neutral, server-side firewall that controls the Financial Floor
guidance step: only a user-**confirmed aggregate summary** may reach the model, and the model may
return only four constrained educational fields. It is the source contract for the eventual
integration into the application server's guidance procedure.

**Status.** This is the **contract + tests**, not a wired integration. `mainwebsite` is the static
marketing site (morganbranch.co); the Financial Floor **application server** (TypeScript / tRPC /
managed platform) lives elsewhere. Integrating the firewall into the real `generateSnapshot`
procedure — binding the confirmation gate to persisted review records, routing the single model
chokepoint, mapping real categories to the approved buckets, and running the acceptance tests
against the live route — is pending access to that application codebase.

**Files.**
- `guidance_firewall.ts` — the firewall (allowlist, prohibited-content scan, confirmation gate,
  single model chokepoint, constrained 4-field response, rules-based fallback, no-leakage adapter).
- `guidance_firewall.test.ts` — 23 tests (run: `npx tsx financial-floor/guidance_firewall.test.ts`,
  or port 1:1 to Vitest/Jest).

**Provider neutrality.** The model is reached only through the `ModelClient` interface. No provider
is named or assumed; retention / logging / training / regional-processing terms are a separate
written-verification item and must not be represented until confirmed for the actual account.

**Not committed here** (internal, kept out of this Pages-served repo): the vendor-stack & data-flow
map and the compliance handoff. Keep those in a private location.
