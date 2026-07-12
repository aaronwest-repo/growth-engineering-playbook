// Smoke test for the Customer Support Insight Miner core. Pure Node, no deps.
// Run: node tests/support.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCsv, buildInsights, insightDetail } from "../support.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const rd = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const customers = parseCsv(rd("../../shared-data/customers/customers.csv"));
const orders = parseCsv(rd("../../shared-data/customers/orders.csv"));
const tickets = parseCsv(rd("../../shared-data/customers/support-tickets.csv"));
const products = parseCsv(rd("../../shared-data/catalog/products-clean.csv"));

const model = buildInsights({ tickets, customers, orders, products });

// --- Loading ---------------------------------------------------------------
check("support ticket data loads", tickets.length > 0);
check("product/customer/order data loads", products.length > 0 && customers.length > 0 && orders.length > 0);
check("tickets expose mined fields",
  ["theme", "sentiment", "urgency", "product_id", "category", "status", "subject", "message"].every((k) => k in tickets[0]));
check("ticket count is meaningful (> 100, dataset extended)", tickets.length > 100, `got ${tickets.length}`);

// --- Theme clustering -------------------------------------------------------
check("themes are clustered", model.themes.length >= 5 && model.themes.every((t) => t.count > 0));
check("theme clusters carry sentiment + urgency mix",
  model.themes.every((t) => t.sentiment && t.urgency && "negative" in t.sentiment && "high" in t.urgency));
check("themes sorted by volume (largest first)",
  model.themes.every((t, i, a) => i === 0 || a[i - 1].count >= t.count));

// --- Metrics ----------------------------------------------------------------
check("negative sentiment count > 0", model.metrics.negativeTickets > 0);
check("high urgency count > 0", model.metrics.highUrgency > 0);
check("top-level metrics are coherent",
  model.metrics.totalTickets === tickets.length &&
  model.metrics.openTickets <= model.metrics.totalTickets &&
  model.metrics.affectedCustomers > 0 &&
  /\(\d+\)/.test(model.metrics.topCategoryIssue));

// --- Heatmap ----------------------------------------------------------------
check("product/category issue heatmap exists",
  model.categories.length > 0 && model.categories.every((c) => c.count > 0 && "returnCount" in c && "negShare" in c));
check("top products list is populated", model.topProducts.length > 0 && model.topProducts[0].count > 0);
check("a category shows return friction (returns/exchange)", model.categories.some((c) => c.returnCount > 0));

// --- Content gaps -----------------------------------------------------------
check("content gaps are generated", model.contentGaps.length > 0 &&
  model.contentGaps.every((g) => g.rec && g.owner && g.count >= 4));
check("metrics.contentGaps matches list length", model.metrics.contentGaps === model.contentGaps.length);

// --- Automation -------------------------------------------------------------
check("automation opportunities are generated",
  model.automations.length > 0 && model.automations.every((a) => a.name && a.owner && a.count > 0));
check("delivery is flagged as an automation candidate",
  model.automations.some((a) => a.theme === "delivery"));

// --- Customer risk ----------------------------------------------------------
check("customers with multiple tickets are flagged", model.multiTicketCustomers > 0);
check("support-risk customers are identified with recommendations",
  model.riskCustomers.length > 0 &&
  model.riskCustomers.every((c) => c.recommendation && typeof c.score === "number") &&
  model.riskCustomers.some((c) => c.tickets >= 2 || c.negatives >= 1));
check("risk customers sorted by score (highest first)",
  model.riskCustomers.every((c, i, a) => i === 0 || a[i - 1].score >= c.score));

// --- Action queue -----------------------------------------------------------
check("action queue contains owner, priority, and recommendation",
  model.actions.length > 0 &&
  model.actions.every((a) => a.owner && a.priority && a.recommendation && typeof a.signal === "number"));
check("action queue is priority-ordered",
  (() => { const r = { high: 0, medium: 1, low: 2 }; return model.actions.every((a, i, arr) => i === 0 || r[arr[i - 1].priority] <= r[a.priority]); })());
check("action queue routes to varied owners", new Set(model.actions.map((a) => a.owner)).size >= 3);

// --- Insight detail ---------------------------------------------------------
const topTheme = model.themes[0].theme;
const detail = insightDetail(model, { kind: "theme", key: topTheme });
check("selected insight includes example snippets",
  detail && detail.examples.length > 0 &&
  detail.examples.every((e) => e.subject && e.message) &&
  detail.count > 0 && detail.why);
const custDetail = insightDetail(model, { kind: "customer", key: model.riskCustomers[0].customer_id });
check("customer insight includes affected count + snippets",
  custDetail && custDetail.affected >= 0 && custDetail.examples.length > 0);

// --- Leakage ----------------------------------------------------------------
const blob = JSON.stringify(model.tickets) + JSON.stringify(model.riskCustomers) + JSON.stringify(detail);
check("no raw emails appear (no '@')", !blob.includes("@"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll customer support insight miner checks passed.");
process.exit(failures ? 1 : 0);
