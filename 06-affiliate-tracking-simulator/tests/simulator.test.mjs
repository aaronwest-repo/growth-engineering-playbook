// Smoke test for the affiliate tracking simulator. Pure Node, no dependencies.
// Run: node tests/simulator.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonl, buildModel, simulate, classify } from "../simulator.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}

const load = (rel) => parseJsonl(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const clicks = load("../../shared-data/events/affiliate-clicks.jsonl");
const web = load("../../shared-data/events/web-events.jsonl");
const conversions = load("../../shared-data/events/conversions.jsonl");
const model = buildModel({ clicks, web, conversions });

// --- Loading ---------------------------------------------------------------
check("loads affiliate clicks", clicks.length > 0, `got ${clicks.length}`);
check("loads web events", web.length > 0, `got ${web.length}`);
check("loads conversions", conversions.length > 0, `got ${conversions.length}`);
check("clicks carry expected fields",
  ["click_id", "visitor_id", "publisher_id", "clicked_at", "cookie_set", "cookie_lost", "suspicious_flag"].every((k) => k in clicks[0]));

const base = { windowDays: 30, rule: "last_affiliate", cookieLoss: 0, validation: "strict" };

// --- Attribution window ----------------------------------------------------
const w1 = simulate(model, { ...base, windowDays: 1 }).metrics.trackedConversions;
const w7 = simulate(model, { ...base, windowDays: 7 }).metrics.trackedConversions;
const w30 = simulate(model, { ...base, windowDays: 30 }).metrics.trackedConversions;
check("wider attribution window credits more conversions", w1 < w7 && w7 < w30, `1d=${w1} 7d=${w7} 30d=${w30}`);

// --- Cookie loss -----------------------------------------------------------
const trackedNormal = simulate(model, { ...base, cookieLoss: 0 }).metrics.trackedConversions;
const trackedLoss = simulate(model, { ...base, cookieLoss: 0.6 }).metrics.trackedConversions;
check("cookie loss reduces tracked conversions", trackedLoss < trackedNormal, `normal=${trackedNormal} loss=${trackedLoss}`);

// --- Validation strict vs lenient -----------------------------------------
const strict = simulate(model, { ...base, validation: "strict" }).metrics;
const lenient = simulate(model, { ...base, validation: "lenient" }).metrics;
check("strict validation rejects more commission than lenient",
  strict.rejectedCommission > lenient.rejectedCommission,
  `strict=${strict.rejectedCommission} lenient=${lenient.rejectedCommission}`);

// --- Duplicates, returns, outside-window ----------------------------------
const records = classify(model, base);
check("duplicate claims are detected", records.some((r) => r.isDuplicate && r.hasAffiliate));
check("returned orders are rejected", records.some((r) => r.status === "rejected_return"));
check("outside-window conversions are rejected",
  records.some((r) => r.status === "rejected_outside_window"));
check("cookie-loss conversions are counted as lost", records.some((r) => r.status === "lost_cookie"));

// --- Attribution rule affects cross-channel --------------------------------
const lastAff = simulate(model, { ...base, rule: "last_affiliate" }).metrics.trackedConversions;
const lastPaid = simulate(model, { ...base, rule: "last_paid" }).metrics.trackedConversions;
check("last-paid-touch rule credits fewer affiliate conversions than last-affiliate",
  lastPaid < lastAff, `lastAff=${lastAff} lastPaid=${lastPaid}`);
check("cross-channel rejections appear under last-paid rule",
  classify(model, { ...base, rule: "last_paid" }).some((r) => r.status === "rejected_cross_channel"));

// --- Fraud -----------------------------------------------------------------
const sim = simulate(model, base);
const flagged = sim.fraud.filter((p) => p.flagged);
check("a suspicious publisher is flagged", flagged.length >= 1, JSON.stringify(sim.fraud.map((p) => [p.publisher_name, p.flagged])));
check("flagged publisher is ClickFarmX", flagged.some((p) => p.publisher_name === "ClickFarmX"));

// --- Business impact -------------------------------------------------------
check("impact includes overpayment prevented > 0", sim.impact.overpaymentPrevented > 0, `got ${sim.impact.overpaymentPrevented}`);
check("impact includes undercounted revenue from cookie loss", sim.impact.undercountedRevenue > 0);
check("window comparison has all three windows",
  [1, 7, 30].every((w) => sim.impact.windowComparison[w]));

// --- Journeys --------------------------------------------------------------
check("at least one journey timeline is built", sim.journeys.length >= 1);
const j = sim.journeys[0];
const kinds = j.steps.map((s) => s.kind);
check("a journey goes click → web touchpoint → conversion",
  kinds.includes("affiliate_click") && kinds.includes("conversion") && j.steps.length >= 3,
  JSON.stringify(kinds));

// --- No private identifiers in generated data ------------------------------
const blob = JSON.stringify({ clicks: clicks.slice(0, 50), conversions: conversions.slice(0, 50) });
check("no obvious personal data / real identifiers in events",
  !/@|\+?\d{9,}|festival|ticketmaster|AKIA/i.test(blob));

console.log("");
if (failures > 0) { console.error(`simulator.test: ${failures} check(s) FAILED`); process.exit(1); }
console.log("simulator.test: all checks passed");
