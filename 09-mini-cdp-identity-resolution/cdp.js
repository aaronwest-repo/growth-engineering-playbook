// Mini-CDP identity resolution core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/cdp.test.mjs). No DOM, no network, no PII — identifiers are
// synthetic tokens (email_hash) and fictional first names.
//
// This resolves messy customer/order/email/support records into unified profiles
// with confidence, merge decisions, consent boundaries, false-merge warnings, an
// audit trail, and segment-ready output. It is NOT "join rows by email": the point
// is *when you are confident enough to merge*, and what consent allows.

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
export function parseJsonl(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

const norm = (s) => String(s || "").trim().toLowerCase();
const bool = (v) => v === "true" || v === true;
const dayNum = (d) => Math.floor(new Date(d).getTime() / 86400000);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function buildModel({ customers, orders, emails, tickets, webEvents = [] }) {
  const ordersByCustomer = groupBy(orders, "customer_id");
  const emailsByCustomer = groupBy(emails.filter((e) => e.customer_id), "customer_id");
  const emailsByHash = groupBy(emails.filter((e) => e.email_hash), "email_hash");
  const ticketsByCustomer = groupBy(tickets.filter((t) => t.customer_id), "customer_id");
  const ticketsByHash = groupBy(tickets.filter((t) => t.email_hash), "email_hash");
  // Reference "today" = latest date in the data, so recency is deterministic.
  const allDates = [...orders.map((o) => o.order_date), ...customers.map((c) => c.created_at)];
  const refDay = Math.max(...allDates.map(dayNum));
  return { customers, orders, emails, tickets, webEvents, ordersByCustomer, emailsByCustomer, emailsByHash, ticketsByCustomer, ticketsByHash, refDay };
}

function groupBy(rows, key) {
  const m = {};
  for (const r of rows) (m[r[key]] = m[r[key]] || []).push(r);
  return m;
}

// --- Union-Find ------------------------------------------------------------
function makeUF(ids) {
  const parent = {}; ids.forEach((i) => (parent[i] = i));
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  return { find, union, parent };
}

const FUZZY_MIN = 0.6;

/** Score a fuzzy (non-email) match between two customer records. */
function fuzzyScore(a, b) {
  if (norm(a.first_name) !== norm(b.first_name) || a.country !== b.country) return 0;
  const gap = Math.abs(dayNum(a.created_at) - dayNum(b.created_at));
  if (gap > 14) return 0;
  let s = 0.6;
  if (a.language === b.language) s += 0.08;
  if (gap <= 3) s += 0.07;
  return Math.min(0.78, s);
}

const consentConflict = (a, b) =>
  bool(a.consent_personalization) !== bool(b.consent_personalization) ||
  bool(a.consent_marketing) !== bool(b.consent_marketing);

/**
 * Resolve identities.
 * options: { mode: 'strict'|'balanced'|'aggressive', respectConsent: boolean }
 */
export function resolve(model, options = {}) {
  const mode = ["strict", "balanced", "aggressive"].includes(options.mode) ? options.mode : "balanced";
  const respectConsent = options.respectConsent !== false;
  const recs = model.customers;
  const byId = Object.fromEntries(recs.map((r) => [r.customer_id, r]));
  const uf = makeUF(recs.map((r) => r.customer_id));
  const audit = [];
  let consentConflicts = 0, blocked = 0, review = 0;
  const reviewPairs = [], falseMergeRisks = [];

  // 1. Exact deterministic match: shared email_hash = same person. Always merge.
  const byHash = groupBy(recs.filter((r) => r.email_hash), "email_hash");
  for (const [hash, group] of Object.entries(byHash)) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) {
      const a = group[0], b = group[i];
      const conflict = consentConflict(a, b);
      if (conflict) consentConflicts++;
      uf.union(a.customer_id, b.customer_id);
      audit.push({
        rule: "exact-email-hash", evidence: `shared email_hash ${hash}`,
        confidence: 0.99, decision: "auto_merge",
        consentNote: conflict ? "consent/opt-in conflict — profile takes the most restrictive setting" : "consent consistent",
        records: [a.customer_id, b.customer_id],
      });
    }
  }

  // 2. Fuzzy candidates (different/again-no email_hash): name + country + recency.
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i], b = recs[j];
      if (a.email_hash && b.email_hash && a.email_hash === b.email_hash) continue; // already exact
      if (uf.find(a.customer_id) === uf.find(b.customer_id)) continue;
      const score = fuzzyScore(a, b);
      if (score < FUZZY_MIN) continue;

      const conflict = respectConsent && consentConflict(a, b);
      if (conflict) {
        blocked++;
        audit.push({ rule: "fuzzy-name-country", evidence: fuzzyEvidence(a, b, score), confidence: score,
          decision: "blocked", consentNote: "consent boundary differs — merge blocked", records: [a.customer_id, b.customer_id] });
        continue;
      }
      if (mode === "aggressive") {
        uf.union(a.customer_id, b.customer_id);
        audit.push({ rule: "fuzzy-name-country", evidence: fuzzyEvidence(a, b, score), confidence: score,
          decision: "auto_merge", consentNote: "aggressive mode merges on weak evidence", records: [a.customer_id, b.customer_id] });
        falseMergeRisks.push({ a: a.customer_id, b: b.customer_id, score, name: a.first_name, country: a.country, merged: true });
      } else if (mode === "balanced") {
        review++;
        reviewPairs.push([a.customer_id, b.customer_id]);
        audit.push({ rule: "fuzzy-name-country", evidence: fuzzyEvidence(a, b, score), confidence: score,
          decision: "review_required", consentNote: "held: same name+country is not proof of same person", records: [a.customer_id, b.customer_id] });
        falseMergeRisks.push({ a: a.customer_id, b: b.customer_id, score, name: a.first_name, country: a.country, merged: false });
      } else {
        // strict: ignore fuzzy entirely (kept as distinct)
        audit.push({ rule: "fuzzy-name-country", evidence: fuzzyEvidence(a, b, score), confidence: score,
          decision: "ignored_strict", consentNote: "strict mode only merges on a strong key", records: [a.customer_id, b.customer_id] });
      }
    }
  }

  // 3. Assemble profiles from clusters.
  const clusters = {};
  for (const r of recs) (clusters[uf.find(r.customer_id)] = clusters[uf.find(r.customer_id)] || []).push(r);
  const profiles = Object.values(clusters).map((members) => buildProfile(members, model));

  const metrics = {
    rawRecords: recs.length,
    candidateIdentities: Object.keys(byHash).length + recs.filter((r) => !r.email_hash).length,
    resolvedProfiles: profiles.length,
    autoMerged: profiles.filter((p) => p.recordIds.length > 1).length,
    needsReview: review,
    blockedMerges: blocked,
    consentConflicts,
  };

  return { options: { mode, respectConsent }, metrics, profiles, mergeQueue: audit, falseMergeRisks, reviewPairs };
}

