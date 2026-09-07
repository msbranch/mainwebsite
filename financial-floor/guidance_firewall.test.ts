// Financial Floor — firewall tests (dependency-free). Run: `npx tsx guidance_firewall.test.ts`
// (or port 1:1 to Jest/Vitest: each `test(...)` → it(...), `expectThrows` → expect(fn).toThrow()).
import {
  validateGuidanceRequest, assertNoProhibited, isFullyConfirmed, requestGuidance,
  parseAndValidateResponse, toOperationalEvent, FirewallViolation,
  GuidanceRequest, ConfirmationReceipt, ModelClient, RawStatement, Transaction,
} from "./guidance_firewall";

/* ── tiny harness ── */
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log("  PASS", name); passed++; }
  catch (e) { console.log("  FAIL", name, "→", (e as Error).message); failed++; }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function expectThrows(fn: () => unknown, msg: string) {
  try { fn(); } catch { return; } throw new Error("expected throw: " + msg);
}

const VALID: GuidanceRequest = {
  income: 5000, fixedExpenseTotal: 2200, variableExpenseTotal: 1300, totalExpenses: 3500,
  netIncome: 1500, netIncomeMargin: 0.30, resultState: "surplus", reviewCount: 1,
  categoryTotals: { housing: 1500, food: 600, transportation: 300, other_needs_review: 1100 },
};
const CONFIRMED: ConfirmationReceipt = {
  incomeConfirmed: true, categoriesConfirmed: true, expenseTypesConfirmed: true,
  exclusionsConfirmed: true, possibleDepositDispositionsConfirmed: true,
};

/* ── T1: strict allowlist rejects prohibited fields ── */
test("T1 baseline valid request passes", () => { validateGuidanceRequest({ ...VALID }); });
test("T1 rejects userId", () => expectThrows(() => validateGuidanceRequest({ ...VALID, userId: "u_1" }), "userId"));
test("T1 rejects transactions[]", () => expectThrows(() => validateGuidanceRequest({ ...VALID, transactions: [{ merchant: "X" }] }), "transactions"));
test("T1 rejects storageKey", () => expectThrows(() => validateGuidanceRequest({ ...VALID, storageKey: "obj://k" }), "storageKey"));
test("T1 rejects email", () => expectThrows(() => validateGuidanceRequest({ ...VALID, email: "a@b.com" }), "email"));
test("T1 rejects documentName", () => expectThrows(() => validateGuidanceRequest({ ...VALID, documentName: "stmt.pdf" }), "documentName"));
test("T1 rejects merchant-named category bucket", () => expectThrows(() => validateGuidanceRequest({ ...VALID, categoryTotals: { Starbucks: 40 } }), "merchant bucket"));

/* ── T2: a raw statement / transaction cannot reach the model call ── */
test("T2 RawStatement object is rejected", () => {
  const raw: RawStatement = { pdfBytes: new Uint8Array([0x25, 0x50]), storageKey: "obj://s", documentName: "s.pdf" };
  expectThrows(() => validateGuidanceRequest(raw as unknown), "raw statement");
});
test("T2 Transaction[] is rejected", () => {
  const txns: Transaction[] = [{ date: "2026-09-01", merchant: "ACME", description: "x", amount: 12 }];
  expectThrows(() => validateGuidanceRequest(txns as unknown), "transaction array");
});
// Type-level proof (compile-time): requestGuidance(raw, ...) does not type-check.
//   const bad = requestGuidance(raw as any, CONFIRMED, model)  // only compiles via `as any`; runtime still throws.

/* ── T3: confirmation gate — no confirmation → no model call ── */
class SpyModel implements ModelClient {
  calls = 0;
  async generate() { this.calls++; return JSON.stringify(CLEAN_OUTPUT); }
}
test("T3 partial confirmation blocks call", async () => {
  const spy = new SpyModel();
  const partial = { ...CONFIRMED, possibleDepositDispositionsConfirmed: false };
  assert(!isFullyConfirmed(partial), "partial should not be fully confirmed");
  let threw = false;
  try { await requestGuidance(VALID, partial, spy); } catch { threw = true; }
  assert(threw, "requestGuidance should throw on partial confirmation");
  assert(spy.calls === 0, "model must NOT be called when unconfirmed");
});

