// Financial Floor — server-side guidance-request firewall (PROVIDER-NEUTRAL).
// Reference implementation, dependency-free. Adapt to the platform's server-function
// language as needed. The model is reached ONLY through the ModelClient interface;
// no provider is named or assumed.
//
// Invariant: the model can only ever receive a user-CONFIRMED aggregate summary (D5),
// and can only ever return four constrained educational fields (D6).

/* ───────────────────────── 1. HOT-side domain types (never cross the firewall) ── */
export interface RawStatement { pdfBytes: Uint8Array; storageKey: string; documentName: string; }
export interface Transaction {
  date: string; merchant: string; description: string; amount: number; accountNumber?: string;
}

/* ───────────────────────── 2. Confirmation gate ─────────────────────────────── */
export interface ConfirmationReceipt {
  incomeConfirmed: boolean;
  categoriesConfirmed: boolean;
  expenseTypesConfirmed: boolean;
  exclusionsConfirmed: boolean;
  possibleDepositDispositionsConfirmed: boolean; // "Already reported" / "Not included"
}
export function isFullyConfirmed(r: ConfirmationReceipt): boolean {
  return !!r && r.incomeConfirmed && r.categoriesConfirmed && r.expenseTypesConfirmed
      && r.exclusionsConfirmed && r.possibleDepositDispositionsConfirmed;
}

/* ───────────────────────── 3. The ONLY object allowed to the model (D5) ──────── */
export type ResultState = "surplus" | "balanced" | "shortfall";
export interface GuidanceRequest {
  income: number;
  fixedExpenseTotal: number;
  variableExpenseTotal: number;
  totalExpenses: number;
  netIncome: number;
  netIncomeMargin: number;              // fraction, e.g. 0.18
  resultState: ResultState;
  reviewCount: number;
  categoryTotals: Record<string, number>; // broad, user-confirmed buckets only
}
const ALLOWED_TOP_KEYS = new Set<string>([
  "income", "fixedExpenseTotal", "variableExpenseTotal", "totalExpenses",
  "netIncome", "netIncomeMargin", "resultState", "reviewCount", "categoryTotals",
]);
// Broad, APPROVED buckets only — canonical IDs. The model must NEVER receive user-entered
// or merchant-derived labels. Reconcile the product's category UI to these IDs before enabling
// the model (correction #4). Display names ↔ IDs:
//   Housing→housing · Utilities & Household→utilities_household · Food→food ·
//   Transportation→transportation · Insurance→insurance · Debt Payments→debt_payments ·
//   Health→health · Family Support→family_support · Lifestyle & Subscriptions→lifestyle_subscriptions ·
//   Other / Needs Review→other_needs_review
const ALLOWED_CATEGORY_KEYS = new Set<string>([
  "housing", "utilities_household", "food", "transportation", "insurance",
  "debt_payments", "health", "family_support", "lifestyle_subscriptions", "other_needs_review",
]);

/* ───────────────────────── 4. Prohibited-content scan (fail closed) ──────────── */
export class FirewallViolation extends Error {}

const PROHIBITED_KEY_PATTERNS: RegExp[] = [
  /pdf/i, /bytes/i, /storage|bucket|url|uri|key/i, /transaction/i, /merchant/i,
  /descript|memo/i, /account/i, /address/i, /(^|_)date(s)?($|_)/i, /document|filename|file_?name/i,
  /e-?mail/i, /(^|_)id($|_)|uuid|user_?id/i, /(^|_)name($|_)/i, /ssn|routing/i,
];
const VALUE_RED_FLAGS: RegExp[] = [
  /%PDF-/,                                                 // PDF magic bytes
  /\b\d{12,19}\b/,                                         // card/account-like digit runs
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,        // email
  /\b\d{4}-\d{2}-\d{2}\b/,                                 // ISO date (transaction dates prohibited)
  /\b\d{1,6}\s+\w+\s+(st|street|ave|avenue|rd|road|blvd|ln|lane|dr|drive|ct|court)\b/i, // address
];

