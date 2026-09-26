/* =========================================================
   The Protection Assessment — assessment.js
   Prototype behavior only. LOCAL browser state, no network:
   nothing is sent, stored, logged, or submitted. Refreshing the
   page resets the session by design.
   ========================================================= */
(function () {
  "use strict";

  // ---- Screen order (linear flow) ----
  var ORDER = [
    "s-intro", "s-lead",
    "s-q1", "s-q2", "s-q3", "s-q4", "s-q5", "s-q6", "s-q7",
    "s-transition", "s-result"
  ];

  // ---- Local, in-memory session (never persisted or sent) ----
  var state = {
    firstName: "", lastName: "", email: "", ageRange: "",
    emailAck: false, marketingOptIn: false,
    answers: { q1: [], q2: "", q3: "", q4: "", q5: "", q6: "", q7: "" },
    index: 0
  };

  var stage = document.getElementById("astage");
  var progress = document.getElementById("aprogress");
  var progressLabel = document.getElementById("aprogressLabel");
  var progressTrack = document.getElementById("aprogressTrack");
  var segs = progressTrack ? progressTrack.querySelectorAll(".aseg") : [];
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var transitionTimer = null;

  function screenEl(id) { return document.getElementById(id); }

  // ---- Navigation ----
  function show(index, dir) {
    if (index < 0 || index >= ORDER.length) return;
    var current = screenEl(ORDER[state.index]);
    var nextId = ORDER[index];
    var next = screenEl(nextId);
    if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

    if (current && current !== next) current.classList.remove("is-active");
    next.setAttribute("data-dir", dir === "back" ? "back" : "fwd");
    // reflow so the animation restarts on re-show
    next.classList.remove("is-active");
    void next.offsetWidth;
    next.classList.add("is-active");
    state.index = index;

    updateProgress(next);
    // move focus to the screen for screen-reader context, without scrolling jump
    focusScreen(next);
    // keep the viewport anchored at the top of the flow (no page jump)
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });

    if (nextId === "s-transition") startTransition();
    if (nextId === "s-result") buildResult();
  }

  function focusScreen(el) {
    // Prefer the first form field on the lead screen; otherwise the heading.
    var target = el.querySelector("input, select, .atitle, .aquestion, [tabindex]") || el;
    try { target.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  function goNext() {
    // Lead screen is advanced through its form submit (validation), handled elsewhere.
    var id = ORDER[state.index];
    if (id === "s-intro") return show(state.index + 1, "fwd");
    if (id.indexOf("s-q") === 0) {
      if (!isStepAnswered(id)) return;
      return show(state.index + 1, "fwd");
    }
    show(state.index + 1, "fwd");
  }

  function goBack() {
    show(state.index - 1, "back");
  }

  // ---- Progress ----
  function updateProgress(screen) {
    var step = screen.getAttribute("data-step");
    if (step) {
      var n = parseInt(step, 10);
      progress.hidden = false;
      progress.setAttribute("aria-hidden", "false");
      progressLabel.textContent = "Step " + n + " of 7";
      progressTrack.setAttribute("aria-valuenow", String(n));
      for (var i = 0; i < segs.length; i++) {
        segs[i].classList.toggle("is-done", i < n);
      }
    } else {
      progress.hidden = true;
      progress.setAttribute("aria-hidden", "true");
    }
  }

  // ---- Answer selection ----
  function isStepAnswered(screenId) {
    var key = screenId.replace("s-", ""); // q1..q7
    var val = state.answers[key];
    return Array.isArray(val) ? val.length > 0 : !!val;
  }

  function wireCards() {
    var groups = document.querySelectorAll(".acards");
    groups.forEach(function (group) {
      var screen = group.closest(".ascreen");
      var multi = screen.getAttribute("data-select") === "multi";
      var key = group.getAttribute("data-answer");
      var cards = Array.prototype.slice.call(group.querySelectorAll(".acard"));

      cards.forEach(function (card) {
        card.setAttribute("aria-pressed", "false");

        card.addEventListener("click", function () {
          var value = card.getAttribute("data-value");
          if (multi) {
            var pressed = card.getAttribute("aria-pressed") === "true";
            card.setAttribute("aria-pressed", pressed ? "false" : "true");
            var arr = state.answers[key];
            if (pressed) {
              state.answers[key] = arr.filter(function (v) { return v !== value; });
            } else if (arr.indexOf(value) === -1) {
              arr.push(value);
            }
          } else {
            cards.forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
            card.setAttribute("aria-pressed", "true");
            state.answers[key] = value;
          }
          refreshContinue(screen);
        });

        // Roving arrow-key navigation within the group (Enter/Space select natively)
        card.addEventListener("keydown", function (e) {
          var i = cards.indexOf(card);
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault(); cards[Math.min(i + 1, cards.length - 1)].focus();
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault(); cards[Math.max(i - 1, 0)].focus();
          }
        });
      });
    });
  }

  function refreshContinue(screen) {
    var btn = screen.querySelector('[data-nav="next"]');
    if (!btn) return;
    btn.disabled = !isStepAnswered(screen.id);
  }

  // ---- Lead capture validation ----
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function wireLead() {
    var form = document.getElementById("leadForm");
    if (!form) return;
    var fName = document.getElementById("fName");
    var lName = document.getElementById("lName");
    var email = document.getElementById("fEmail");
    var age = document.getElementById("fAge");
    var ackReq = document.getElementById("ackReq");
    var optMkt = document.getElementById("optMarketing");
    var cont = document.getElementById("leadContinue");

    function validate() {
      state.firstName = fName.value.trim();
      state.lastName = lName.value.trim();
      state.email = email.value.trim();
      state.ageRange = age.value;
      state.emailAck = ackReq.checked;
      state.marketingOptIn = optMkt.checked;
      var ok = state.firstName && state.lastName &&
        EMAIL_RE.test(state.email) && state.ageRange && state.emailAck;
      cont.disabled = !ok;
      return ok;
    }

    [fName, lName, email, age, ackReq, optMkt].forEach(function (el) {
      el.addEventListener("input", validate);
      el.addEventListener("change", validate);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      // Front-end validation only — no data leaves the browser.
      if (validate()) show(state.index + 1, "fwd");
    });
  }

  // ---- Transition ----
  function startTransition() {
    var delay = reduceMotion ? 500 : 1400;
    transitionTimer = setTimeout(function () {
      if (ORDER[state.index] === "s-transition") show(state.index + 1, "fwd");
    }, delay);
  }

  /* =======================================================================
     ILLUSTRATIVE DEMO LOGIC — isolated on purpose.
     This is NOT a real recommendation. Replace this whole function with the
     approved policy-type decision table (server-side) in the next phase.
     ======================================================================= */
  function deriveDirection(s) {
    var a = s.answers;
    var COMPLEX = {
      "A business or ownership interest": 1,
      "Multiple households or shared responsibilities": 1,
      "A long-term care or special support concern": 1,
      "An asset I want to keep or transfer": 1
    };

    // Priority: understand existing coverage → complexity → time-horizon shape.
    if (a.q4 === "I am not sure what I have") {
      return {
        badges: [{ name: "Review Existing Coverage First", tone: "pow" }],
        why: "You mentioned you are not certain what coverage you already have. Before exploring a policy type, it is usually worth understanding what is already in place — so any direction builds on it instead of duplicating it."
      };
    }
    if (COMPLEX[a.q6]) {
      return {
        badges: [{ name: "A More Detailed Protection Conversation", tone: "pow" }],
        why: "You pointed to a situation with additional moving parts — such as a business interest, shared responsibilities, an asset to keep or transfer, or a long-term support concern. These are worth walking through in a more detailed protection conversation before naming a single direction."
      };
    }
    if (a.q3 === "For both a temporary and long-term reason") {
      return {
        badges: [{ name: "Term Life Insurance", tone: "lav" }, { name: "Permanent Life Insurance", tone: "lav" }],
        why: "You described both responsibilities with a defined time horizon and responsibilities that may remain over time. Term life insurance may be worth exploring for the temporary responsibility, while permanent life insurance may be worth discussing for the part of the responsibility that does not have a clear end point."
      };
    }
    if (a.q3 === "For a defined period of time") {
      return {
        badges: [{ name: "Term Life Insurance", tone: "lav" }],
        why: "You described responsibilities tied to a defined period of time. Term life insurance may be worth exploring for responsibilities that have a clearer end point."
      };
    }
    if (a.q3 === "For as long as people rely on me") {
      return {
        badges: [{ name: "Permanent Life Insurance", tone: "lav" }],
        why: "You described responsibilities that may last as long as people rely on you. Permanent life insurance may be worth discussing for responsibilities that do not have a clear end point."
      };
    }
    // "I am not sure yet" / unset → an exploratory layered starting point.
    return {
      badges: [{ name: "Term Life Insurance", tone: "lav" }, { name: "Permanent Life Insurance", tone: "lav" }],
      why: "Your answers point in more than one direction. Term life insurance may be worth exploring for responsibilities with a defined time horizon, and permanent life insurance may be worth discussing for responsibilities that may remain over time."
    };
  }

  function formatList(arr) {
    if (!arr || !arr.length) return "";
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr[0] + " and " + arr[1];
    return arr.slice(0, -1).join(", ") + ", and " + arr[arr.length - 1];
  }

  function escapeText(t) {
    var d = document.createElement("div");
    d.textContent = t;
    return d.textContent;
  }

  // ---- Build the (personalized) result ----
  function buildResult() {
    var first = state.firstName || "";
    var greet = document.getElementById("rGreet");
    greet.textContent = first
      ? first + ", here is where I would start."
      : "Here is where I would start.";

    var chips = state.answers.q1 || [];
    var summary = document.getElementById("rSummary");
    summary.textContent = chips.length
      ? "You told me your income helps carry " + formatList(chips.map(function (c) { return c.toLowerCase(); })) + ". Here is a starting point based only on what you shared."
      : "Here is a starting point based only on what you shared.";

    var chipWrap = document.getElementById("rChips");
    chipWrap.innerHTML = "";
    var order = ["Home", "People", "Work", "Future", "Assets"];
    var toShow = chips.length ? order.filter(function (o) { return chips.indexOf(o) !== -1; }) : [];
    toShow.forEach(function (name) {
      var el = document.createElement("span");
      el.className = "rchip";
      el.textContent = name;
      chipWrap.appendChild(el);
    });
    if (!toShow.length) {
      var none = document.createElement("span");
      none.className = "rchip";
      none.textContent = "Your responsibilities";
      chipWrap.appendChild(none);
    }

    var dir = deriveDirection(state);
    var badges = document.getElementById("rBadges");
    badges.innerHTML = "";
    dir.badges.forEach(function (b) {
      var el = document.createElement("div");
      el.className = "rbadge" + (b.tone === "pow" ? " rbadge--pow" : "");
      el.textContent = b.name;
      badges.appendChild(el);
    });

    document.getElementById("rWhy").textContent = dir.why;
  }

  // ---- Modal ----
  function wireModal() {
    var modal = document.getElementById("amodal");
    var openBtn = document.getElementById("rRequest");
    if (!modal || !openBtn) return;
    var box = modal.querySelector(".amodal__box");
    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      modal.hidden = false;
      box.focus();
      document.addEventListener("keydown", onKey);
    }
    function close() {
      modal.hidden = true;
      document.removeEventListener("keydown", onKey);
      if (lastFocus) { try { lastFocus.focus(); } catch (e) {} }
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    openBtn.addEventListener("click", open);
    modal.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", close);
    });
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
  wireCards();
  wireLead();
  wireModal();
  wireNav();
  // Intro is active in markup; sync progress state (hidden on intro).
  updateProgress(screenEl(ORDER[0]));
})();
