// Smoke test for the server-side vs client-side tracking core. Pure Node, no deps.
// Run: node tests/tracking.test.mjs   (exits non-zero on any failure)

import { SCENARIOS } from "../scenarios.js";
import { captureRates, analyzeSegment, buildReport, ARCHITECTURES, SORTS } from "../tracking.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- captureRates: the ordering invariants ---------------------------------
const seg = SCENARIOS.find((s) => s.id === "safari-ios");
const r = captureRates(seg);
check("client capture is below server capture", r.client < r.server);
check("server capture is below the consent ceiling", r.server < r.consentKept + 1e-9 && r.server <= r.consentKept);
check("deduped hybrid is at least server (union can only add)", r.hybrid >= r.server - 1e-9);
check("deduped hybrid never exceeds the consent ceiling", r.hybrid <= r.consentKept + 1e-9);
check("naive hybrid over-counts (exceeds the ceiling here)", r.naive > r.consentKept);
check("naive hybrid equals client + server", near(r.naive, r.client + r.server));

// --- consent is the wall ---------------------------------------------------
check("no architecture beats the consent ceiling except the (wrong) naive one",
  r.client <= r.consentKept && r.server <= r.consentKept && r.hybrid <= r.consentKept);
const eu = analyzeSegment(SCENARIOS.find((s) => s.id === "eu-consent"));
check("high-consent-decline segment is capped low even server-side", eu.ceilingPct < 0.65 && eu.capturePct.server <= eu.ceilingPct + 1e-9);

// --- server recovers the most where client loses the most ------------------
const bySeg = Object.fromEntries(SCENARIOS.map((s) => [s.id, analyzeSegment(s)]));
check("privacy-heavy segment has the worst client capture",
  bySeg["privacy-heavy"].capturePct.client < bySeg["chrome-desktop"].capturePct.client);
check("chrome-desktop gets the least server recovery (already good client-side)",
  bySeg["chrome-desktop"].serverRecovery < bySeg["privacy-heavy"].serverRecovery &&
  bySeg["chrome-desktop"].serverRecovery < bySeg["safari-ios"].serverRecovery);

// --- per-segment accounting adds up ----------------------------------------
for (const s of Object.values(bySeg)) {
  check(`${s.id}: recoverable + unrecoverable = total client loss`,
    near(s.recoverable + s.unrecoverable, s.trueEvents - s.captured.client, 1),
    `${s.recoverable}+${s.unrecoverable} vs ${s.trueEvents - s.captured.client}`);
  check(`${s.id}: waterfall ends at client captured`,
    near(s.waterfall[s.waterfall.length - 1].value, s.captured.client, 1));
  check(`${s.id}: recoverable loss is the ad-block+ITP+beacon steps (±rounding)`,
    near(s.recoverable, s.waterfall.filter((w) => w.recoverable).reduce((a, w) => a + w.lost, 0), 2));
}

// --- report aggregate: the headline story ----------------------------------
const rep = buildReport(SCENARIOS, { sort: "recovery" });
const m = rep.metrics;
check("client-side sees barely half of reality", m.clientPct > 0.5 && m.clientPct < 0.62, `client=${m.clientPct}`);
check("server-side recovers a big chunk", m.serverPct > m.clientPct + 0.15, `server=${m.serverPct}`);
check("hybrid is near but under the consent ceiling", m.hybridPct <= m.ceilingPct + 1e-9 && m.hybridPct > m.serverPct - 1e-9);
check("consent ceiling is the hard limit (~80%)", m.ceilingPct > 0.75 && m.ceilingPct < 0.85);
check("most client loss is recoverable, the rest is consent",
  m.recoverableShare > 0.4 && m.recoverableShare < 0.7, `share=${m.recoverableShare}`);
check("naive hybrid reports MORE than 100% of truth (double count)", m.naivePct > 1.0, `naive=${m.naivePct}`);
check("overcount is a material inflation", m.overcountPct > 0.2, `overcount=${m.overcountPct}`);
check("sort by recovery is descending",
  rep.sorted.every((x, i, a) => i === 0 || a[i - 1].serverRecovery >= x.serverRecovery));
check("sort by volume reorders", buildReport(SCENARIOS, { sort: "volume" }).sorted[0].trueEvents === Math.max(...SCENARIOS.map((s) => s.trueEvents)));
check("every architecture has a label", Object.keys(ARCHITECTURES).every((k) => ARCHITECTURES[k].label));

// --- Leakage ---------------------------------------------------------------
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(rep)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll server-side vs client-side tracking checks passed.");
process.exit(failures ? 1 : 0);