/** Recursively assert no prohibited KEY or string VALUE appears anywhere in obj. */
export function assertNoProhibited(obj: unknown, path = "$"): void {
  if (obj === null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    for (const pat of PROHIBITED_KEY_PATTERNS) {
      if (pat.test(k)) throw new FirewallViolation(`prohibited key "${path}.${k}" (matched ${pat})`);
    }
    if (typeof v === "string") {
      for (const rf of VALUE_RED_FLAGS) {
        if (rf.test(v)) throw new FirewallViolation(`prohibited value at "${path}.${k}" (matched ${rf})`);
      }
    } else if (typeof v === "object") {
      assertNoProhibited(v, `${path}.${k}`);
    }
  }
}

/* ───────────────────────── 5. Strict validator (allowlist + scan) ────────────── */
export function validateGuidanceRequest(req: unknown): GuidanceRequest {
  if (typeof req !== "object" || req === null) throw new FirewallViolation("request must be an object");
  const r = req as Record<string, unknown>;

  // (a) strict allowlist — reject ANY unknown top-level key (fails closed on userId, transactions, etc.)
  for (const k of Object.keys(r)) {
    if (!ALLOWED_TOP_KEYS.has(k)) throw new FirewallViolation(`unknown/prohibited field "${k}"`);
  }
  // (b) required finite numbers
  for (const k of ["income", "fixedExpenseTotal", "variableExpenseTotal", "totalExpenses",
                   "netIncome", "netIncomeMargin", "reviewCount"]) {
    if (typeof r[k] !== "number" || !Number.isFinite(r[k] as number)) {
      throw new FirewallViolation(`field "${k}" must be a finite number`);
    }
  }
  // (c) enum
  if (r.resultState !== "surplus" && r.resultState !== "balanced" && r.resultState !== "shortfall") {
    throw new FirewallViolation(`invalid resultState`);
  }
  // (d) categoryTotals — only broad buckets, numeric values
  const ct = r.categoryTotals;
  if (typeof ct !== "object" || ct === null) throw new FirewallViolation("categoryTotals must be an object");
  for (const [k, v] of Object.entries(ct as Record<string, unknown>)) {
    if (!ALLOWED_CATEGORY_KEYS.has(k)) {
      throw new FirewallViolation(`prohibited category bucket "${k}" (merchant-level/free-form not allowed)`);
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new FirewallViolation(`category "${k}" must be numeric`);
    }
  }
  // (e) defense-in-depth content scan
  assertNoProhibited(r);
  return r as unknown as GuidanceRequest;
}

/* ───────────────────────── 6. Provider-neutral model interface ───────────────── */
export interface ModelClient {
  // The platform's built-in server-side model interface implements this.
  generate(input: { system: string; user: string }): Promise<string>;
}

export interface GuidanceResponse {
  whatMonthShows: string;
  whatToConfirm: string;
  immediateFocus: string;
  voluntaryNextRoute: string;
}
const ALLOWED_RESPONSE_KEYS = ["whatMonthShows", "whatToConfirm", "immediateFocus", "voluntaryNextRoute"] as const;

// Educational-only, no-recommendation system prompt (kept tight; the schema does the rest).
export const GUIDANCE_SYSTEM_PROMPT =
  "You are an educational explainer for a personal cash-flow snapshot. You receive only " +
  "aggregate, user-confirmed monthly totals — never transactions, identifiers, or documents. " +
  "Return ONLY a JSON object with exactly these keys: whatMonthShows, whatToConfirm, " +
  "immediateFocus, voluntaryNextRoute. Be observational and educational. Do NOT recommend or " +
  "advise buying, selling, investing, or choosing any product, investment, insurance, loan, or " +
  "credit; give no tax or legal advice; make no guarantees or return/yield claims.";

const FORBIDDEN_OUTPUT_LANGUAGE: RegExp[] = [
  /\byou should\b|\bwe recommend\b|\brecommend(ed|ation)?\b|\bbest (option|choice|product) for you\b/i,
  /\bbuy\b|\bsell\b|\binvest(ing|ment|ments)?\b|\bportfolio\b/i,
  /\btax (advice|deduction|strateg)/i, /\blegal advice\b|\battorney\b/i,
  /\b(credit card|credit line|loan|refinanc|mortgage)\b/i, /\bdebt (consolidat|settlement)\b/i,
  /\b(buy|choose|purchase|get) (a|an|this) (insurance|policy|annuity|coverage)\b/i,
  /\bguarantee(d|s)?\b|\breturns?\b|\byield\b/i,
];

