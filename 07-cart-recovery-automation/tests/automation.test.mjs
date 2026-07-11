// Smoke test for the cart-recovery automation engine. Pure Node, no deps.
// Run: node tests/automation.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonl, parseCsv, buildModel, run, HIGH_VALUE_THRESHOLD } from "../automation.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const url = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const carts = parseJsonl(readFileSync(url("../../shared-data/events/cart-events.jsonl"), "utf8"));
const products = parseCsv(readFileSync(url("../../shared-data/catalog/products-clean.csv"), "utf8"));
const model = buildModel({ carts, products });

const base = { delayMinutes: 120, maxRetries: 3, approvalMode: "auto", suppression: "basic" };

// --- Loading ---------------------------------------------------------------
check("loads cart events", carts.length > 0, `got ${carts.length}`);
check("loads product catalog", products.length > 0);

const r = run(model, base);
check("carts entered workflow > 0", r.metrics.cartsEntered > 0);
check("eligible carts > 0", r.metrics.eligible > 0);
check("suppressed carts > 0", r.metrics.suppressed > 0);

// --- Suppression -----------------------------------------------------------
check("purchase suppression works",
  r.records.some((x) => x.suppressedReason === "suppressed_because_purchased"));
check("unsubscribe/consent suppression works",
  r.records.some((x) => x.suppressedReason === "suppressed_because_unsubscribed"));

// --- Strict vs basic -------------------------------------------------------
const basicSent = run(model, { ...base, suppression: "basic" }).metrics.emailsSent;
const strictSent = run(model, { ...base, suppression: "strict" }).metrics.emailsSent;
check("strict suppression sends fewer emails than basic", strictSent < basicSent, `basic=${basicSent} strict=${strictSent}`);

// --- Approval gate ---------------------------------------------------------
const human = run(model, { ...base, approvalMode: "human" });
check("high-value carts are held under human approval", human.metrics.held > 0, `held=${human.metrics.held}`);
check("held carts are all high-value",
  human.records.filter((x) => x.status === "held_for_approval").every((x) => x.cart.cart_value >= HIGH_VALUE_THRESHOLD));
const autoHeld = run(model, { ...base, approvalMode: "auto" }).metrics.held;
check("auto mode holds nothing", autoHeld === 0);
// Approving a held cart lets it send.
const heldId = human.records.find((x) => x.status === "held_for_approval").cart.cart_id;
const afterApprove = run(model, { ...base, approvalMode: "human" }, new Set([heldId]));
check("approving a held cart reduces the queue", afterApprove.metrics.held === human.metrics.held - 1);

// --- Retry / failures ------------------------------------------------------
check("retry logic creates retry attempts after provider error",
  r.records.some((x) => x.cart.provider_error && x.retries > 0));
const fail0 = run(model, { ...base, maxRetries: 0 }).metrics.failures;
const fail3 = run(model, { ...base, maxRetries: 3 }).metrics.failures;
check("more retries reduces failures", fail3 < fail0, `retries0=${fail0} retries3=${fail3}`);

// --- Delay -----------------------------------------------------------------
const send30 = run(model, { ...base, delayMinutes: 30 }).records.find((x) => x.scheduledSendAt);
const send1440 = run(model, { ...base, delayMinutes: 1440 }).records.find((x) => x.scheduledSendAt);
check("delay setting changes scheduled send time", send30.scheduledSendAt !== send1440.scheduledSendAt);

// --- Recovery + revenue ----------------------------------------------------
check("recovered orders > 0", r.metrics.recoveredOrders > 0);
check("recovered revenue is calculated", r.metrics.recoveredRevenue > 0, `got ${r.metrics.recoveredRevenue}`);

// --- Email preview ---------------------------------------------------------
check("email preview built", !!r.email);
check("email preview includes cart/product facts",
  r.email.products.length > 0 && r.email.products[0].title && /Northstar/.test(r.email.subject));
check("email 'to' is a hashed token, not an email address",
  !r.email.to.includes("@") && /^cust_/.test(r.email.to));

// --- Error / retry panel + approval queue ----------------------------------
check("error/retry panel present", !!r.errorRetry && Array.isArray(r.errorRetry.schedule));
check("decision log has entries", r.decisionLog.length >= 3);
check("timeline goes checkout → decision/send → outcome", r.timeline.steps.length >= 3);

// --- No personal data ------------------------------------------------------
const blob = JSON.stringify(carts.slice(0, 60));
check("no real emails / personal data in cart events", !/@|\+?\d{9,}/.test(blob));

console.log("");
if (failures > 0) { console.error(`automation.test: ${failures} check(s) FAILED`); process.exit(1); }
console.log("automation.test: all checks passed");
