/* =========================================================
   The Protection Assessment — assessment-rules.js

   DETERMINISTIC result resolver. Isolated on purpose.

   • No AI, no model provider, no network — pure functions of the
     eight local answers.
   • Produces ONE primary "conversation" route (never a fixed policy
     type, coverage amount, premium, carrier, or approval) plus a set
     of educational cards.
   • Route priority when several patterns match:
        1 Existing Coverage Review
        2 Layered Responsibilities
        3 Defined Responsibility
        4 Long-Term
        5 Protection Foundation
   Exposed as window.PADirection.resolve(state).
   ========================================================= */
(function () {
  "use strict";

  // Approved primary route labels (conversation types, not product names).
  var ROUTE = {
    existing_coverage: "A current-coverage review may be relevant.",
    layered:           "A layered protection conversation may be relevant.",
    defined:           "A defined-responsibility protection conversation may be relevant.",
    long_term:         "A long-term protection conversation may be relevant.",
    foundation:        "Protection foundation conversation may be relevant."
  };

  // ---- Answer-value constants (must match the markup exactly) ----
  var TH_DEFINED = "Most have a defined ending point";
  var TH_LONG = "Most will likely matter for a long time";
  var TH_BOTH = "I have both short-term and long-term responsibilities";
  var TH_UNSURE = "I am still figuring that out";

  var COV_NONE = "I do not have life insurance yet";
  var COV_UNSURE_WHAT = "I have coverage, but I am not sure what it does";
  var COV_UNSURE_HAVE = "I am not sure whether I have coverage";

  var PLANNING_AHEAD = "I am planning ahead before these things become active";
  var EDU_REVIEW = "Whether my current coverage should be reviewed";
  var EDU_BEGIN = "How to begin without getting overwhelmed";

  function has(arr, v) { return Array.isArray(arr) && arr.indexOf(v) !== -1; }
  function hasAny(arr, vals) { return vals.some(function (v) { return has(arr, v); }); }

  // Did the person name a "near-term / obligation" responsibility?
  function hasDefinedResponsibility(s) {
    return hasAny(s.incomeCarryingThemes, [
      "My own household and everyday life", "A home or housing responsibility",
      "Debt or a financial obligation", "Children or future children",
      "A business, side income, or people connected to my work"
    ]) || hasAny(s.impactThemes, [
      "My household", "A home or other asset", "Debt connected to me",
      "My children", "My business or work responsibilities"
    ]) || hasAny(s.priorityOrder, [
      "Keep the household stable", "Protect the home or housing payment",
      "Make sure children are supported", "Avoid leaving debt for someone else",
      "Protect business or work responsibilities"
    ]);
  }

  // Did the person name a long-range / legacy / lasting-support responsibility?
  function hasLongTermResponsibility(s) {
    return hasAny(s.incomeCarryingThemes, [
      "Parents or family members", "An asset I want to keep or pass on",
      "A future goal, legacy, or opportunity", "A partner or spouse"
    ]) || hasAny(s.impactThemes, [
      "My parents or family", "A future plan or legacy I want to leave behind", "My partner or spouse"
    ]) || hasAny(s.priorityOrder, [
      "Continue support for parents or family",
      "Protect an asset I have built or want to pass on",
      "Leave room for a future goal, legacy, or opportunity",
      "Support a partner or spouse"
    ]);
  }

  function pickRoute(s) {
    // 1) Existing Coverage Review
    if (s.existingCoverageStatus === COV_UNSURE_WHAT ||
        s.existingCoverageStatus === COV_UNSURE_HAVE ||
        has(s.educationPriorities, EDU_REVIEW)) {
      return "existing_coverage";
    }
    // 2) Layered Responsibilities
    if (s.timeHorizon === TH_BOTH) {
      return "layered";
    }
    // 3) Defined Responsibility
    if (s.timeHorizon === TH_DEFINED && hasDefinedResponsibility(s)) {
      return "defined";
    }
    // 4) Long-Term
    if (s.timeHorizon === TH_LONG && hasLongTermResponsibility(s)) {
      return "long_term";
    }
    // 5) Protection Foundation
    if (has(s.incomeCarryingThemes, PLANNING_AHEAD) ||
        s.existingCoverageStatus === COV_NONE ||
        s.timeHorizon === TH_UNSURE ||
        has(s.educationPriorities, EDU_BEGIN)) {
      return "foundation";
    }
    // Sensible fallbacks that still honor the priority order.
    if (s.timeHorizon === TH_DEFINED) return "defined";
    if (s.timeHorizon === TH_LONG) return "long_term";
    return "foundation";
  }

  function whyFor(routeKey, s) {
    switch (routeKey) {
      case "existing_coverage":
        return "You told us there is some uncertainty about the coverage you already have. Before exploring anything new, it usually helps to understand what is already in place — so any direction builds on it instead of duplicating it or leaving a gap.";
      case "layered":
        return "You described both short-term and long-term responsibilities. A layered conversation looks at how a time-limited need and a longer-lasting need can each be addressed, rather than forcing everything into one shape.";
      case "defined":
        return "You pointed to responsibilities with a defined ending point — like a home, a debt, or the years while children are supported. A defined-responsibility conversation focuses on protecting those responsibilities for the window they actually last.";
      case "long_term":
        return "You described responsibilities that may matter for a long time — lasting family support, an asset to pass on, or a future you want to protect. A long-term conversation looks at protection meant to stay in place rather than end on a set date.";
      default:
        return "You are laying the groundwork, and a simple, unhurried starting point makes sense. A foundation conversation is about getting oriented — what protection is for, what fits your situation, and a first step that does not feel overwhelming.";
    }
  }

  // Educational cards: keyed to what the person asked for clarity on (Q8),
  // with a route-aware card added so the result is never empty. Plain-English,
  // no product push, no fixed policy type.
  var EDU_CARDS = {
    "How to protect responsibilities for a defined period": {
      title: "Protecting a responsibility for a set period",
      body: "Some responsibilities have a natural end — a mortgage, a loan, or the years a child is at home. Protection can be shaped around that window so it is there while the need is, without paying for more time than the need requires."
    },
    "How to keep the monthly cost manageable": {
      title: "Keeping the monthly cost manageable",
      body: "Affordability is part of the conversation, not an afterthought. There are ways to size and structure protection so it fits a real budget — worth walking through together rather than guessing."
    },
    "How longer-term or permanent protection works": {
      title: "How longer-term protection works",
      body: "Some needs do not have a clear end date. Longer-term protection is designed to stay in place rather than expire, which changes how it is structured and what it is used for."
    },
    "How cash-value life insurance works": {
      title: "How cash-value protection works",
      body: "Some permanent policies can build value over time alongside the protection itself. It is a more involved topic, and understanding the trade-offs is part of an honest conversation before anything is decided."
    },
    "Whether my current coverage should be reviewed": {
      title: "Reviewing coverage you already have",
      body: "Existing coverage — especially through work — is worth understanding: what it covers, whether it moves with you, and where any gaps sit. A review makes sure a new direction complements it."
    },
    "How to begin without getting overwhelmed": {
      title: "Beginning without the overwhelm",
      body: "You do not have to have it all figured out to start. A first conversation is about getting oriented and taking one clear step, not committing to anything."
    }
  };

  var ROUTE_CARD = {
    existing_coverage: {
      title: "Start by understanding what you have",
      body: "The most useful first step here is clarity on your current coverage, so any next move is intentional."
    },
    layered: {
      title: "Two needs, addressed together",
      body: "A layered approach lets a shorter-term need and a longer-term need each be handled, rather than compromising on one."
    },
    defined: {
      title: "Protection sized to the responsibility",
      body: "When a responsibility has a defined window, protection can be focused on that window specifically."
    },
    long_term: {
      title: "Protection meant to stay",
      body: "For lasting responsibilities, the conversation centers on protection designed to remain in place over time."
    },
    foundation: {
      title: "A calm first step",
      body: "A foundation conversation keeps things simple: what matters most to you, and one clear next step."
    }
  };

  function eduCardsFor(routeKey, s) {
    var cards = [];
    (s.educationPriorities || []).forEach(function (v) {
      if (EDU_CARDS[v]) cards.push(EDU_CARDS[v]);
    });
    // Always include one route-aware card, avoiding a duplicate title.
    var rc = ROUTE_CARD[routeKey];
    if (rc && !cards.some(function (c) { return c.title === rc.title; })) cards.push(rc);
    return cards.slice(0, 3);
  }

  function resolve(state) {
    var routeKey = pickRoute(state);
    return {
      routeKey: routeKey,
      routeLabel: ROUTE[routeKey],
      why: whyFor(routeKey, state),
      educationCards: eduCardsFor(routeKey, state)
    };
  }

  window.PADirection = { resolve: resolve, ROUTES: ROUTE };
})();