function fuzzyEvidence(a, b, score) {
  return `same first name "${a.first_name}" + country ${a.country}, created ${Math.abs(dayNum(a.created_at) - dayNum(b.created_at))}d apart (score ${score.toFixed(2)})`;
}

function buildProfile(members, model) {
  const recordIds = members.map((m) => m.customer_id);
  const hashes = [...new Set(members.map((m) => m.email_hash).filter(Boolean))];
  const orders = members.flatMap((m) => model.ordersByCustomer[m.customer_id] || []);
  const emails = uniqBy([
    ...members.flatMap((m) => model.emailsByCustomer[m.customer_id] || []),
    ...hashes.flatMap((h) => model.emailsByHash[h] || []),
  ], "event_id");
  const tickets = uniqBy([
    ...members.flatMap((m) => model.ticketsByCustomer[m.customer_id] || []),
    ...hashes.flatMap((h) => model.ticketsByHash[h] || []),
  ], "ticket_id");
  // Web events: illustrative device-graph stitching (no real join key exists).
  const webEvents = deviceStitch(hashes, model.webEvents);

  // Consent resolved conservatively (most restrictive across merged records).
  const consent = {
    marketing: members.every((m) => bool(m.consent_marketing)),
    personalization: members.every((m) => bool(m.consent_personalization)),
    newsletter: members.every((m) => bool(m.newsletter_opt_in)),
    conflict: members.some((m) => bool(m.consent_marketing) !== bool(members[0].consent_marketing)) ||
              members.some((m) => bool(m.consent_personalization) !== bool(members[0].consent_personalization)) ||
              members.some((m) => bool(m.newsletter_opt_in) !== bool(members[0].newsletter_opt_in)),
  };
  const loyalty = ["gold", "silver", "none"].find((t) => members.some((m) => m.loyalty_tier === t)) || "none";
  const revenue = round2(orders.reduce((s, o) => s + num(o.gross_revenue) - num(o.returned_amount), 0));
  const lastOrderDay = orders.length ? Math.max(...orders.map((o) => dayNum(o.order_date))) : null;
  const createdDay = Math.min(...members.map((m) => dayNum(m.created_at)));

  const profile = {
    profile_id: "P-" + recordIds.slice().sort()[0],
    recordIds, email_hashes: hashes,
    first_name: members[0].first_name, country: members[0].country, language: members[0].language,
    loyalty, consent, revenue,
    orders, emails, tickets, webEvents,
    confidence: recordIds.length > 1 ? 0.99 : 1.0, // singletons are certain (no merge)
    merged: recordIds.length > 1,
  };
  profile.segments = segmentsFor(profile, model.refDay, lastOrderDay, createdDay);
  return profile;
}

function segmentsFor(p, refDay, lastOrderDay, createdDay) {
  const segs = [];
  if (p.revenue >= 600 || p.loyalty === "gold") segs.push("VIP");
  if (lastOrderDay !== null && refDay - lastOrderDay > 180) segs.push("churn risk");
  if (refDay - createdDay <= 60 && p.orders.length <= 1) segs.push("new customer");
  if (p.tickets.some((t) => t.status === "open" || t.sentiment === "negative")) segs.push("support risk");
  if (p.consent.newsletter && p.consent.marketing) segs.push("newsletter eligible");
  if (p.consent.personalization) segs.push("personalization allowed");
  return segs;
}

// Deterministic pseudo device-graph: pick a few web sessions per profile by hash.
function deviceStitch(hashes, webEvents) {
  if (!hashes.length || !webEvents.length) return [];
  const seed = hashes[0].split("").reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const count = seed % 4; // 0..3 stitched sessions
  const out = [];
  for (let k = 0; k < count; k++) out.push(webEvents[(seed + k * 2654435761) % webEvents.length]);
  return out;
}

const uniqBy = (arr, key) => { const seen = new Set(); return arr.filter((x) => (seen.has(x[key]) ? false : seen.add(x[key]))); };
const round2 = (x) => Math.round(x * 100) / 100;
