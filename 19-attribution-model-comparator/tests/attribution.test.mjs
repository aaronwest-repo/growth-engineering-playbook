// Smoke test for the attribution model comparator core. Pure Node, no deps.
// Run: node tests/attribution.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonl, buildJourneys, compare, weights, journeyDetail, MODELS, MODEL_LABELS } from "../attribution.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const rd = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const webEvents = parseJsonl(rd("../../shared-data/events/web-events.jsonl"));
const conversions = parseJsonl(rd("../../shared-data/events/conversions.jsonl"));

const journeys = buildJourneys({ webEvents, conversions });
const r = compare(journeys);

// --- Loading + journeys ----------------------------------------------------
check("event data loads", webEvents.length > 0 && conversions.length > 0);
check("a journey is built per conversion", journeys.length === conversions.length);
check("every journey has >=1 touch with a channel + time",
  journeys.every((j) => j.touches.length >= 1 && j.touches.every((tch) => tch.channel && typeof tch.time === "number")));
check("multi-channel journeys exist", r.metrics.multiTouch > 10, `multiTouch=${r.metrics.multiTouch}`);
check("consecutive same-channel touches are collapsed",
  journeys.every((j) => j.channels.every((c, i) => i === 0 || j.channels[i - 1] !== c)));

// --- Weight models ---------------------------------------------------------
const tj = [{ channel: "a", time: 0 }, { channel: "b", time: DAYS(3) }, { channel: "c", time: DAYS(6) }];
function DAYS(n) { return n * 86400000; }
const convT = DAYS(6);
check("weights sum to 1 for every model",
  MODELS.every((m) => Math.abs(weights(tj, m, convT).reduce((a, b) => a + b, 0) - 1) < 1e-9));
check("first-click puts all credit on the first touch", weights(tj, "first", convT)[0] === 1);
check("last-click puts all credit on the last touch", weights(tj, "last", convT)[2] === 1);
check("linear splits evenly", weights(tj, "linear", convT).every((w) => Math.abs(w - 1 / 3) < 1e-9));
check("position-based weights the endpoints (40/20/40)",
  (() => { const w = weights(tj, "position", convT); return Math.abs(w[0] - 0.4) < 1e-9 && Math.abs(w[2] - 0.4) < 1e-9 && Math.abs(w[1] - 0.2) < 1e-9; })());
check("time-decay favours the most recent touch",
  (() => { const w = weights(tj, "time_decay", convT); return w[2] > w[1] && w[1] > w[0]; })());
check("a single-touch journey gives that touch 100% under every model",
  MODELS.every((m) => weights([{ channel: "x", time: 0 }], m, 0)[0] === 1));

// --- Aggregate comparison --------------------------------------------------
check("channels + per-model credit are produced", r.channels.length > 1 && MODELS.every((m) => r.byModel[m] && r.byModel[m].credit));
check("each model's credited value totals ~ total revenue",
  MODELS.every((m) => Math.abs(r.channels.reduce((s, c) => s + r.byModel[m].credit[c].value, 0) - r.metrics.revenue) < 1));
check("models disagree — the credited channel values differ across models",
  (() => { const perChannel = r.channels.map((c) => new Set(MODELS.map((m) => r.byModel[m].credit[c].value)).size); return perChannel.some((s) => s > 1); }));
check("the winning channel is defined per model", MODELS.every((m) => r.channels.includes(r.byModel[m].winner)));
check("last-click and first-click credit at least one channel differently",
  r.channels.some((c) => r.byModel.last.credit[c].value !== r.byModel.first.credit[c].value));

// --- Last-click bias -------------------------------------------------------
check("last-click bias is computed per channel (last vs first share)",
  r.bias.length === r.channels.length && r.bias.every((b) => typeof b.delta === "number"));
check("bias is sorted (closers first) and has both over- and under-credited channels",
  r.bias.every((b, i, a) => i === 0 || a[i - 1].delta >= b.delta) && r.bias.some((b) => b.delta > 0) && r.bias.some((b) => b.delta < 0));

// --- Journey detail --------------------------------------------------------
const mj = journeys.find((j) => j.multiChannel);
const d = journeyDetail(mj);
check("journey detail splits one conversion's value across touches per model",
  d.rows.length === MODELS.length &&
  d.rows.every((row) => Math.abs(row.splits.reduce((s, x) => s + x.value, 0) - mj.value) < 0.05));

// --- Metrics + labels ------------------------------------------------------
check("metrics are coherent", r.metrics.conversions === conversions.length && r.metrics.models === 5 && r.metrics.avgPathLength >= 1);
check("every model has a human label", MODELS.every((m) => MODEL_LABELS[m]));

// --- Leakage ---------------------------------------------------------------
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(r).slice(0, 200000)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll attribution model comparator checks passed.");
process.exit(failures ? 1 : 0);