/* ── T4: prohibited-content scan (defense in depth) ── */
test("T4 scan catches %PDF magic", () => expectThrows(() => assertNoProhibited({ note: "%PDF-1.7 header" }), "%PDF"));
test("T4 scan catches account-like digits", () => expectThrows(() => assertNoProhibited({ x: "4111111111111111" }), "16 digits"));
test("T4 scan catches email value", () => expectThrows(() => assertNoProhibited({ x: "user@example.com" }), "email value"));
test("T4 scan catches ISO date value", () => expectThrows(() => assertNoProhibited({ x: "2026-09-07" }), "iso date"));
test("T4 scan passes a clean aggregate request", () => assertNoProhibited({ ...VALID }));

/* ── T5: response constrained to four educational fields ── */
const CLEAN_OUTPUT = {
  whatMonthShows: "Your income covered expenses with a surplus this month.",
  whatToConfirm: "Confirm the housing and food category totals look right.",
  immediateFocus: "The largest fixed category is housing.",
  voluntaryNextRoute: "If you choose, the Protection education path is available to review.",
  extraKeyFromModel: "should be dropped",
};
test("T5 clean output → exactly four fields, extras dropped", () => {
  const r = parseAndValidateResponse(JSON.stringify(CLEAN_OUTPUT));
  assert(Object.keys(r).length === 4, "must be exactly 4 fields");
  assert(!("extraKeyFromModel" in r), "extra model keys must be dropped");
});
test("T5 rejects recommendation language", () => expectThrows(
  () => parseAndValidateResponse(JSON.stringify({ ...CLEAN_OUTPUT, immediateFocus: "You should invest your surplus." })),
  "recommendation language"));
test("T5 rejects insurance/tax/credit advice", () => expectThrows(
  () => parseAndValidateResponse(JSON.stringify({ ...CLEAN_OUTPUT, voluntaryNextRoute: "Buy a whole-life insurance policy now." })),
  "insurance recommendation"));
test("T5 rejects missing field", () => expectThrows(
  () => parseAndValidateResponse(JSON.stringify({ whatMonthShows: "x" })), "missing fields"));
test("T5 rejects non-JSON", () => expectThrows(() => parseAndValidateResponse("not json"), "non-json"));
test("T5 bad model response → safe rules-based fallback (replaced, not surfaced)", async () => {
  const badModel: ModelClient = { async generate() { return JSON.stringify({ ...CLEAN_OUTPUT, immediateFocus: "You should buy an annuity." }); } };
  const r = await requestGuidance(VALID, CONFIRMED, badModel);
  assert(r.source === "rules_fallback", "must fall back when the model output violates");
  assert(Object.keys(r.guidance).length === 4, "fallback has exactly 4 fields");
  assert(!/buy|annuity|recommend|invest/i.test(JSON.stringify(r.guidance)), "fallback must contain no forbidden language");
});

/* ── T6: correction #3 — external event is non-financial only (no resultState/reviewCount) ── */
test("T6 operational event carries only event name + latency (no derived financial info)", () => {
  const ev = toOperationalEvent("guidance_generated", 120);
  const keys = Object.keys(ev).sort().join(",");
  assert(keys === "event,latencyMs", "external event must be metadata-only: " + keys);
  assert(!("resultState" in ev) && !("reviewCount" in ev), "resultState/reviewCount are derived financial info — must not leave server");
  const s = JSON.stringify(ev);
  for (const forbidden of ["5000", "3500", "1500", "0.3", "housing", "surplus", "2200", "1300", "600"]) {
    assert(!s.includes(forbidden), `operational event leaked value "${forbidden}"`);
  }
});

/* ── end-to-end happy path ── */
test("E2E confirmed + clean model → four fields, source=model", async () => {
  const model: ModelClient = { async generate() { return JSON.stringify(CLEAN_OUTPUT); } };
  const r = await requestGuidance(VALID, CONFIRMED, model);
  assert(r.source === "model", "clean model output is used");
  assert("whatMonthShows" in r.guidance && "voluntaryNextRoute" in r.guidance, "four fields returned");
});

/* ── run (handles the async tests) ── */
(async () => {
  // allow async tests to settle
  await new Promise((res) => setTimeout(res, 50));
  console.log(`\n${passed} passed, ${failed} failed`);
  if (typeof process !== "undefined" && failed > 0) process.exit(1);
})();
