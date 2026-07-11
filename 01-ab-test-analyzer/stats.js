// Statistics core for the A/B test analyzer.
//
// Dependency-free ES module used by both the browser UI and the Node smoke
// tests. The exact math that ships is the math the test exercises.
//
// Everything here is frequentist two-proportion analysis: the standard toolkit
// for comparing conversion rates between two variants.

  var SQRT2 = Math.SQRT2;

  /** Abramowitz & Stegun 7.1.26 approximation of the error function. */
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y =
      1 -
      (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) *
        t +
        0.254829592) *
        t *
        Math.exp(-x * x);
    return sign * y;
  }

  /** Standard normal CDF: P(Z <= z). */
  function normalCdf(z) {
    return 0.5 * (1 + erf(z / SQRT2));
  }

  /**
   * Inverse standard normal CDF (Acklam's algorithm).
   * Returns z such that P(Z <= z) = p, for 0 < p < 1.
   */
  function normalInv(p) {
    if (p <= 0 || p >= 1) throw new RangeError("normalInv expects 0 < p < 1");
    var a = [
      -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
    ];
    var b = [
      -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1,
    ];
    var c = [
      -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783,
    ];
    var d = [
      7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
      3.754408661907416,
    ];
    var plow = 0.02425;
    var phigh = 1 - plow;
    var q, r;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      );
    }
    if (p <= phigh) {
      q = p - 0.5;
      r = q * q;
      return (
        ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
      );
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  /**
   * Two-proportion z-test comparing variant B against control A.
   * Uses the pooled proportion for the test statistic (standard for testing
   * equality of two proportions). Returns a two-tailed p-value.
   */
  function twoProportionZTest(nA, cA, nB, cB) {
    var rateA = cA / nA;
    var rateB = cB / nB;
    var diff = rateB - rateA;
    var pPool = (cA + cB) / (nA + nB);
    var sePool = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
    var z = sePool === 0 ? 0 : diff / sePool;
    var pValue = 2 * (1 - normalCdf(Math.abs(z)));
    return {
      rateA: rateA,
      rateB: rateB,
      diff: diff,
      relativeLift: rateA === 0 ? null : diff / rateA,
      z: z,
      pValue: Math.min(1, Math.max(0, pValue)),
    };
  }

  /**
   * Confidence interval for the ABSOLUTE difference in conversion rate
   * (rateB - rateA), using the unpooled standard error.
   */
  function confidenceInterval(nA, cA, nB, cB, confLevel) {
    if (confLevel === undefined) confLevel = 0.95;
    var rateA = cA / nA;
    var rateB = cB / nB;
    var diff = rateB - rateA;
    var se = Math.sqrt(
      (rateA * (1 - rateA)) / nA + (rateB * (1 - rateB)) / nB
    );
    var zCrit = normalInv(1 - (1 - confLevel) / 2);
    return { diff: diff, lower: diff - zCrit * se, upper: diff + zCrit * se, se: se, zCrit: zCrit };
  }

  /**
   * Post-hoc statistical power to detect the OBSERVED difference, at the current
   * sample sizes and the chosen significance level (two-sided).
   */
  function observedPower(nA, cA, nB, cB, confLevel) {
    if (confLevel === undefined) confLevel = 0.95;
    var rateA = cA / nA;
    var rateB = cB / nB;
    var effect = Math.abs(rateB - rateA);
    var se = Math.sqrt(
      (rateA * (1 - rateA)) / nA + (rateB * (1 - rateB)) / nB
    );
    if (se === 0) return effect === 0 ? 1 - confLevel : 1;
    var zAlpha = normalInv(1 - (1 - confLevel) / 2);
    var ratio = effect / se;
    var power = 1 - normalCdf(zAlpha - ratio) + normalCdf(-zAlpha - ratio);
    return Math.min(1, Math.max(0, power));
  }

  /**
   * Required sample size PER VARIANT for a two-sided two-proportion test to
   * detect a relative lift `mdeRelative` on a `baselineRate`, at the given
   * power and confidence level.
   */
  function requiredSampleSize(baselineRate, mdeRelative, power, confLevel) {
    if (power === undefined) power = 0.8;
    if (confLevel === undefined) confLevel = 0.95;
    var p1 = baselineRate;
    var p2 = baselineRate * (1 + mdeRelative);
    var delta = Math.abs(p2 - p1);
    if (delta === 0) return Infinity;
    var pBar = (p1 + p2) / 2;
    var zAlpha = normalInv(1 - (1 - confLevel) / 2);
    var zBeta = normalInv(power);
    var numerator =
      zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) +
      zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
    return Math.ceil((numerator * numerator) / (delta * delta));
  }

  /** Deterministic PRNG (mulberry32) so simulations are reproducible in tests. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Peeking simulator. Runs many A/A experiments where BOTH arms share the same
   * true conversion rate (no real difference exists). It compares:
   *   - fixedHorizonFPR: false-positive rate when you test ONCE at the end.
   *   - sequentialFPR:   false-positive rate when you peek after every checkpoint
   *                      and stop the first time p < alpha.
   * The gap between them is why "checking early" inflates false positives.
   */
  function simulatePeeking(opts) {
    opts = opts || {};
    var baseRate = opts.baseRate === undefined ? 0.05 : opts.baseRate;
    var peeks = opts.peeks === undefined ? 5 : opts.peeks;
    var perCheckpointPerArm =
      opts.perCheckpointPerArm === undefined ? 200 : opts.perCheckpointPerArm;
    var alpha = opts.alpha === undefined ? 0.05 : opts.alpha;
    var trials = opts.trials === undefined ? 2000 : opts.trials;
    var rng = opts.rng || Math.random;

    var sequentialHits = 0;
    var fixedHits = 0;

    for (var trial = 0; trial < trials; trial++) {
      var nA = 0, cA = 0, nB = 0, cB = 0;
      var peekedSignificant = false;

      for (var peek = 0; peek < peeks; peek++) {
        for (var i = 0; i < perCheckpointPerArm; i++) {
          if (rng() < baseRate) cA++;
          nA++;
          if (rng() < baseRate) cB++;
          nB++;
        }
        if (twoProportionZTest(nA, cA, nB, cB).pValue < alpha) {
          peekedSignificant = true;
        }
      }

      if (peekedSignificant) sequentialHits++;
      if (twoProportionZTest(nA, cA, nB, cB).pValue < alpha) fixedHits++;
    }

    return {
      peeks: peeks,
      perCheckpointPerArm: perCheckpointPerArm,
      trials: trials,
      alpha: alpha,
      fixedHorizonFPR: fixedHits / trials,
      sequentialFPR: sequentialHits / trials,
    };
  }

  /**
   * Plain-English verdict. Deliberately resists false certainty: an underpowered,
   * non-significant test is reported as "not enough evidence yet", with an honest
   * estimate of how much longer it must run.
   */
  function buildVerdict(opts) {
    var nA = opts.nA,
      cA = opts.cA,
      nB = opts.nB,
      cB = opts.cB;
    var confLevel = opts.confLevel === undefined ? 0.95 : opts.confLevel;
    var targetPower = opts.targetPower === undefined ? 0.8 : opts.targetPower;
    var mdeRelative = opts.mdeRelative === undefined ? 0.1 : opts.mdeRelative;
    var weeklyTrafficPerArm =
      opts.weeklyTrafficPerArm === undefined ? null : opts.weeklyTrafficPerArm;

    var alpha = 1 - confLevel;
    var test = twoProportionZTest(nA, cA, nB, cB);
    var ci = confidenceInterval(nA, cA, nB, cB, confLevel);
    var power = observedPower(nA, cA, nB, cB, confLevel);
    var requiredPerArm = requiredSampleSize(
      test.rateA,
      mdeRelative,
      targetPower,
      confLevel
    );
    var currentPerArm = Math.min(nA, nB);
    var remaining = Math.max(0, requiredPerArm - currentPerArm);
    var weeksToRun = null;
    if (weeklyTrafficPerArm && weeklyTrafficPerArm > 0 && remaining > 0) {
      weeksToRun = Math.ceil(remaining / weeklyTrafficPerArm);
    }

    var significant = test.pValue < alpha;
    var pct = function (x) {
      return (x * 100).toFixed(2) + "%";
    };

    var headline, detail, tone;

    if (significant) {
      var direction = test.diff > 0 ? "higher" : "lower";
      headline = "Significant result (p = " + test.pValue.toFixed(4) + ").";
      detail =
        "Variant B converts at " + pct(test.rateB) + " vs " + pct(test.rateA) +
        " for control — " + direction + " by " + pct(Math.abs(test.diff)) +
        " absolute (" +
        (test.relativeLift === null ? "n/a" : pct(Math.abs(test.relativeLift))) +
        " relative). The " + Math.round(confLevel * 100) + "% CI for the difference [" +
        pct(ci.lower) + ", " + pct(ci.upper) + "] excludes zero.";
      tone = "win";
      if (power < 0.5) {
        detail +=
          " Caution: post-hoc power is only " + pct(power) +
          ", so treat the effect size as noisy — the direction is more trustworthy than the exact magnitude.";
      }
    } else if (remaining > 0) {
      headline = "Not enough evidence yet.";
      detail =
        "p = " + test.pValue.toFixed(4) + " does not clear the " + pct(alpha) +
        " bar, and the " + Math.round(confLevel * 100) + "% CI [" + pct(ci.lower) +
        ", " + pct(ci.upper) + "] still includes zero. To reliably detect a " +
        pct(mdeRelative) + " relative lift at " + Math.round(targetPower * 100) +
        "% power you need ~" + requiredPerArm.toLocaleString() +
        " visitors per variant; you have " + currentPerArm.toLocaleString() + ".";
      if (weeksToRun !== null) {
        detail +=
          " At " + weeklyTrafficPerArm.toLocaleString() +
          " visitors/variant/week that is about " + weeksToRun + " more week" +
          (weeksToRun === 1 ? "" : "s") + ".";
      } else {
        detail += " That is " + remaining.toLocaleString() + " more visitors per variant.";
      }
      tone = "wait";
    } else {
      headline = "Well-powered, but flat.";
      detail =
        "p = " + test.pValue.toFixed(4) + " with " + pct(power) +
        " power at your current sample. You have enough traffic to detect a " +
        pct(mdeRelative) + " relative lift, and it is not there. Calling this test flat is the honest, commercially useful outcome — ship the simpler variant and move on.";
      tone = "flat";
    }

    return {
      headline: headline,
      detail: detail,
      tone: tone,
      significant: significant,
      test: test,
      ci: ci,
      power: power,
      requiredPerArm: requiredPerArm,
      currentPerArm: currentPerArm,
      remaining: remaining,
      weeksToRun: weeksToRun,
    };
  }

export {
  erf,
  normalCdf,
  normalInv,
  twoProportionZTest,
  confidenceInterval,
  observedPower,
  requiredSampleSize,
  mulberry32,
  simulatePeeking,
  buildVerdict,
};
