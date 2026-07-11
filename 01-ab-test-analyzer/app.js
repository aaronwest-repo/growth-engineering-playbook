// UI wiring for the A/B test analyzer. All statistics live in stats.js and are
// imported directly, so the browser uses the same math as the smoke tests.
import * as S from "./stats.js";

(function () {
  "use strict";

  var $ = function (id) {
    return document.getElementById(id);
  };

  // Example scenarios, framed around the fictional Northstar Outfitters store.
  var EXAMPLES = {
    underpowered: { nA: 4200, cA: 210, nB: 4200, cB: 231, mde: 10, weekly: 4200 },
    winner: { nA: 12000, cA: 600, nB: 12000, cB: 792, mde: 10, weekly: 6000 },
    flat: { nA: 60000, cA: 3000, nB: 60000, cB: 3020, mde: 5, weekly: 15000 },
  };

  var pct = function (x) {
    return (x * 100).toFixed(2) + "%";
  };

  function readInputs() {
    return {
      nA: Number($("nA").value),
      cA: Number($("cA").value),
      nB: Number($("nB").value),
      cB: Number($("cB").value),
      confLevel: Number($("confLevel").value),
      targetPower: Number($("power").value),
      mdeRelative: Number($("mde").value) / 100,
      weeklyTrafficPerArm: Number($("weekly").value) || null,
    };
  }

  function valid(i) {
    return (
      isFinite(i.nA) && i.nA >= 1 &&
      isFinite(i.nB) && i.nB >= 1 &&
      isFinite(i.cA) && i.cA >= 0 && i.cA <= i.nA &&
      isFinite(i.cB) && i.cB >= 0 && i.cB <= i.nB
    );
  }

  function render() {
    var i = readInputs();

    if (!valid(i)) {
      $("verdict").className = "verdict verdict--neutral";
      $("verdict").querySelector(".verdict__headline").textContent =
        "Check your inputs";
      $("verdict").querySelector(".verdict__detail").textContent =
        "Conversions must be between 0 and the number of visitors for each variant.";
      $("rateA").textContent = "Conversion rate: —";
      $("rateB").textContent = "Conversion rate: —";
      return;
    }

    $("rateA").textContent = "Conversion rate: " + pct(i.cA / i.nA);
    $("rateB").textContent = "Conversion rate: " + pct(i.cB / i.nB);

    var test = S.twoProportionZTest(i.nA, i.cA, i.nB, i.cB);
    var ci = S.confidenceInterval(i.nA, i.cA, i.nB, i.cB, i.confLevel);
    var power = S.observedPower(i.nA, i.cA, i.nB, i.cB, i.confLevel);
    var verdict = S.buildVerdict(i);

    $("mPValue").textContent = test.pValue.toFixed(4);
    $("mDiff").textContent =
      (test.diff >= 0 ? "+" : "") + pct(test.diff) +
      (test.relativeLift === null
        ? ""
        : " (" + (test.relativeLift >= 0 ? "+" : "") + pct(test.relativeLift) + " rel.)");
    $("mCiLabel").textContent =
      Math.round(i.confLevel * 100) + "% CI for the difference";
    $("mCi").textContent = "[" + pct(ci.lower) + ", " + pct(ci.upper) + "]";
    $("mPower").textContent = pct(power);
    $("mRequired").textContent = isFinite(verdict.requiredPerArm)
      ? verdict.requiredPerArm.toLocaleString()
      : "—";
    $("mWeeks").textContent =
      verdict.remaining === 0
        ? "Reached"
        : verdict.weeksToRun !== null
          ? "~" + verdict.weeksToRun + " week" + (verdict.weeksToRun === 1 ? "" : "s")
          : verdict.remaining.toLocaleString() + " more/variant";

    $("verdict").className = "verdict verdict--" + verdict.tone;
    $("verdict").querySelector(".verdict__headline").textContent = verdict.headline;
    $("verdict").querySelector(".verdict__detail").textContent = verdict.detail;
  }

  function applyExample(name) {
    var ex = EXAMPLES[name];
    if (!ex) return;
    $("nA").value = ex.nA;
    $("cA").value = ex.cA;
    $("nB").value = ex.nB;
    $("cB").value = ex.cB;
    $("mde").value = ex.mde;
    $("weekly").value = ex.weekly;
    render();
  }

  function runSimulation() {
    var btn = $("runSim");
    btn.disabled = true;
    btn.textContent = "Running…";

    // Defer so the disabled/label state paints before the synchronous loop.
    setTimeout(function () {
      var result = S.simulatePeeking({
        baseRate: 0.05,
        peeks: Math.max(1, Number($("peeks").value)),
        perCheckpointPerArm: Math.max(20, Number($("perCheckpoint").value)),
        alpha: 0.05,
        trials: Math.min(20000, Math.max(200, Number($("trials").value))),
        rng: Math.random,
      });

      var scale = function (v) {
        return Math.min(100, v * 100 * 4).toFixed(0) + "%"; // 25% FPR fills the bar
      };
      $("barFixed").style.width = scale(result.fixedHorizonFPR);
      $("barSeq").style.width = scale(result.sequentialFPR);
      $("valFixed").textContent = pct(result.fixedHorizonFPR);
      $("valSeq").textContent = pct(result.sequentialFPR);
      $("peekingCaption").textContent =
        "Across " + result.trials.toLocaleString() +
        " A/A experiments with no true difference, testing once produced a false \"winner\" " +
        pct(result.fixedHorizonFPR) + " of the time — near the 5% you signed up for. " +
        "Peeking at all " + result.peeks + " checkpoints and stopping early raised that to " +
        pct(result.sequentialFPR) + ".";
      $("peekingResult").hidden = false;

      btn.disabled = false;
      btn.textContent = "Run simulation";
    }, 20);
  }

  function init() {
    $("inputs").addEventListener("input", render);
    var chips = document.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      (function (chip) {
        chip.addEventListener("click", function () {
          applyExample(chip.dataset.example);
        });
      })(chips[i]);
    }
    $("runSim").addEventListener("click", runSimulation);
    render();
  }

  init();
})();
