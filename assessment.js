/* =========================================================
   The Protection Assessment — assessment.js

   Prototype behavior only. LOCAL browser state, no network:
   nothing is sent, stored, logged, or submitted. Refreshing the
   page resets the session by design.

   Flow:  Welcome → Q1..Q8 → Result Gate (contact) → immediate result
   The Result Gate is NOT a question and is not counted in progress.
   ========================================================= */
(function () {
  "use strict";

  // ---- Screen order (linear flow) ----
  var ORDER = [
    "s-intro",
    "s-q1", "s-q2", "s-q3", "s-q4", "s-q5", "s-q6", "s-q7", "s-q8",
    "s-gate", "s-result"
  ];

  // ---- Local, in-memory session (never persisted or sent) ----
  var state = {
    ageBand: "",
    incomeCarryingThemes: [],
    impactThemes: [],
    priorityOrder: [],            // ordered, up to 3
    timeHorizon: "",
    existingCoverageStatus: "",
    incomePattern: "",
    educationPriorities: [],      // up to 2
    firstName: "", lastName: "", email: "",
    assessmentAcknowledgment: false,
    marketingConsent: false,
    hp: "",                              // honeypot (must stay empty)
    startedAt: new Date().toISOString(), // timing signal captured at page load
    index: 0
  };

  var stage = document.getElementById("astage");
  var progress = document.getElementById("aprogress");
  var progressLabel = document.getElementById("aprogressLabel");
  var progressTrack = document.getElementById("aprogressTrack");
  var segs = progressTrack ? progressTrack.querySelectorAll(".aseg") : [];
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function screenEl(id) { return document.getElementById(id); }

  // ---- Navigation ----
  function show(index, dir) {
    if (index < 0 || index >= ORDER.length) return;
    var current = screenEl(ORDER[state.index]);
    var nextId = ORDER[index];
    var next = screenEl(nextId);

    if (current && current !== next) current.classList.remove("is-active");
    next.setAttribute("data-dir", dir === "back" ? "back" : "fwd");
    next.classList.remove("is-active");
    void next.offsetWidth;              // reflow so the animation restarts
    next.classList.add("is-active");
    state.index = index;

    updateProgress(next);
    focusScreen(next);
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });

    if (nextId === "s-result") buildResult();
  }

  function focusScreen(el) {
    var target = el.querySelector("input, .atitle, .aquestion, [tabindex]") || el;
    try { target.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  function goNext() {
    var id = ORDER[state.index];
    if (id === "s-intro") return show(state.index + 1, "fwd");
    if (id.indexOf("s-q") === 0) {
      if (!isStepAnswered(id)) return;
      return show(state.index + 1, "fwd");
    }
    show(state.index + 1, "fwd");
  }

  function goBack() { show(state.index - 1, "back"); }

  // ---- Progress (Question N of 8; hidden on intro / gate / result) ----
  function updateProgress(screen) {
    var step = screen.getAttribute("data-step");
    if (step) {
      var n = parseInt(step, 10);
      progress.hidden = false;
      progress.setAttribute("aria-hidden", "false");
      progressLabel.textContent = "Question " + n + " of 8";
      progressTrack.setAttribute("aria-valuenow", String(n));
      for (var i = 0; i < segs.length; i++) segs[i].classList.toggle("is-done", i < n);
    } else {
      progress.hidden = true;
      progress.setAttribute("aria-hidden", "true");
    }
  }

  // ---- Answer state helpers ----
  function keyFor(screenId) {
    var el = screenEl(screenId);
    return el ? el.getAttribute("data-answer") : null;
  }
  function isStepAnswered(screenId) {
    var key = keyFor(screenId);
    if (!key) return true;
    var val = state[key];
    return Array.isArray(val) ? val.length > 0 : !!val;
  }
  function refreshContinue(screen) {
    var btn = screen.querySelector('[data-nav="next"]');
    if (btn) btn.disabled = !isStepAnswered(screen.id);
  }

  // ---- Card wiring (single / multi / rank) ----
  function wireCards() {
    var groups = document.querySelectorAll(".acards");
    groups.forEach(function (group) {
      var screen = group.closest(".ascreen");
      var mode = screen.getAttribute("data-select");   // single | multi | rank
      var key = group.getAttribute("data-answer");
      var max = parseInt(screen.getAttribute("data-max") || "0", 10);
      var cards = Array.prototype.slice.call(group.querySelectorAll(".acard"));

      cards.forEach(function (card) {
        card.setAttribute("aria-pressed", "false");
        card.addEventListener("click", function () {
          var value = card.getAttribute("data-value");
          if (mode === "single") {
            cards.forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
            card.setAttribute("aria-pressed", "true");
            state[key] = value;
          } else { // multi or rank
            var arr = state[key];
            var pressed = card.getAttribute("aria-pressed") === "true";
            if (pressed) {
              state[key] = arr.filter(function (v) { return v !== value; });
              card.setAttribute("aria-pressed", "false");
            } else {
              if (max && arr.length >= max) return;   // cap reached — ignore
              arr.push(value);
              card.setAttribute("aria-pressed", "true");
            }
            if (mode === "rank") renderRank(group, key);
          }
          refreshContinue(screen);
        });

        card.addEventListener("keydown", function (e) {
          var i = cards.indexOf(card);
          if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); cards[Math.min(i + 1, cards.length - 1)].focus(); }
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); cards[Math.max(i - 1, 0)].focus(); }
        });
      });
    });
  }

  // ---- Ranking (Q4): show 1st/2nd/3rd and allow reordering ----
  var ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];
  function renderRank(group, key) {
    var arr = state[key];
    // rank badge on each selected card
    group.querySelectorAll(".acard").forEach(function (card) {
      var v = card.getAttribute("data-value");
      var idx = arr.indexOf(v);
      var badge = card.querySelector(".acard__rank");
      if (badge) badge.textContent = idx === -1 ? "" : ORDINAL[idx];
      card.classList.toggle("is-ranked", idx !== -1);
    });
    // reorder panel
    var panel = document.getElementById("rankPanel");
    var list = document.getElementById("rankList");
    if (!panel || !list) return;
    panel.hidden = arr.length === 0;
    list.innerHTML = "";
    arr.forEach(function (v, i) {
      var li = document.createElement("li");
      li.className = "arank__item";
      li.innerHTML =
        '<span class="arank__chip">' + ORDINAL[i] + '</span>' +
        '<span class="arank__name"></span>' +
        '<span class="arank__moves">' +
        '<button type="button" class="arank__btn" data-rank="up" ' + (i === 0 ? "disabled" : "") + ' aria-label="Move up">↑</button>' +
        '<button type="button" class="arank__btn" data-rank="down" ' + (i === arr.length - 1 ? "disabled" : "") + ' aria-label="Move down">↓</button>' +
        '<button type="button" class="arank__btn arank__btn--x" data-rank="remove" aria-label="Remove">×</button>' +
        '</span>';
      li.querySelector(".arank__name").textContent = v;
      li.setAttribute("data-value", v);
      list.appendChild(li);
    });
  }
  function wireRankControls() {
    var list = document.getElementById("rankList");
    if (!list) return;
    var group = document.querySelector('.acards[data-answer="priorityOrder"]');
    var key = "priorityOrder";
    list.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-rank]");
      if (!btn) return;
      var li = btn.closest(".arank__item");
      var v = li.getAttribute("data-value");
      var arr = state[key];
      var i = arr.indexOf(v);
      if (i === -1) return;
      var action = btn.getAttribute("data-rank");
      if (action === "up" && i > 0) { arr.splice(i, 1); arr.splice(i - 1, 0, v); }
      else if (action === "down" && i < arr.length - 1) { arr.splice(i, 1); arr.splice(i + 1, 0, v); }
      else if (action === "remove") {
        arr.splice(i, 1);
        var card = group.querySelector('.acard[data-value="' + cssEscape(v) + '"]');
        if (card) card.setAttribute("aria-pressed", "false");
      }
      renderRank(group, key);
      refreshContinue(document.getElementById("s-q4"));
    });
  }
  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  // ---- Result Gate validation ----
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function wireGate() {
    var form = document.getElementById("gateForm");
    if (!form) return;
    var fName = document.getElementById("fName");
    var lName = document.getElementById("lName");
    var email = document.getElementById("fEmail");
    var ackReq = document.getElementById("ackReq");
    var optMkt = document.getElementById("optMarketing");
    var hp = document.getElementById("aHP");
    var cont = document.getElementById("gateContinue");

    function validate() {
      state.firstName = fName.value.trim();
      state.lastName = lName.value.trim();
      state.email = email.value.trim();
      state.assessmentAcknowledgment = ackReq.checked;
      state.marketingConsent = optMkt.checked;
      state.hp = hp ? hp.value.trim() : "";
      var ok = state.firstName && state.lastName && EMAIL_RE.test(state.email) && state.assessmentAcknowledgment;
      cont.disabled = !ok;
      return ok;
    }
    [fName, lName, email, ackReq, optMkt].forEach(function (el) {
      el.addEventListener("input", validate);
      el.addEventListener("change", validate);
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();                 // front-end only — nothing leaves the browser
      if (validate()) show(state.index + 1, "fwd");
    });
  }

  // ---- Result rendering (deterministic, from assessment-rules.js) ----
  function formatList(arr) {
    if (!arr || !arr.length) return "";
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr[0] + " and " + arr[1];
    return arr.slice(0, -1).join(", ") + ", and " + arr[arr.length - 1];
  }
  var TIMELINE_TEXT = {
    "Most have a defined ending point": "Most of your responsibilities have a defined ending point.",
    "Most will likely matter for a long time": "Most of your responsibilities will likely matter for a long time.",
    "I have both short-term and long-term responsibilities": "You have both short-term and long-term responsibilities.",
    "I am still figuring that out": "You are still figuring out the timing — that is completely fine."
  };
  var COVERAGE_TEXT = {
    "I do not have life insurance yet": "You do not have life insurance yet.",
    "I have coverage through work only": "You have coverage through work only.",
    "I have personal coverage": "You have personal coverage.",
    "I have both work and personal coverage": "You have both work and personal coverage.",
    "I have coverage, but I am not sure what it does": "You have coverage but are not sure what it does.",
    "I am not sure whether I have coverage": "You are not sure whether you have coverage."
  };

  // NOTE: there is no generic "approved fallback" summary. The personalized-summary
  // block shows ONLY a validated AI reflection; when none is available it is hidden
  // entirely (hideSummaryBlock), never replaced with a generic substitute.

  function cfg() { return (window.PA_CONFIG || {}); }

  // Build the EXACT public submission the Assessment Intake validator accepts.
  function buildSubmitPayload() {
    return {
      payloadVersion: "assessment-submission-v1",
      ageBand: state.ageBand,
      incomeCarryingThemes: state.incomeCarryingThemes.slice(),
      impactThemes: state.impactThemes.slice(),
      priorityOrder: state.priorityOrder.slice(),
      timeHorizon: state.timeHorizon,
      existingCoverageStatus: state.existingCoverageStatus,
      incomePattern: state.incomePattern,
      educationPriorities: state.educationPriorities.slice(),
      contact: { firstName: state.firstName, lastName: state.lastName, email: state.email.toLowerCase() },
      acknowledgment: !!state.assessmentAcknowledgment,
      marketingConsent: !!state.marketingConsent,
      meta: { startedAt: state.startedAt, hp: state.hp || "" }
    };
  }

  // ---- Render helpers for the six-section result hierarchy ----
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text || ""; }

  function renderDirection(dir) {
    // 1 — Preliminary Protection Direction label
    var badges = document.getElementById("rDirection");
    if (badges) {
      badges.innerHTML = "";
      var b = document.createElement("div");
      b.className = "rbadge";
      b.textContent = dir.routeLabel || "";
      badges.appendChild(b);
    }
    // 2 — Why this direction surfaced
    setText("rReasons", dir.reasons || "");
    // 4 — What to clarify in a quote conversation
    var focus = document.getElementById("rFocus");
    if (focus) {
      focus.innerHTML = "";
      (dir.conversationFocus || []).forEach(function (item) {
        var li = document.createElement("li");
        li.className = "rfocus__item";
        li.textContent = item;
        focus.appendChild(li);
      });
    }
  }

  function renderTimingNote(note) { setText("rTimingNote", note || ""); }

  // Render the VALIDATED AI reflection (source "ai"). Only ever called for a real
  // AI reflection — there is no generic fallback rendering path.
  function renderReflection(paragraphs) {
    var pending = document.getElementById("rPending");
    var wrap = document.getElementById("rReflection");
    var note = document.getElementById("rReflectionNote");
    var stateEl = document.getElementById("rSummaryState");
    if (!wrap) return;
    wrap.innerHTML = "";
    (paragraphs || []).forEach(function (p) {
      var el = document.createElement("p");
      el.className = "rreflection__p";
      el.textContent = p;
      wrap.appendChild(el);
    });
    if (pending) pending.hidden = true;
    wrap.hidden = false;
    if (note) note.hidden = false;
    if (stateEl) stateEl.setAttribute("data-state", "complete");
  }

  // No validated AI reflection → hide the entire personalized-summary block (label,
  // loader, reflection area, note). The deterministic result sections remain and no
  // generic fallback summary is ever shown as a substitute.
  function hideSummaryBlock() {
    var block = document.getElementById("rSummaryBlock");
    if (block) block.hidden = true;
    var pending = document.getElementById("rPending");
    if (pending) pending.hidden = true;   // never leave the loader spinning
  }

  function showNotice(msg) {
    var n = document.getElementById("rNotice");
    if (n) { n.textContent = msg; n.hidden = false; }
  }

  // Invite-only pilot: replace the result content with a friendly message. No
  // direction, summary, or CTA is shown (nothing was produced for this email).
  function showInvitationOnly(message) {
    var inner = document.querySelector("#s-result .ascreen__inner");
    if (!inner) return;
    inner.innerHTML = "";
    var eyebrow = document.createElement("p"); eyebrow.className = "aeyebrow"; eyebrow.textContent = "By invitation";
    var h = document.createElement("h1"); h.className = "atitle atitle--sm"; h.textContent = "Thank you for your interest.";
    var p = document.createElement("p"); p.className = "alead";
    p.textContent = message || "The Protection Assessment is currently available by invitation while this first version is being reviewed.";
    var controls = document.createElement("div"); controls.className = "acontrols acontrols--result";
    var link = document.createElement("a"); link.className = "atextlink"; link.href = "index.html"; link.textContent = "Return to the homepage";
    controls.appendChild(link);
    inner.appendChild(eyebrow); inner.appendChild(h); inner.appendChild(p); inner.appendChild(controls);
  }

  // Local deterministic direction shaped like the server response (instant render
  // + graceful fallback if the service is unreachable).
  function localDirection() {
    var res = window.PADirection.resolve(state);
    return {
      routeKey: res.routeKey,
      routeLabel: res.routeLabel,
      reasons: res.why,
      conversationFocus: (res.educationCards || []).map(function (c) { return c.body; }).slice(0, 3),
      allowedProductConcepts: []
    };
  }
  function localTimingNote() {
    var older = state.ageBand === "50–59" || state.ageBand === "60+";
    return older
      ? "Age can affect both cost and available options. A conversation now can clarify what is currently available rather than leaving the question unresolved."
      : "Age is one factor insurers use in pricing. Beginning a protection conversation earlier can sometimes mean lower costs for comparable coverage later. Actual cost and availability depend on health, policy design, coverage amount, and underwriting.";
  }

  var lastResult = null;
  function buildResult() {
    var first = state.firstName || "";
    setText("rGreet", first ? first + ", here is your preliminary direction." : "Here is your preliminary direction.");
    setText("rSummary", "A starting point built only from what you shared — a direction to explore, not a decision.");

    // Instant deterministic render (upgraded to server-authoritative on response).
    // Guarded so a rules edge case can never leave the result screen half-rendered
    // or block the summary poller.
    try {
      var local = localDirection();
      lastResult = local;
      renderDirection(local);
      renderTimingNote(localTimingNote());
      window.ProtectionAssessment.lastResult = local;
    } catch (e) { /* server response will populate the direction */ }

    // Submit to the public Assessment Intake service and resolve the summary.
    submitAndResolve();
  }

  // Context captured from the accepted result, used by the follow-up CTAs. Only a
  // completed/fallback result (a real record the Lead Desk can attach to) enables
  // the CTAs.
  var resultContext = { resultId: null, token: null };
  // The personalized-summary block resolves EXACTLY ONCE. Every polling path funnels
  // through a terminal helper guarded by this flag, so the loader can never be left
  // spinning and can never be replaced twice.
  var summaryResolved = false;

  // A validated AI reflection arrived → show it.
  function finishSummary(paragraphs) {
    if (summaryResolved) return;
    summaryResolved = true;
    renderReflection(paragraphs);
    revealFollowUp();
  }
  // No validated AI reflection (server fallback, no token, or service unreachable) →
  // hide the summary block; keep the deterministic direction and the next-step CTAs.
  function finishNoReflection() {
    if (summaryResolved) return;
    summaryResolved = true;
    hideSummaryBlock();
    revealFollowUp();
  }
  function finishExpired() {
    if (summaryResolved) return;
    summaryResolved = true;
    hideSummaryBlock();
    showNotice("This result has expired. You can begin the assessment again whenever you are ready.");
  }
  function finishTimedOut() {
    if (summaryResolved) return;
    summaryResolved = true;
    // Plain recovery state — the loader is always replaced, never left spinning, and
    // no generic summary is substituted for the AI reflection.
    hideSummaryBlock();
    showNotice("The direction above is ready now, and you can request a conversation whenever you like.");
    revealFollowUp();
  }

  function submitAndResolve() {
    var c = cfg();

    // Test seam (staging integration test only): poll an existing seeded result by
    // id + token, with no public submission. Never used in the live page config.
    if (c.testResultId && c.testResultToken) {
      resultContext.resultId = c.testResultId;
      resultContext.token = c.testResultToken;
      startPolling(c.testResultId, c.testResultToken);
      return;
    }

    var url = (c.apiBase || "") + (c.submitPath || "/v1/protection-assessments");
    var ac = window.AbortController ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { ac.abort(); }, c.getTimeoutMs || 8000) : null;

    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": makeIdemKey() },
      body: JSON.stringify(buildSubmitPayload()),
      signal: ac ? ac.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error("submit");
      return res.json();
    }).then(function (data) {
      // Invite-only pilot: a non-invited email is turned away with a friendly,
      // non-technical message and no result is produced.
      if (data && data.status === "invitation_required") { showInvitationOnly(data.message); return; }
      // Upgrade to the server-authoritative direction + timing note.
      if (data && data.direction) { renderDirection(data.direction); lastResult = data.direction; }
      if (data && typeof data.timingNote === "string") renderTimingNote(data.timingNote);
      var resultId = data && data.resultId;
      var token = data && data.resultToken;
      if (resultId && token) {
        resultContext.resultId = resultId;
        resultContext.token = token;
        startPolling(resultId, token);
      } else {
        finishNoReflection();   // no token → no CTA target and no AI reflection
      }
    }).catch(function () {
      if (timer) clearTimeout(timer);
      // Service unreachable / not enabled: keep the deterministic direction and hide
      // the summary block. Never show a generic summary or expose a technical detail.
      finishNoReflection();
    });
  }

  // Bounded, resilient poller. One overall deadline, a per-request abort timeout,
  // retry-until-deadline (not a fixed try count), and a single guaranteed terminal
  // render. It can never spin forever, and it never writes tokens, emails, payloads,
  // or technical errors to the browser console.
  function startPolling(resultId, token) {
    var c = cfg();
    var deadline = Date.now() + (c.pollDeadlineMs || 75000);
    var interval = c.pollIntervalMs || 2500;
    var getTimeout = c.getTimeoutMs || 8000;
    var url = (c.apiBase || "") + (c.statusPath || "/v1/protection-assessments/") + encodeURIComponent(resultId);

    function scheduleNext() {
      if (summaryResolved) return;
      if (Date.now() >= deadline) { finishTimedOut(); return; }
      setTimeout(pollOnce, interval);
    }

    function pollOnce() {
      if (summaryResolved) return;
      var ac = window.AbortController ? new AbortController() : null;
      var timer = ac ? setTimeout(function () { ac.abort(); }, getTimeout) : null;
      fetch(url, { method: "GET", headers: { "x-result-token": token }, signal: ac ? ac.signal : undefined })
        .then(function (res) {
          if (timer) clearTimeout(timer);
          // A missing/expired record answers 404 (no token oracle) or 410.
          if (res.status === 404 || res.status === 410) return { status: "expired" };
          if (!res.ok) throw new Error("status");
          return res.json();
        })
        .then(function (data) {
          if (summaryResolved) return;
          var status = data && data.status;
          if (data && data.direction) renderDirection(data.direction);
          if (data && typeof data.timingNote === "string") renderTimingNote(data.timingNote);
          if (status === "complete" && data.reflection && data.reflection.source === "ai" && data.reflection.paragraphs && data.reflection.paragraphs.length) {
            finishSummary(data.reflection.paragraphs);
          } else if (status === "reflection_unavailable" || status === "fallback" || status === "complete") {
            // Direct-engine reflection_unavailable, legacy fallback, or a complete
            // result without a validated AI reflection → TERMINAL: show NO generic
            // summary. Hide the block; keep the deterministic sections and the CTAs.
            // No validator code, error, fallback, or "explanation coming later" text.
            finishNoReflection();
          } else if (status === "expired") {
            finishExpired();
          } else {
            scheduleNext();   // still pending → keep polling until the deadline
          }
        })
        .catch(function () {
          if (timer) clearTimeout(timer);
          scheduleNext();     // transient/aborted GET → retry until the deadline
        });
    }

    pollOnce();
  }

  function makeIdemKey() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  }

  // ---- Follow-up CTAs (Coverage Review / Quote Conversation) ----
  // Two visible, working next-step buttons. On click the browser calls ONLY the
  // token-gated public Assessment Intake follow-up route; the Assessment Intake
  // service performs the private Lead Desk handoff. The browser never calls the
  // Lead Desk, collects no new information, and creates no new lead or record.
  var followUpSent = { coverage_review: false, quote_conversation: false };
  var FOLLOW_UP_COPY = {
    coverage_review: "Your Coverage Review request has been saved.",
    quote_conversation: "Your Quote Conversation request has been saved."
  };

  // The CTAs become usable only once a real result exists for the Lead Desk to
  // attach to (a completed or fallback result with a token). Until then they stay
  // visible but inert, so a click can never target a result that isn't there.
  function revealFollowUp() {
    var wrap = document.getElementById("rFollowUp");
    if (wrap) wrap.hidden = false;
    var ready = !!(resultContext.resultId && resultContext.token);
    ["rCoverageReview", "rQuoteConversation"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.disabled = !ready;
    });
  }

  function showFollowUpStatus(msg, kind) {
    var s = document.getElementById("rFollowUpStatus");
    if (!s) return;
    s.textContent = msg;
    s.hidden = false;
    s.setAttribute("data-kind", kind || "info");
  }

  function setFollowUpBusy(busy) {
    ["rCoverageReview", "rQuoteConversation"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.setAttribute("aria-busy", busy ? "true" : "false");
    });
  }

  function submitFollowUp(requestType) {
    var c = cfg();
    // Idempotent on the client: once a type is confirmed, repeated clicks just
    // re-show the confirmation and never send a second request.
    if (followUpSent[requestType]) { showFollowUpStatus(FOLLOW_UP_COPY[requestType], "ok"); return; }
    if (!resultContext.resultId || !resultContext.token) {
      showFollowUpStatus("This request needs a completed result. Please begin the assessment again when you are ready.", "info");
      return;
    }
    setFollowUpBusy(true);
    var base = (c.apiBase || "");
    var path = (c.statusPath || "/v1/protection-assessments/") + encodeURIComponent(resultContext.resultId) + (c.followUpSuffix || "/follow-up");
    var ac = window.AbortController ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { ac.abort(); }, c.getTimeoutMs || 8000) : null;
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-result-token": resultContext.token },
      body: JSON.stringify({ payloadVersion: "assessment-follow-up-v1", requestType: requestType }),
      signal: ac ? ac.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      // A saved request (or an idempotent repeat) answers 200. Anything else is a
      // soft, non-technical retry state — no status code or payload is surfaced.
      if (res.ok) return true;
      return false;
    }).then(function (okr) {
      setFollowUpBusy(false);
      if (okr) {
        followUpSent[requestType] = true;
        showFollowUpStatus(FOLLOW_UP_COPY[requestType], "ok");
      } else {
        showFollowUpStatus("We could not save that request just now. Please try again in a moment.", "info");
      }
    }).catch(function () {
      if (timer) clearTimeout(timer);
      setFollowUpBusy(false);
      showFollowUpStatus("We could not save that request just now. Please try again in a moment.", "info");
    });
  }

  function wireFollowUp() {
    var cov = document.getElementById("rCoverageReview");
    var quote = document.getElementById("rQuoteConversation");
    if (cov) cov.addEventListener("click", function () { submitFollowUp("coverage_review"); });
    if (quote) quote.addEventListener("click", function () { submitFollowUp("quote_conversation"); });
  }

  // ---- Global nav buttons ----
  function wireNav() {
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-nav]");
      if (!el) return;
      var dir = el.getAttribute("data-nav");
      if (dir === "next") goNext();
      else if (dir === "back") goBack();
    });
  }

  // ---- Init ----
  window.ProtectionAssessment = {
    getState: function () { return state; },
    buildSubmitPayload: buildSubmitPayload,
    lastResult: null
  };
  wireCards();
  wireRankControls();
  wireGate();
  wireFollowUp();
  wireNav();
  updateProgress(screenEl(ORDER[0]));   // intro active in markup; progress hidden

  // Test-only entry (staging browser integration test). Active ONLY when a test
  // seam is configured (PA_CONFIG.testResultId) AND the URL carries #pa-test-result.
  // It jumps straight to the result screen and starts the REAL staging poller
  // against the seeded result — never reachable in normal use.
  (function testEntry() {
    var c = cfg();
    if (c.testResultId && c.testResultToken && /pa-test-result/.test(location.hash)) {
      var idx = ORDER.indexOf("s-result");
      if (idx >= 0) show(idx, "fwd");   // show() calls buildResult() → submitAndResolve()
    }
  })();
})();
