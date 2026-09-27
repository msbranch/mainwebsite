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
    var cont = document.getElementById("gateContinue");

    function validate() {
      state.firstName = fName.value.trim();
      state.lastName = lName.value.trim();
      state.email = email.value.trim();
      state.assessmentAcknowledgment = ackReq.checked;
      state.marketingConsent = optMkt.checked;
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

  var lastResult = null;
  function buildResult() {
    var first = state.firstName || "";
    document.getElementById("rGreet").textContent = first ? first + ", here is where I would start." : "Here is where I would start.";
    document.getElementById("rSummary").textContent = "A starting point built only from what you shared — a direction to explore, not a decision.";

    // 1 — What income is connected to (chips)
    var chipWrap = document.getElementById("rChips");
    chipWrap.innerHTML = "";
    var themes = state.incomeCarryingThemes.length ? state.incomeCarryingThemes : ["Your responsibilities"];
    themes.forEach(function (name) {
      var el = document.createElement("span");
      el.className = "rchip";
      el.textContent = name;
      chipWrap.appendChild(el);
    });

    // 2 & 3 — Ranked priorities
    var pr = document.getElementById("rPriority");
    pr.innerHTML = "";
    if (state.priorityOrder.length) {
      state.priorityOrder.forEach(function (v, i) {
        var li = document.createElement("li");
        li.className = "rpriority__item";
        li.innerHTML = '<span class="rpriority__rank">' + ORDINAL[i] + '</span><span class="rpriority__name"></span>';
        li.querySelector(".rpriority__name").textContent = v;
        pr.appendChild(li);
      });
    } else {
      var li = document.createElement("li");
      li.className = "rpriority__item";
      li.innerHTML = '<span class="rpriority__name">Your responsibilities, in the order that matters to you.</span>';
      pr.appendChild(li);
    }

    // 4 — Timeline · 5 — Coverage
    document.getElementById("rTimeline").textContent = TIMELINE_TEXT[state.timeHorizon] || "You have not set a timeline yet.";
    document.getElementById("rCoverage").textContent = COVERAGE_TEXT[state.existingCoverageStatus] || "Your current coverage was not specified.";

    // 6 — Primary Protection Direction (route) + 7 — education cards + why
    var res = window.PADirection.resolve(state);
    lastResult = res;

    var badges = document.getElementById("rBadges");
    badges.innerHTML = "";
    var badge = document.createElement("div");
    badge.className = "rbadge";
    badge.textContent = res.routeLabel;
    badges.appendChild(badge);

    document.getElementById("rWhy").textContent = res.why;

    var edu = document.getElementById("rEdu");
    edu.innerHTML = "";
    res.educationCards.forEach(function (c) {
      var card = document.createElement("div");
      card.className = "rcard";
      var h = document.createElement("p"); h.className = "rcard__title"; h.textContent = c.title;
      var b = document.createElement("p"); b.className = "rcard__body"; b.textContent = c.body;
      card.appendChild(h); card.appendChild(b);
      edu.appendChild(card);
    });

    // Expose a local read-only hook for the future data seam + testing only.
    // Nothing here is sent, stored, or logged.
    window.ProtectionAssessment.lastResult = res;
  }

  /* ---- Future data seam: local mapping ONLY (never sent this pass) ----
     Maps the local state to the typed AssessmentSubmissionV1 the Lead Desk
     intake service already accepts. Defined for documentation/testing; it is
     not called during the flow and no data leaves the browser. */
  function buildFuturePayload() {
    var res = lastResult || window.PADirection.resolve(state);
    return {
      payloadVersion: "assessment-submission-v1",
      assessmentType: "Protection Assessment",
      assessmentVersion: "protection-assessment-web-2026-09",
      completedAt: new Date().toISOString(),
      source: "Protection Assessment",
      contact: { firstName: state.firstName, lastName: state.lastName, email: state.email.toLowerCase() },
      answers: {
        ageBand: state.ageBand,
        incomeCarryingThemes: state.incomeCarryingThemes.slice(),
        impactThemes: state.impactThemes.slice(),
        priorityOrder: state.priorityOrder.slice(),
        timeHorizon: state.timeHorizon,
        existingCoverageStatus: state.existingCoverageStatus,
        incomePattern: state.incomePattern,
        educationPriorities: state.educationPriorities.slice(),
        resolvedRouteKey: res.routeKey,
        resolvedRouteLabel: res.routeLabel
      },
      assessmentAcknowledgment: state.assessmentAcknowledgment,
      marketingConsent: state.marketingConsent
    };
  }

  // ---- Conversation-request modal ----
  function wireModal() {
    var modal = document.getElementById("amodal");
    var openBtn = document.getElementById("rRequest");
    if (!modal || !openBtn) return;
    var box = modal.querySelector(".amodal__box");
    var lastFocus = null;
    function open() { lastFocus = document.activeElement; modal.hidden = false; box.focus(); document.addEventListener("keydown", onKey); }
    function close() { modal.hidden = true; document.removeEventListener("keydown", onKey); if (lastFocus) { try { lastFocus.focus(); } catch (e) {} } }
    function onKey(e) { if (e.key === "Escape") close(); }
    openBtn.addEventListener("click", open);
    modal.querySelectorAll("[data-close]").forEach(function (el) { el.addEventListener("click", close); });
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
    buildFuturePayload: buildFuturePayload,
    lastResult: null
  };
  wireCards();
  wireRankControls();
  wireGate();
  wireModal();
  wireNav();
  updateProgress(screenEl(ORDER[0]));   // intro active in markup; progress hidden
})();
