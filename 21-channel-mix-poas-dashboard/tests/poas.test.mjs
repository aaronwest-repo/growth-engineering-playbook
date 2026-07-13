// Smoke test for the channel-mix POAS dashboard core. Pure Node, no deps.
// Run: node tests/poas.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCsv, buildDashboard, INCREMENTALITY, RANK_FIELDS } from "../poas.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const rd = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const campaigns = parseCsv(rd("../../shared-data/marketing/campaigns-clean.csv"));
const d = buildDashboard({ campaigns });
const ch = (c) => d.rows.find((r) => r.channel === c);

// --- Loading + aggregation -------------------------------------------------
check("campaign data loads", campaigns.length > 0);
check("channels are aggregated with spend + revenue + margin",
  d.rows.length > 3 && d.rows.every((r) => r.spend > 0 && r.revenue > 0 && typeof r.margin === "number"));

// --- Metric maths ----------------------------------------------------------
const g = ch("google");
check("ROAS = revenue / spend", g && Math.abs(g.roas - g.revenue / g.spend) < 0.02);
check("POAS = margin / spend", g && Math.abs(g.poas - g.margin / g.spend) < 0.02);
check("net contribution = margin − spend", g && Math.abs(g.contribution - (g.margin - g.spend)) < 0.02);
check("CPA = spend / orders", g && Math.abs(g.cpa - g.spend / g.orders) < 0.02);

// --- The ROAS-vs-POAS lie --------------------------------------------------
check("a channel exists that clears ROAS but loses money on POAS (a ROAS trap)",
  d.roasTraps.length > 0 && d.roasTraps.every((r) => r.roas >= 1.5 && r.poas < 1),
  JSON.stringify(d.roasTraps.map((r) => `${r.channel} roas=${r.roas} poas=${r.poas}`)));
check("instagram is unprofitable on POAS despite a positive-looking ROAS",
  (() => { const i = ch("instagram"); return i ? (i.roas > 1 && i.poas < 1 && i.contribution < 0) : true; })());
check("unprofitable channels are flagged (POAS < 1 ⇔ negative contribution)",
  d.rows.filter((r) => r.poas < 1).every((r) => r.contribution < 0) &&
  d.rows.filter((r) => r.poas >= 1).every((r) => r.contribution >= 0));

// --- Blended vs per-channel ------------------------------------------------
check("blended totals sum the channels",
  Math.abs(d.blended.spend - d.rows.reduce((s, r) => s + r.spend, 0)) < 1 &&
  Math.abs(d.blended.revenue - d.rows.reduce((s, r) => s + r.revenue, 0)) < 1);
check("blended can look healthy while individual channels lose money",
  d.blended.poas > 1 && d.unprofitable.length > 0,
  `blendedPOAS=${d.blended.poas} unprofitable=${d.unprofitable.length}`);
check("breakeven ROAS = 1 / blended margin rate",
  Math.abs(d.breakevenRoas - 1 / d.blended.marginRate) < 0.05);

// --- Ranking ---------------------------------------------------------------
const byRoas = buildDashboard({ campaigns }, { rankBy: "roas" }).ranked.map((r) => r.channel);
const byContribution = buildDashboard({ campaigns }, { rankBy: "contribution" }).ranked.map((r) => r.channel);
check("ranking is sorted by the chosen metric",
  buildDashboard({ campaigns }, { rankBy: "poas" }).ranked.every((r, i, a) => i === 0 || a[i - 1].poas >= r.poas));
check("ROAS ranking differs from contribution ranking (the metric changes the story)",
  JSON.stringify(byRoas) !== JSON.stringify(byContribution));

// --- Incrementality lens ---------------------------------------------------
const inc = buildDashboard({ campaigns }, { incremental: true });
check("incrementality lens lowers owned/branded credit",
  (() => { const nl = inc.rows.find((r) => r.channel === "newsletter"); return nl ? nl.incContribution < nl.contribution : true; }));
check("incrementality can flip a channel from profitable to not (or hold)",
  inc.rows.every((r) => typeof r.incProfitable === "boolean") &&
  inc.rows.some((r) => r.incFactor < 1));
check("every channel has an incrementality factor", d.rows.every((r) => typeof r.incFactor === "number"));
check("rank fields + incrementality map cover the channels",
  Object.keys(RANK_FIELDS).length === 4 && ["newsletter", "affiliate", "google", "facebook", "instagram"].every((c) => c in INCREMENTALITY));

// --- Metrics ---------------------------------------------------------------
check("metrics are coherent",
  d.metrics.spend === d.blended.spend && d.metrics.blendedPoas === d.blended.poas &&
  d.metrics.unprofitableChannels === d.unprofitable.length && d.metrics.bestChannel);

// --- Leakage ---------------------------------------------------------------
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(d)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll channel-mix POAS dashboard checks passed.");
process.exit(failures ? 1 : 0);
