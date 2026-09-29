// Real-browser integration test for the Protection Assessment result poller.
//
// It drives an actual Chromium browser against the SITE FILES in this repo and,
// for the primary proof, against the REAL staging Assessment Intake API contract
// (POST /v1/protection-assessments, GET /v1/protection-assessments/{resultId}).
// It is NOT a mock of the browser — the page's own assessment.js runs unmodified.
//
// Modes (argv[2]):
//   pending    — load with a seeded PENDING result on the REAL staging API; assert
//                the loader is shown and the reflection is hidden (status=pending).
//   complete   — same seed, now completed on staging; assert the loader is REPLACED
//                by the validated AI reflection paragraphs (status=complete).
//   statematrix— drive complete / fallback / expired / timeout against a LOCAL stub
//                that speaks the identical GET contract; assert the loader never
//                spins forever, that ONLY a validated AI reflection renders, and that
//                fallback / expired / timeout HIDE the personalized-summary block
//                (no generic fallback summary is ever substituted).
//
// Every mode also asserts the browser console never leaks the result token, the
// visitor email, the last name, or a raw API payload.
//
// Env: PA_API_BASE, PA_RESULT_ID, PA_RESULT_TOKEN (for pending/complete),
//      PA_SHOT_DIR (screenshot output dir, optional).
//
// The seed itself is produced by the staging-only `seed-result` diagnostic (direct
// IAM invoke) so NOTHING is written into the real Lead Desk owner partition.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Resolve Playwright from: an explicit env path, a local install in the working
// directory (CI `npm i playwright`), the script's own tree, or the environment's
// global module.
let chromium;
for (const p of [
  process.env.PLAYWRIGHT_MODULE,
  path.join(process.cwd(), "node_modules", "playwright"),
  "playwright",
  "/opt/node22/lib/node_modules/playwright",
]) {
  if (!p) continue;
  try { ({ chromium } = require(p)); break; } catch { /* try next */ }
}
if (!chromium) { console.error("FAIL: playwright module not found"); process.exit(2); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = process.env.PA_SHOT_DIR || path.join(ROOT, "test", "shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
function staticServer(dir) {
  return http.createServer((req, res) => {
    const u = decodeURIComponent((req.url || "/").split("?")[0]);
    let f = path.join(dir, u === "/" ? "/index.html" : u);
    if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      res.end(buf);
    });
  });
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

const CONTROLLED_PARA_0 = "Thank you for sharing what your income helps carry each day.";
const FALLBACK_PARA_0 = "Thank you for taking the time to share what your income helps carry.";

// A local stub speaking the exact GET contract (incl. the same CORS preflight the
// real staging API returns), to drive every terminal state.
function stubServer(state) {
  const srv = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,OPTIONS,POST");
    res.setHeader("access-control-allow-headers", "content-type,idempotency-key,x-result-token");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    // Follow-up POST (chosen next step): echo the saved shape the real route returns.
    if (req.method === "POST" && /\/follow-up$/.test(req.url || "")) {
      let raw = ""; req.on("data", (d) => (raw += d)); req.on("end", () => {
        let rt = ""; try { rt = JSON.parse(raw).requestType; } catch { /* ignore */ }
        state.followUpPosts = (state.followUpPosts || 0) + 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "saved", requestType: rt }));
      });
      return;
    }
    const direction = { routeKey: "existing_coverage", routeLabel: "A current-coverage review may be relevant.", reasons: "You told us there is some uncertainty about the coverage you already have.", conversationFocus: ["Whether the coverage you already have should be reviewed first."], allowedProductConcepts: [], ctaKey: "review", ctaLabel: "Request a review", resultCopyVersion: "v1" };
    const base = { resultId: "stub-1", direction, timingNote: "Age is one factor insurers use in pricing." };
    let body = { ...base, status: state.status };
    if (state.status === "complete") body.reflection = { paragraphs: [CONTROLLED_PARA_0, "Second controlled paragraph, entirely free of any digit.", "A calm next step, whenever you feel ready to talk it through."], source: "ai" };
    if (state.status === "fallback") body.reflection = { paragraphs: [FALLBACK_PARA_0, "A short conversation is the natural next step here.", "Whenever you feel ready, you can ask for that conversation."], source: "fallback" };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  srv.stateRef = state;
  return srv;
}

const assert = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); process.exitCode = 1; throw new Error(msg); } else { console.log("PASS: " + msg); } };

