// Smoke test for the consent-mode impact simulator core. Pure Node, no deps.
// Run: node tests/consent.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonl, buildBaseline, simulate, MODELING_RATE, PROFILES } from "../consent.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const rd = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const webEvents = parseJsonl(rd("../../shared-data/events/web-events.jsonl"));
const conversions = parseJsonl(rd("../../shared-data/events/conversions.jsonl"));
const base = buildBaseline({ webEvents, conversions });

// --- Baseline --------------------------------------------------------------
check("event data loads and baseline is built", base.channels.length > 1 && base.totalRevenue > 0);
check("baseline conversions total the conversion count", base.totalConversions === conversions.length);
check("channels carry conversions + revenue", base.channels.every((c) => c.conversions > 0 && c.revenue > 0));

// --- No loss = perfect tracking -------------------------------------------
const none = simulate(base, { decline: "0%", itp: "0%", adblock: "0%" });
check("with zero loss, observed equals actual",
  Math.abs(none.observed - none.actual) < 1 && none.metrics.underReportPct === 0);

// --- Loss under-reports -----------------------------------------------------
const loss = simulate(base, { decline: "20%", itp: "30%", adblock: "15%" });
check("loss rates under-report observed revenue vs actual", loss.observed < loss.actual && loss.metrics.underReportPct > 0);
check("every channel tracks <= 100% and observed <= actual",
  loss.rows.every((r) => r.trackedPct <= 100 && r.observed <= r.actual + 0.01));
check("under-reporting is not uniform across channels (per-channel profiles)",
  new Set(loss.rows.map((r) => r.trackedPct)).size > 1);

// --- Loss decomposition sums to total loss ---------------------------------
check("consent + ITP + ad-block loss ≈ actual − observed",
  Math.abs((loss.loss.consent + loss.loss.itp + loss.loss.adblock) - (loss.actual - loss.observed)) < 1,
  `parts=${loss.loss.consent + loss.loss.itp + loss.loss.adblock} gap=${loss.actual - loss.observed}`);

// --- Monotonicity ----------------------------------------------------------
const more = simulate(base, { decline: "40%", itp: "30%", adblock: "15%" });
check("higher consent decline widens the gap", more.observed < loss.observed);

// --- Consent mode recovers some, but only the consent-declined slice -------
const off = simulate(base, { decline: "40%", itp: "30%", adblock: "15%", consentMode: false });
const on = simulate(base, { decline: "40%", itp: "30%", adblock: "15%", consentMode: true });
check("consent mode raises reported revenue", on.reported > off.reported && on.recovered > 0);
check("consent mode only recovers consent-declined losses (~modeling rate)",
  Math.abs(on.recovered - off.loss.consent * MODELING_RATE) < 1,
  `recovered=${on.recovered} expected=${off.loss.consent * MODELING_RATE}`);
check("consent mode never fully closes the gap (ITP + ad-block remain)",
  on.metrics.residualGapPct > 0 && on.reported < on.actual);

// --- Most-affected channel -------------------------------------------------
check("most-affected channel is identified and has the highest gap%",
  loss.metrics.mostAffected && loss.byGap[0].channel === loss.metrics.mostAffected &&
  loss.byGap.every((r, i, a) => i === 0 || a[i - 1].gapPct >= r.gapPct));
check("privacy-heavy channels under-report more than paid_search",
  (() => {
    const g = Object.fromEntries(loss.rows.map((r) => [r.channel, r.gapPct]));
    return g.affiliate !== undefined && g.paid_search !== undefined ? g.affiliate > g.paid_search : true;
  })());

// --- Metrics coherence -----------------------------------------------------
check("metrics are coherent",
  none.metrics.observedPct === 100 && loss.metrics.observedPct < 100 &&
  loss.metrics.underReportPct === 100 - loss.metrics.observedPct);
check("profiles cover the main channels", ["affiliate", "organic", "paid_search", "email", "direct"].every((c) => PROFILES[c]));

// --- Leakage ---------------------------------------------------------------
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(loss)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll consent-mode impact simulator checks passed.");
process.exit(failures ? 1 : 0);
