// Smoke test for the statistics core. Pure Node, no dependencies.
// Run: node tests/stats.test.mjs   (exits non-zero on any failure)

import {
  normalCdf,
  normalInv,
  twoProportionZTest,
  confidenceInterval,
  observedPower,
  requiredSampleSize,
  buildVerdict,
  simulatePeeking,
  mulberry32,
} from "../stats.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name} ${extra}`);
  }
}
function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

// --- Normal distribution primitives ---------------------------------------
check("normalCdf(0) == 0.5", near(normalCdf(0), 0.5, 1e-6));
check("normalCdf(1.959964) ~ 0.975", near(normalCdf(1.959964), 0.975, 1e-3),
  `got ${normalCdf(1.959964)}`);
check("normalInv(0.975) ~ 1.95996", near(normalInv(0.975), 1.959964, 2e-3),
  `got ${normalInv(0.975)}`);
check("normalInv(0.8) ~ 0.84162", near(normalInv(0.8), 0.84162, 2e-3),
  `got ${normalInv(0.8)}`);

// --- Two-proportion z-test -------------------------------------------------
const marginal = twoProportionZTest(1000, 100, 1000, 130); // 10% vs 13%
check("z-test rateA == 0.10", near(marginal.rateA, 0.1, 1e-9));
check("z-test marginal p in (0.01, 0.05)",
  marginal.pValue > 0.01 && marginal.pValue < 0.05, `got p=${marginal.pValue}`);

const clear = twoProportionZTest(10000, 500, 10000, 700); // 5% vs 7%
check("z-test clear difference p < 0.001", clear.pValue < 0.001,
  `got p=${clear.pValue}`);

const flat = twoProportionZTest(1000, 100, 1000, 100); // identical
check("z-test identical arms diff == 0", near(flat.diff, 0, 1e-12));
check("z-test identical arms p ~ 1", near(flat.pValue, 1, 1e-6),
  `got p=${flat.pValue}`);

// --- Confidence interval ---------------------------------------------------
const ci = confidenceInterval(1000, 100, 1000, 130, 0.95);
check("CI brackets the point difference",
  ci.lower < ci.diff && ci.diff < ci.upper);
check("CI has positive width", ci.upper - ci.lower > 0);

// --- Power -----------------------------------------------------------------
check("observed power high for clear difference",
  observedPower(10000, 500, 10000, 700, 0.95) > 0.9);
check("observed power low for tiny sample flat test",
  observedPower(50, 5, 50, 5, 0.95) < 0.2);

// --- Required sample size --------------------------------------------------
// baseline 5%, +10% relative (-> 5.5%), 80% power, 95% conf. ~31k per arm.
const n = requiredSampleSize(0.05, 0.1, 0.8, 0.95);
check("required sample size ~31k per arm", n > 30000 && n < 33000, `got ${n}`);
check("bigger MDE needs fewer samples",
  requiredSampleSize(0.05, 0.2, 0.8, 0.95) < n);

// --- Verdict ---------------------------------------------------------------
const underpowered = buildVerdict({
  nA: 800, cA: 40, nB: 800, cB: 46, confLevel: 0.95,
  targetPower: 0.8, mdeRelative: 0.1, weeklyTrafficPerArm: 800,
});
check("underpowered test is not significant", !underpowered.significant);
check("underpowered verdict recommends waiting", underpowered.tone === "wait");
check("underpowered verdict estimates weeks to run",
  underpowered.weeksToRun !== null && underpowered.weeksToRun > 0);

const winner = buildVerdict({
  nA: 10000, cA: 500, nB: 10000, cB: 700, confLevel: 0.95,
});
check("clear winner verdict is significant", winner.significant);
check("clear winner verdict tone is win", winner.tone === "win");

// --- Peeking simulator -----------------------------------------------------
const sim = simulatePeeking({
  baseRate: 0.05, peeks: 5, perCheckpointPerArm: 150,
  alpha: 0.05, trials: 1500, rng: mulberry32(123),
});
check("fixed-horizon FPR near alpha",
  near(sim.fixedHorizonFPR, 0.05, 0.03), `got ${sim.fixedHorizonFPR}`);
check("sequential peeking inflates FPR above fixed horizon",
  sim.sequentialFPR > sim.fixedHorizonFPR,
  `seq=${sim.sequentialFPR} fixed=${sim.fixedHorizonFPR}`);
check("peeking simulator is deterministic under a fixed seed",
  simulatePeeking({ baseRate: 0.05, peeks: 5, perCheckpointPerArm: 150,
    alpha: 0.05, trials: 1500, rng: mulberry32(123) }).sequentialFPR ===
    sim.sequentialFPR);

console.log("");
if (failures > 0) {
  console.error(`stats.test: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("stats.test: all checks passed");