// Console-leak guard: fail if the token VALUE, the visitor's email/last name, or a
// serialized API payload is written to the console. (The browser's own CORS/network
// messages may name the header "x-result-token" without its value — that is not a
// leak, so we match values and PII strings, never header names.)
function attachConsoleGuard(page, secrets) {
  const leaks = [];
  page.on("console", (m) => {
    const t = m.text();
    for (const s of secrets) if (s && t.includes(s)) leaks.push(s);
    if (/"resultToken"\s*:|"reflection"\s*:\s*\{|"tokenHash"/.test(t)) leaks.push("payload");
  });
  // A page ERROR (uncaught exception) would indicate a swallowed-error regression.
  page.on("pageerror", (e) => leaks.push("pageerror:" + e.message));
  return leaks;
}

async function loadResult(page, cfg) {
  await page.addInitScript((c) => { window.PA_CONFIG = c; }, cfg);
  const port = cfg.__port;
  await page.goto(`http://127.0.0.1:${port}/protection-assessment.html#pa-test-result`, { waitUntil: "domcontentloaded" });
}

async function runStaging(mode) {
  const apiBase = process.env.PA_API_BASE, resultId = process.env.PA_RESULT_ID, token = process.env.PA_RESULT_TOKEN;
  assert(!!apiBase && !!resultId && !!token, "staging seed env present (PA_API_BASE/PA_RESULT_ID/PA_RESULT_TOKEN)");

  // Explicitly verify the REAL staging CORS grant for the production page origin.
  // (The live page runs on https://morganbranch.co, which the API allows; the local
  // harness serves from localhost, so below we relax only the browser's same-origin
  // gate — the GET request/response themselves stay real.)
  const pre = await fetch(`${apiBase}/v1/protection-assessments/${encodeURIComponent(resultId)}`, {
    method: "OPTIONS",
    headers: { origin: "https://morganbranch.co", "access-control-request-method": "GET", "access-control-request-headers": "x-result-token" },
  });
  const acao = pre.headers.get("access-control-allow-origin");
  const acah = (pre.headers.get("access-control-allow-headers") || "").toLowerCase();
  assert(acao === "https://morganbranch.co", `staging CORS allows the production origin (got ${acao})`);
  assert(acah.includes("x-result-token"), "staging CORS allows the x-result-token header");

  const srv = staticServer(ROOT); const port = await listen(srv);
  // --disable-web-security lets the localhost harness read the REAL cross-origin
  // staging response; the network request + JSON are unchanged and real.
  // --disable-web-security: read the REAL cross-origin staging response from a
  //   localhost harness (request/response stay real).
  // --ignore-certificate-errors: tolerate an intercepting proxy CA in some CI/dev
  //   networks; irrelevant to the real page and does not alter the staging response.
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-web-security", "--ignore-certificate-errors"] });
  try {
    const page = await browser.newPage();
    const leaks = attachConsoleGuard(page, [token, "synthetic", "example.com", "Synthetic"]);
    await loadResult(page, { apiBase, statusPath: "/v1/protection-assessments/", followUpSuffix: "/follow-up", testResultId: resultId, testResultToken: token, pollIntervalMs: 1500, getTimeoutMs: 8000, pollDeadlineMs: 30000, __port: port });

    const stateEl = page.locator("#rSummaryState");
    if (mode === "pending") {
      // The loader must be visible and the reflection hidden while pending.
      await page.waitForSelector("#rPending", { state: "visible", timeout: 10000 });
      assert(await page.locator("#rPending").isVisible(), "loader visible while status=pending (real staging GET)");
      assert(await stateEl.getAttribute("data-state") === "pending", "summary state is 'pending'");
      await page.screenshot({ path: path.join(SHOT_DIR, "staging-pending.png") });
    } else {
      // complete: the validated AI reflection must REPLACE the loader.
      await page.waitForFunction(() => document.querySelector("#rSummaryState")?.getAttribute("data-state") === "complete", null, { timeout: 30000 });
      assert(await page.locator("#rPending").isHidden(), "loader hidden once status=complete");
      const paras = await page.locator("#rReflection .rreflection__p").count();
      assert(paras >= 2, `AI reflection paragraphs rendered (${paras})`);
      const first = await page.locator("#rReflection .rreflection__p").first().innerText();
      assert(first.length > 0, "reflection first paragraph is non-empty");
      // The follow-up CTAs are revealed and enabled once a real result exists.
      assert(await page.locator("#rCoverageReview").isVisible(), "Coverage Review CTA visible on complete");
      assert(!(await page.locator("#rCoverageReview").isDisabled()), "Coverage Review CTA enabled on complete");
      await page.screenshot({ path: path.join(SHOT_DIR, "staging-complete.png") });
    }
    assert(leaks.length === 0, "no token/email/lastName/payload leaked to console (" + JSON.stringify(leaks) + ")");
  } finally { await browser.close(); srv.close(); }
}

async function runStateMatrix() {
  const site = staticServer(ROOT); const sitePort = await listen(site);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    for (const status of ["complete", "fallback", "expired"]) {
      const stub = stubServer({ status }); const stubPort = await listen(stub);
      const page = await browser.newPage();
      const leaks = attachConsoleGuard(page, ["seed-secret-xyz"]);
      await loadResult(page, { apiBase: `http://127.0.0.1:${stubPort}`, statusPath: "/v1/protection-assessments/", testResultId: "stub-1", testResultToken: "t", pollIntervalMs: 800, getTimeoutMs: 4000, pollDeadlineMs: 15000, __port: sitePort });
      if (status === "complete") {
        // A validated AI reflection REPLACES the loader.
        await page.waitForFunction(() => document.querySelector("#rSummaryState")?.getAttribute("data-state") === "complete", null, { timeout: 12000 });
        assert(await page.locator("#rPending").isHidden(), "loader replaced for status=complete");
        const paras = await page.locator("#rReflection .rreflection__p").count();
        assert(paras >= 1, "validated AI reflection rendered for status=complete");
        // The two follow-up CTAs are usable; a click shows the exact confirmation and
        // a repeat click is idempotent.
        assert(await page.locator("#rFollowUp").isVisible(), "follow-up CTA block revealed");
        assert(!(await page.locator("#rCoverageReview").isDisabled()), "Coverage Review CTA enabled");
        assert(!(await page.locator("#rQuoteConversation").isDisabled()), "Quote Conversation CTA enabled");
        await page.locator("#rCoverageReview").click();
        await page.waitForFunction(() => document.querySelector("#rFollowUpStatus")?.textContent?.includes("Coverage Review request has been saved"), null, { timeout: 6000 });
        assert(true, "Coverage Review click → 'Your Coverage Review request has been saved.'");
        await page.locator("#rCoverageReview").click();   // idempotent repeat
        await page.waitForTimeout(500);
        assert((stub.stateRef.followUpPosts || 0) === 1, "repeated Coverage Review click sends no second request (client-idempotent)");
        await page.locator("#rQuoteConversation").click();
        await page.waitForFunction(() => document.querySelector("#rFollowUpStatus")?.textContent?.includes("Quote Conversation request has been saved"), null, { timeout: 6000 });
        assert(true, "Quote Conversation click → 'Your Quote Conversation request has been saved.'");
      } else {
        // fallback + expired: NO generic summary is substituted. The whole
        // personalized-summary block is hidden, no reflection paragraph renders, and
        // the loader is never left spinning.
        await page.waitForFunction(() => document.querySelector("#rSummaryBlock")?.hasAttribute("hidden"), null, { timeout: 12000 });
        assert(await page.locator("#rSummaryBlock").isHidden(), `personalized-summary block hidden for status=${status}`);
        assert(await page.locator("#rPending").isHidden(), `loader hidden for status=${status}`);
        assert((await page.locator("#rReflection .rreflection__p").count()) === 0, `no generic fallback reflection rendered for status=${status}`);
        if (status === "fallback") {
          // A real fallback record still enables the next-step CTAs (Lead Desk attach).
          assert(await page.locator("#rFollowUp").isVisible(), "follow-up CTA block revealed on fallback");
          assert(!(await page.locator("#rCoverageReview").isDisabled()), "Coverage Review CTA enabled on fallback");
        } else {
          assert(await page.locator("#rNotice").isVisible(), "expired shows a plain recovery notice");
        }
      }
      assert(leaks.length === 0, `no console leak for status=${status}`);
      await page.close(); stub.close();
    }
    // Timeout: a stub stuck on 'pending' + a short deadline must still terminate.
    const stub = stubServer({ status: "pending" }); const stubPort = await listen(stub);
    const page = await browser.newPage();
    await loadResult(page, { apiBase: `http://127.0.0.1:${stubPort}`, statusPath: "/v1/protection-assessments/", testResultId: "stub-1", testResultToken: "t", pollIntervalMs: 500, getTimeoutMs: 2000, pollDeadlineMs: 3000, __port: sitePort });
    await page.waitForFunction(() => document.querySelector("#rSummaryBlock")?.hasAttribute("hidden"), null, { timeout: 12000 });
    assert(await page.locator("#rPending").isHidden(), "loader never spins forever — timeout hides the summary block (no generic substitute)");
    assert(await page.locator("#rSummaryBlock").isHidden(), "timeout hides the personalized-summary block");
    assert(await page.locator("#rNotice").isVisible(), "timeout shows a plain recovery notice");
    await page.close(); stub.close();
  } finally { await browser.close(); site.close(); }
}

const mode = process.argv[2] || "statematrix";
(async () => {
  if (mode === "pending" || mode === "complete") await runStaging(mode);
  else await runStateMatrix();
  if (process.exitCode) { console.error(`\n${mode}: FAILED`); process.exit(process.exitCode); }
  console.log(`\n${mode}: OK`);
})().catch((e) => { console.error(e); process.exit(1); });