/** Parse model output → exactly the four fields; reject forbidden recommendation language. */
export function parseAndValidateResponse(raw: string): GuidanceResponse {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new FirewallViolation("model response is not valid JSON"); }
  if (typeof parsed !== "object" || parsed === null) throw new FirewallViolation("model response must be an object");
  const p = parsed as Record<string, unknown>;
  const out = {} as GuidanceResponse;
  for (const k of ALLOWED_RESPONSE_KEYS) {
    const v = p[k];
    if (typeof v !== "string" || v.trim() === "") throw new FirewallViolation(`response.${k} must be a non-empty string`);
    for (const bad of FORBIDDEN_OUTPUT_LANGUAGE) {
      if (bad.test(v)) throw new FirewallViolation(`response.${k} contains forbidden language (matched ${bad})`);
    }
    (out as Record<string, string>)[k] = v.trim();
  }
  return out; // extra keys from the model are intentionally dropped
}

/* ───────────────────────── 7. Safe rules-based fallback (no model) ────────────── */
// Deterministic, observational, no recommendation language. Used when the model output
// fails validation (acceptance test: a bad/recommending response is REPLACED, not surfaced).
export function buildRulesBasedGuidance(req: GuidanceRequest): GuidanceResponse {
  const marginPct = Math.round(req.netIncomeMargin * 100);
  const whatMonthShows =
    req.resultState === "surplus"
      ? `This month your income was greater than your total expenses, a positive net of about ${marginPct}% of income.`
      : req.resultState === "balanced"
      ? `This month your income and total expenses were close to even, a net margin near ${marginPct}%.`
      : `This month your total expenses were greater than your income, a negative net margin near ${marginPct}%.`;
  return {
    whatMonthShows,
    whatToConfirm: "Confirm your category totals, and that all income and one-time deposits were reviewed.",
    immediateFocus: "Review the largest expense category shown in your snapshot.",
    voluntaryNextRoute: "If you choose, you can review the Protection, Accumulation, or Distribution education paths.",
  };
}

/* ───────────────────────── 8. The SINGLE model chokepoint ────────────────────── */
export interface GuidanceResult { guidance: GuidanceResponse; source: "model" | "rules_fallback"; }

export async function requestGuidance(
  summary: GuidanceRequest,
  receipt: ConfirmationReceipt,
  model: ModelClient,
): Promise<GuidanceResult> {
  // Input firewall — FAIL CLOSED (never a fallback that could leak):
  if (!isFullyConfirmed(receipt)) throw new FirewallViolation("summary is not fully user-confirmed — no model call");
  const req = validateGuidanceRequest(summary);            // allowlist + scan
  const raw = await model.generate({ system: GUIDANCE_SYSTEM_PROMPT, user: JSON.stringify(req) });
  // Output firewall — a bad/recommending response is REPLACED with safe rules-based guidance:
  try {
    return { guidance: parseAndValidateResponse(raw), source: "model" };
  } catch (e) {
    if (e instanceof FirewallViolation) return { guidance: buildRulesBasedGuidance(req), source: "rules_fallback" };
    throw e;
  }
}

/* ───────────────────────── 9. No-leakage adapter (COLD side) ─────────────────── */
// Correction #3: resultState and reviewCount are DERIVED FINANCIAL INFORMATION and must NOT
// be the default external event payload. External operational events carry only a non-financial
// event name + technical latency/timestamp. Internal security/audit logging is a SEPARATE,
// access-controlled design decision — not this function.
export interface OperationalEvent { event: string; latencyMs: number; ts?: string; }
export function toOperationalEvent(event: string, latencyMs: number, ts?: string): OperationalEvent {
  return { event, latencyMs, ...(ts ? { ts } : {}) };
  // No resultState, no reviewCount, no income/expense/net/margin/category values — none of it
  // leaves the server boundary to logs/analytics/email/GHL.
}
