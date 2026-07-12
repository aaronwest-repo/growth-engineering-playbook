// Smoke test for the mini-CDP identity resolution core. Pure Node, no deps.
// Run: node tests/cdp.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCsv, parseJsonl, buildModel, resolve } from "../cdp.js";

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
const webEvents = parseJsonl(rd("../../shared-data/events/web-events.jsonl"));
const model = buildModel({ customers, orders, emails, tickets, webEvents });

// --- Loading ---------------------------------------------------------------
check("customer data loads", customers.length > 0 && orders.length > 0 && emails.length > 0 && tickets.length > 0);
check("customers expose expected fields",
  ["customer_id", "email_hash", "first_name", "country", "consent_marketing", "consent_personalization"].every((k) => k in customers[0]));

// --- Duplicates + exact match ---------------------------------------------
const balanced = resolve(model, { mode: "balanced", respectConsent: true });
check("duplicate identities detected (fewer profiles than raw records)",
  balanced.metrics.resolvedProfiles < balanced.metrics.rawRecords,
  `raw=${balanced.metrics.rawRecords} resolved=${balanced.metrics.resolvedProfiles}`);
check("exact email_hash matches auto-merge", balanced.metrics.autoMerged >= 1);
check("an auto_merge decision cites the email hash",
  balanced.mergeQueue.some((d) => d.rule === "exact-email-hash" && d.decision === "auto_merge"));

// --- Modes -----------------------------------------------------------------
const strict = resolve(model, { mode: "strict", respectConsent: true });
const aggressive = resolve(model, { mode: "aggressive", respectConsent: true });
check("aggressive mode merges more than strict (fewer resolved profiles)",
  aggressive.metrics.resolvedProfiles < strict.metrics.resolvedProfiles,
  `strict=${strict.metrics.resolvedProfiles} aggressive=${aggressive.metrics.resolvedProfiles}`);
check("balanced holds weak matches for review", balanced.metrics.needsReview >= 1, `review=${balanced.metrics.needsReview}`);
check("balanced avoids a false merge that aggressive makes",
  balanced.falseMergeRisks.some((r) => !r.merged) && aggressive.falseMergeRisks.some((r) => r.merged));

// --- Consent ---------------------------------------------------------------
const consentOff = resolve(model, { mode: "balanced", respectConsent: false });
check("respecting consent can block merges", balanced.metrics.blockedMerges >= 0);
check("ignoring consent never blocks", consentOff.metrics.blockedMerges === 0);
check("a merged profile records a consent conflict (most-restrictive resolution)",
  balanced.metrics.consentConflicts >= 1);

// --- Resolved profile completeness ----------------------------------------
const withOrders = balanced.profiles.find((p) => p.orders.length > 0);
check("resolved profile includes orders", !!withOrders);
check("resolved profile includes email events", balanced.profiles.some((p) => p.emails.length > 0));
check("resolved profile includes support tickets", balanced.profiles.some((p) => p.tickets.length > 0));
const mergedProfile = balanced.profiles.find((p) => p.merged);
check("a merged profile unifies >= 2 source records", mergedProfile && mergedProfile.recordIds.length >= 2);

// --- Segments --------------------------------------------------------------
const allSegs = new Set(balanced.profiles.flatMap((p) => p.segments));
check("segment preview includes VIP", allSegs.has("VIP"));
check("segment preview includes churn risk", allSegs.has("churn risk"));
check("segment preview includes newsletter eligible", allSegs.has("newsletter eligible"));
check("segment preview includes personalization allowed", allSegs.has("personalization allowed"));

// --- Audit trail -----------------------------------------------------------
const a0 = balanced.mergeQueue[0];
check("audit entry has rule/evidence/confidence/decision/consentNote",
  a0 && a0.rule && a0.evidence && typeof a0.confidence === "number" && a0.decision && a0.consentNote);

// --- Privacy ---------------------------------------------------------------
const blob = JSON.stringify(customers) + JSON.stringify(emails) + JSON.stringify(tickets);
check("no raw email addresses in customer data", !/@/.test(blob));
check("email_hash values are synthetic tokens", customers.filter((c) => c.email_hash).every((c) => c.email_hash.startsWith("eh_")));

console.log("");
if (failures > 0) { console.error(`cdp.test: ${failures} check(s) FAILED`); process.exit(1); }
console.log("cdp.test: all checks passed");
