// Smoke test for the lifecycle campaign planner core. Pure Node, no deps.
// Run: node tests/planner.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCsv, buildProfiles, planCampaigns, buildPlanner, SEGMENTS } from "../planner.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const rd = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const customers = parseCsv(rd("../../shared-data/customers/customers.csv"));
const orders = parseCsv(rd("../../shared-data/customers/orders.csv"));
const emails = parseCsv(rd("../../shared-data/customers/email-events.csv"));
const tickets = parseCsv(rd("../../shared-data/customers/support-tickets.csv"));

// --- Loading ---------------------------------------------------------------
check("customer/order/email/support data loads",
  customers.length > 0 && orders.length > 0 && emails.length > 0 && tickets.length > 0);

const base = buildProfiles({ customers, orders, tickets });

// --- Segments --------------------------------------------------------------
check("lifecycle segments are derived",
  base.profiles.length > 0 && base.profiles.every((p) => p.segment in SEGMENTS));
check("more than one distinct segment present",
  new Set(base.profiles.map((p) => p.segment)).size > 1);

// --- Baseline plan ---------------------------------------------------------
const basic = planCampaigns(base, { objective: "retention", incentive: "none", holdout: "0%", strictness: "basic" });
check("at least 4 campaign plans exist", basic.campaigns.length >= 4, `got ${basic.campaigns.length}`);
check("eligible customers > 0 for at least one campaign",
  basic.campaigns.some((c) => c.eligibleCount > 0));
check("message brief includes subject, preheader, CTA, and incentive stance",
  basic.campaigns.every((c) => c.brief.subject && c.brief.preheader && c.brief.cta && c.brief.angle));

// --- Suppression -----------------------------------------------------------
const noConsent = new Set(customers.filter((c) => c.consent_marketing !== "true").map((c) => c.customer_id));
const eligibleIdsBasic = new Set(basic.campaigns.flatMap((c) => c.targetedSample.concat(
  // reconstruct eligible via candidates minus suppressed is internal; use metrics instead
).map((p) => p.customer_id)));
check("suppression removes customers without marketing consent",
  basic.campaigns.every((c) => c.suppressed.concat(c.targetedSample).length >= 0) &&
  !basic.campaigns.some((c) => c.targetedSample.some((p) => noConsent.has(p.customer_id))),
  "a no-consent customer appeared in a targeted set");

const strict = planCampaigns(base, { objective: "retention", incentive: "none", holdout: "0%", strictness: "strict" });
check("strict suppression removes more customers than basic",
  strict.metrics.suppressedCustomers > basic.metrics.suppressedCustomers,
  `strict=${strict.metrics.suppressedCustomers} basic=${basic.metrics.suppressedCustomers}`);

// --- Holdout ---------------------------------------------------------------
const noHold = planCampaigns(base, { incentive: "10%", holdout: "0%", strictness: "basic" });
const withHold = planCampaigns(base, { incentive: "10%", holdout: "20%", strictness: "basic" });
const targetedSum = (plan) => plan.campaigns.reduce((s, c) => s + c.targetedCount, 0);
check("holdout percentage reduces target audience",
  targetedSum(withHold) < targetedSum(noHold) && withHold.metrics.holdoutCustomers > 0,
  `held=${withHold.metrics.holdoutCustomers} targetedNoHold=${targetedSum(noHold)} targetedHold=${targetedSum(withHold)}`);

// --- Incentive + margin ----------------------------------------------------
const inc0 = planCampaigns(base, { incentive: "none", holdout: "10%" });
const inc15 = planCampaigns(base, { incentive: "15%", holdout: "10%" });
check("incentive level changes incentive cost",
  inc15.metrics.incentiveCost > inc0.metrics.incentiveCost && inc0.metrics.incentiveCost === 0,
  `inc0=${inc0.metrics.incentiveCost} inc15=${inc15.metrics.incentiveCost}`);
check("higher incentive can trigger a margin (over-discount) warning",
  inc15.campaigns.some((c) => c.warnings.some((w) => w.type === "over_discount")) &&
  !inc0.campaigns.some((c) => c.warnings.some((w) => w.type === "over_discount")));

// --- Measurement warning ---------------------------------------------------
check("holdout 0% triggers a measurement warning",
  noHold.campaigns.some((c) => c.warnings.some((w) => w.type === "measurement")) &&
  !withHold.campaigns.some((c) => c.warnings.some((w) => w.type === "measurement")));

// --- Support-first campaign ------------------------------------------------
const support = basic.campaigns.find((c) => c.key === "support_first_recovery");
check("support-risk campaign exists and flags service-first / no discount",
  !!support && support.usesIncentive === false &&
  support.warnings.some((w) => w.type === "support"));

// --- Measurement panel maths ----------------------------------------------
const anyTargeted = inc15.campaigns.find((c) => c.targetedCount > 0 && c.usesIncentive);
check("measurement calculates revenue opportunity and net contribution",
  anyTargeted && anyTargeted.revenueOpportunity > 0 &&
  Math.abs(anyTargeted.netContribution - (anyTargeted.grossMargin - anyTargeted.incentiveCost)) < 0.02,
  anyTargeted ? `rev=${anyTargeted.revenueOpportunity} net=${anyTargeted.netContribution}` : "no incentive campaign targeted");

// --- Objective control -----------------------------------------------------
check("objective control selects a matching campaign",
  planCampaigns(base, { objective: "winback" }).selected === "winback" &&
  planCampaigns(base, { objective: "vip_loyalty" }).selected === "vip_early_access");

// --- Convenience wrapper ---------------------------------------------------
const full = buildPlanner({ customers, orders, tickets }, { objective: "second_purchase" });
check("buildPlanner returns base + plan", !!full.base && !!full.campaigns && full.selected === "second_purchase");

// --- Leakage ---------------------------------------------------------------
const blob = JSON.stringify(basic.campaigns);
check("no raw emails appear in campaign output (no '@')", !blob.includes("@"));
check("customer ids are synthetic tokens",
  basic.campaigns.every((c) => c.suppressed.concat(c.targetedSample).every((p) => /^C-\d+$/.test(p.customer_id))));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll lifecycle campaign planner checks passed.");
process.exit(failures ? 1 : 0);
