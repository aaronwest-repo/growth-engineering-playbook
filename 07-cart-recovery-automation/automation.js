// Cart-recovery automation engine.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/automation.test.mjs). No DOM, no network, no email sending.
//
// The shared cart-events file is the raw trigger population (abandoned carts).
// This module is the WORKFLOW: eligibility, suppression, wait/delay, send +
// retry with error handling, recovery, and human approval gates. Email sends
// and run logs are OUTPUTS computed here, not stored data.

export const HIGH_VALUE_THRESHOLD = 150;
export const MIN_VALUE = { basic: 20, strict: 40 };
const RETRY_BACKOFF_MIN = 30;

export function parseJsonl(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

// Minimal quote-aware CSV parser (catalog is used for availability + email copy).
export function parseCsv(text) {
  const rows = [];
  let field = "", record = [], q = false;
  const pf = () => { record.push(field); field = ""; };
  const pr = () => { rows.push(record); record = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") pf();
    else if (c === "\n") { pf(); pr(); }
    else if (c !== "\r") field += c;
  }
  if (field.length || record.length) { pf(); pr(); }
  const raw = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  const header = raw[0].map((h) => h.trim());
  return raw.slice(1).map((cells) => { const o = {}; header.forEach((h, i) => (o[h] = (cells[i] || "").trim())); return o; });
}

export function buildModel({ carts, products }) {
  const productsById = {};
  for (const p of products) productsById[p.product_id] = p;
  return { carts, productsById };
}

const ts = (s) => new Date(s).getTime();
const addMin = (iso, min) => new Date(ts(iso) + min * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
const round2 = (x) => Math.round(x * 100) / 100;
const isAvailable = (p) => p && p.availability === "in stock" && Number(p.stock) > 0;

/**
 * Run the recovery workflow over all carts.
 * options: { delayMinutes, maxRetries, approvalMode: 'auto'|'human', suppression: 'basic'|'strict' }
 * approvals: Set of cart_ids the operator approved in the queue.
 */
export function run(model, options, approvals = new Set()) {
  const { delayMinutes, maxRetries, approvalMode, suppression } = options;
  const minValue = MIN_VALUE[suppression] || MIN_VALUE.basic;
  const records = [];

  for (const cart of model.carts) {
    const decisions = [];
    const d = (rule, outcome, detail) => decisions.push({ rule, outcome, detail });
    let status, suppressedReason = null;

    d("Trigger", "enter", `Cart abandoned with ${cart.items} item(s), ${eur(cart.cart_value)}.`);

    // --- Suppression rules -------------------------------------------------
    const unavailable = cart.product_ids.filter((id) => !isAvailable(model.productsById[id]));
    if (cart.purchased_before_send) {
      status = "suppressed"; suppressedReason = "suppressed_because_purchased";
      d("Already purchased", "suppress", "Shopper completed the order before the send window.");
    } else if (cart.consent_status === "unsubscribed") {
      status = "suppressed"; suppressedReason = "suppressed_because_unsubscribed";
      d("Consent", "suppress", "Shopper is unsubscribed; no marketing send.");
    } else if (suppression === "strict" && cart.consent_status !== "subscribed") {
      status = "suppressed"; suppressedReason = "suppressed_no_explicit_consent";
      d("Consent (strict)", "suppress", "No explicit opt-in; strict mode does not send.");
    } else if (unavailable.length) {
      status = "suppressed"; suppressedReason = "suppressed_product_unavailable";
      d("Availability", "suppress", `Out of stock: ${unavailable.join(", ")}.`);
    } else if (cart.cart_value < minValue) {
      status = "suppressed"; suppressedReason = "suppressed_below_minimum";
      d("Minimum value", "suppress", `${eur(cart.cart_value)} below ${eur(minValue)} threshold.`);
    } else {
      d("Eligibility", "pass", "Passed suppression checks.");
    }

    const eligible = status !== "suppressed";
    let scheduledSendAt = null, attempts = 0, retries = 0, recovered = false, revenue = 0, alert = null;

    if (eligible) {
      const highValue = cart.cart_value >= HIGH_VALUE_THRESHOLD;
      const needsApproval = highValue && approvalMode === "human" && !approvals.has(cart.cart_id);
      if (highValue) d("High-value approval", needsApproval ? "hold" : "approve",
        `${eur(cart.cart_value)} ≥ ${eur(HIGH_VALUE_THRESHOLD)}. ${approvalMode === "human" ? (approvals.has(cart.cart_id) ? "Manually approved." : "Awaiting human approval.") : "Auto-send mode."}`);

      if (needsApproval) {
        status = "held_for_approval";
      } else {
        scheduledSendAt = addMin(cart.checkout_started_at, delayMinutes);
        d("Wait", "delay", `Hold ${humanDelay(delayMinutes)} after abandonment, send at ${shortTime(scheduledSendAt)}.`);
        // --- Send + retry ---------------------------------------------------
        const allowed = 1 + maxRetries;
        if (!cart.provider_error) {
          attempts = 1; status = "sent";
          d("Send", "sent", "Email accepted by provider on first attempt.");
        } else if (allowed >= cart.succeeds_on_attempt) {
          attempts = cart.succeeds_on_attempt; retries = cart.succeeds_on_attempt - 1; status = "sent";
          d("Provider error", "retry", `Transient error; succeeded on attempt ${attempts} after ${retries} retry(ies).`);
        } else {
          attempts = allowed; retries = maxRetries; status = "failed";
          alert = `Send failed for ${cart.cart_id} after ${attempts} attempt(s). Escalated to ops — the error notification is part of the workflow.`;
          d("Provider error", "fail", `Still failing after ${attempts} attempt(s); escalated, not silently dropped.`);
        }
        if (status === "sent" && cart.recovers_if_emailed) {
          recovered = true; revenue = cart.cart_value; status = "recovered";
          d("Recovery", "recovered", `Shopper returned and completed the order (${eur(revenue)}).`);
        }
      }
    }

    records.push({ cart, decisions, status, suppressedReason, scheduledSendAt, attempts, retries, recovered, revenue, alert });
  }

  return summarize(model, records, options);
}

function summarize(model, records, options) {
  const count = (fn) => records.filter(fn).length;
  const metrics = {
    cartsEntered: records.length,
    eligible: count((r) => r.status !== "suppressed"),
    suppressed: count((r) => r.status === "suppressed"),
    emailsSent: count((r) => r.status === "sent" || r.status === "recovered"),
    recoveredOrders: count((r) => r.recovered),
    recoveredRevenue: round2(records.reduce((s, r) => s + r.revenue, 0)),
    failures: count((r) => r.status === "failed"),
    retries: records.reduce((s, r) => s + r.retries, 0),
    held: count((r) => r.status === "held_for_approval"),
  };

  // Decision log: aggregate outcomes.
  const decisionLog = [
    ["Already purchased", records.filter((r) => r.suppressedReason === "suppressed_because_purchased").length, "Suppressed — order already completed"],
    ["Unsubscribed / no consent", records.filter((r) => r.suppressedReason === "suppressed_because_unsubscribed" || r.suppressedReason === "suppressed_no_explicit_consent").length, "Suppressed — consent rules"],
    ["Product unavailable", records.filter((r) => r.suppressedReason === "suppressed_product_unavailable").length, "Suppressed — out of stock"],
    ["Below minimum value", records.filter((r) => r.suppressedReason === "suppressed_below_minimum").length, "Suppressed — cart too small"],
    ["High-value approval", records.filter((r) => r.status === "held_for_approval").length, "Held for human approval"],
    ["Provider error + retry", records.filter((r) => r.retries > 0 && r.status !== "failed").length, "Recovered via retry after a transient error"],
    ["Sent", records.filter((r) => r.status === "sent" || r.status === "recovered").length, "Email sent"],
    ["Recovered", records.filter((r) => r.recovered).length, "Sale recovered"],
    ["Failed / escalated", metrics.failures, "Send failed after retries — alert raised"],
  ].filter(([, n]) => n > 0).map(([rule, n, detail]) => ({ rule, count: n, detail }));

  // Representative timeline (prefer recovered, then sent, then failed, then held).
  const pick = (s) => records.find((r) => r.status === s);
  const tl = pick("recovered") || pick("failed") || pick("sent") || pick("held_for_approval") || records[0];
  const timeline = buildTimeline(tl, options);

  // Email preview for a sent/recovered cart.
  const emailCart = (pick("recovered") || pick("sent") || records.find((r) => r.status !== "suppressed"));
  const email = emailCart ? buildEmail(emailCart.cart, model.productsById) : null;

  // Error & retry example.
  const errRec = records.find((r) => r.status === "failed") || records.find((r) => r.retries > 0);
  const errorRetry = errRec ? {
    cart_id: errRec.cart.cart_id, status: errRec.status, attempts: errRec.attempts, retries: errRec.retries,
    schedule: buildRetrySchedule(errRec, options),
    alert: errRec.alert || `Provider error on ${errRec.cart.cart_id}; recovered after ${errRec.retries} retry(ies).`,
  } : null;

  // Human approval queue.
  const approvalQueue = records.filter((r) => r.status === "held_for_approval")
    .map((r) => ({ cart_id: r.cart.cart_id, cart_value: r.cart.cart_value, items: r.cart.items }));

  // Business impact.
  const avoidedBadSends = records.filter((r) =>
    r.suppressedReason === "suppressed_because_purchased" ||
    r.suppressedReason === "suppressed_because_unsubscribed" ||
    r.suppressedReason === "suppressed_no_explicit_consent").length;
  const impact = {
    recoveredRevenue: metrics.recoveredRevenue,
    recoveredOrders: metrics.recoveredOrders,
    avoidedBadSends,
    failuresCaught: metrics.failures,
    suppressed: metrics.suppressed,
  };

  return { options, metrics, records, decisionLog, timeline, email, errorRetry, approvalQueue, impact };
}

function buildTimeline(r, options) {
  if (!r) return null;
  const c = r.cart;
  const steps = [];
  steps.push({ t: c.checkout_started_at, kind: "checkout_started", label: `Checkout started · ${eur(c.cart_value)}` });
  steps.push({ t: addMin(c.checkout_started_at, 25), kind: "cart_abandoned", label: "Cart abandoned (no purchase)" });
  r.decisions.filter((x) => x.outcome === "suppress" || x.outcome === "hold").forEach((x) =>
    steps.push({ t: addMin(c.checkout_started_at, 26), kind: "decision", label: `${x.rule}: ${x.detail}` }));
  if (r.scheduledSendAt) {
    steps.push({ t: r.scheduledSendAt, kind: "email_send_attempt", label: `Send attempt (${r.attempts} attempt${r.attempts === 1 ? "" : "s"})` });
    if (r.status === "sent" || r.status === "recovered") steps.push({ t: addMin(r.scheduledSendAt, 1), kind: "email_sent", label: "Email sent" });
    if (r.status === "failed") steps.push({ t: addMin(r.scheduledSendAt, r.retries * RETRY_BACKOFF_MIN + 1), kind: "failed", label: "Send failed → ops alert" });
    if (r.recovered) steps.push({ t: addMin(r.scheduledSendAt, 180), kind: "recovered", label: `Order recovered · ${eur(r.revenue)}` });
  }
  steps.sort((a, b) => ts(a.t) - ts(b.t));
  return { cart_id: c.cart_id, status: r.status, steps };
}

function buildRetrySchedule(r, options) {
  if (!r.scheduledSendAt) return [];
  const out = [];
  for (let a = 1; a <= r.attempts; a++) {
    const at = addMin(r.scheduledSendAt, (a - 1) * RETRY_BACKOFF_MIN);
    const ok = r.status !== "failed" && a === r.attempts;
    out.push({ attempt: a, at, result: ok ? "accepted" : "provider error" });
  }
  return out;
}

function buildEmail(cart, productsById) {
  const products = cart.product_ids.map((id) => {
    const p = productsById[id] || {};
    return { title: p.title_en || id, price: p.price ? `${p.price} ${p.currency || "EUR"}` : "" };
  });
  const top = products[0] ? products[0].title : "your items";
  return {
    subject: `You left ${cart.items} item${cart.items === 1 ? "" : "s"} at Northstar Outfitters`,
    preheader: `Still deciding? Your ${top} is waiting — complete your order.`,
    products,
    cartValue: `${cart.cart_value} ${cart.currency}`,
    cta: "Complete your order",
    to: cart.customer_ref, // hashed token, never a real email
  };
}

// --- formatting ------------------------------------------------------------
function eur(x) { return "€" + Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function humanDelay(min) { return min >= 1440 ? `${min / 1440} day` : min >= 60 ? `${min / 60} hours` : `${min} min`; }
function shortTime(iso) { return String(iso).replace("T", " ").replace("Z", "").slice(5, 16); }
