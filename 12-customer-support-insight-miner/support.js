// Customer Support Insight Miner core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/support.test.mjs). No DOM, no network, no PII — customers
// are synthetic tokens, product/ticket text is invented.
//
// Support tickets are not a queue to burn down — they are customer-intelligence
// data. This turns a ticket corpus into operational decisions: theme clusters,
// sentiment/urgency, product/category friction, content gaps, support-risk
// customers, automation candidates, and an owner-routed action queue. The expert
// move is turning recurring tickets into fixes and automations, not counting
// ticket volume. Deterministic keyword/theme rules — not a production NLP model.

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

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const dayNum = (d) => Math.floor(new Date(d).getTime() / 86400000);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// Human labels + a commercial "why it matters" line per theme.
export const THEME_META = {
  delivery:        { label: "Delivery status", why: "High-volume, low-complexity 'where is my order' contacts — the clearest automation win." },
  returns:         { label: "Return request", why: "Returns are margin leakage. Clusters point to fit/quality problems worth fixing upstream." },
  sizing:          { label: "Size advice", why: "Repeated size questions signal a product-page gap and predict avoidable returns." },
  compatibility:   { label: "Compatibility", why: "Pre-sales uncertainty — better spec content converts and deflects contacts." },
  warranty:        { label: "Warranty", why: "A warranty cluster on one family flags a possible quality or claims-clarity issue." },
  payment:         { label: "Payment failure", why: "Checkout friction is lost revenue at the last step — high urgency." },
  sustainability:  { label: "Sustainability claim", why: "Customers questioning recycled claims need clearer, defensible content." },
  damaged:         { label: "Damaged item", why: "Damage-on-arrival points at packaging or carrier handling — a logistics fix." },
  missing_package: { label: "Missing package", why: "Lost parcels are costly and erode trust — carrier/audit issue." },
  product_care:    { label: "Product care", why: "Care questions are a content gap; good guides extend product life and reduce returns." },
  exchange:        { label: "Exchange request", why: "Exchanges are recoverable revenue if made frictionless — usually a fit issue." },
  promo:           { label: "Promo confusion", why: "Unclear promo terms create disputes and eat margin through goodwill credits." },
};

const OWNERS = {
  ecommerce: "Ecommerce manager", merchandising: "Merchandising", logistics: "Logistics",
  service: "Customer service", content: "Content/SEO", automation: "Automation",
};

// Themes that are genuine automation candidates, with the opportunity name.
const AUTOMATION = {
  delivery: { name: "Delivery-status auto-reply", owner: OWNERS.automation, detail: "Deflect 'where is my order' with a tracking bot / order-status auto-reply." },
  returns:  { name: "Self-serve return-status workflow", owner: OWNERS.automation, detail: "Let customers start and track returns without an agent." },
  sizing:   { name: "Size-guide recommender on product pages", owner: OWNERS.content, detail: "Interactive fit finder on PDPs to pre-empt size questions." },
  warranty: { name: "Warranty evidence-request automation", owner: OWNERS.service, detail: "Auto-request photos/proof so agents only handle assessment." },
};

// Themes that indicate a content gap, with the recommended fix + owner.
const CONTENT_GAPS = {
  sizing:         { rec: "Add clear size guidance and fit notes to product pages", owner: OWNERS.content },
  sustainability: { rec: "Clarify recycled-material claims and certification on product pages", owner: OWNERS.content },
  product_care:   { rec: "Publish a product-care / washing guide", owner: OWNERS.content },
  returns:        { rec: "Make returns policy and fit expectations clearer pre-purchase", owner: OWNERS.content },
  promo:          { rec: "Explain promo eligibility and terms at checkout", owner: OWNERS.content },
  warranty:       { rec: "Surface warranty terms on product pages", owner: OWNERS.merchandising },
};

const RETURN_THEMES = new Set(["returns", "exchange"]);
const GAP_MIN = 4;        // a theme is a content gap only if it recurs this often
const OPEN = new Set(["open", "pending"]);

function mix(items, field, keys) {
  const m = Object.fromEntries(keys.map((k) => [k, 0]));
  items.forEach((t) => { if (t[field] in m) m[t[field]]++; });
  return m;
}

export function buildInsights({ tickets, customers = [], orders = [], products = [] }) {
  const prodById = Object.fromEntries(products.map((p) => [p.product_id, p]));
  const refDay = tickets.length ? Math.max(...tickets.map((t) => dayNum(t.created_at))) : 0;

  // Returns per customer (from orders) — feeds support-risk scoring.
  const returnsByCustomer = {};
  orders.forEach((o) => { if (num(o.returned_amount) > 0) returnsByCustomer[o.customer_id] = (returnsByCustomer[o.customer_id] || 0) + 1; });

  const nameByCustomer = Object.fromEntries(customers.map((c) => [c.customer_id, c.first_name]));

  // --- Theme clusters ------------------------------------------------------
  const themeKeys = [...new Set(tickets.map((t) => t.theme))];
  const themes = themeKeys.map((theme) => {
    const items = tickets.filter((t) => t.theme === theme);
    const sentiment = mix(items, "sentiment", ["positive", "neutral", "negative"]);
    const urgency = mix(items, "urgency", ["low", "medium", "high"]);
    return {
      theme, label: (THEME_META[theme] || {}).label || theme, why: (THEME_META[theme] || {}).why || "",
      count: items.length, sentiment, urgency,
      negShare: pct(sentiment.negative, items.length),
      highShare: pct(urgency.high, items.length),
      openCount: items.filter((t) => OPEN.has(t.status)).length,
    };
  }).sort((a, b) => b.count - a.count);

  // --- Product/category heatmap -------------------------------------------
  const catKeys = [...new Set(tickets.map((t) => t.category).filter(Boolean))];
  const categories = catKeys.map((category) => {
    const items = tickets.filter((t) => t.category === category);
    const neg = items.filter((t) => t.sentiment === "negative").length;
    const byTheme = {};
    items.forEach((t) => (byTheme[t.theme] = (byTheme[t.theme] || 0) + 1));
    const topTheme = Object.entries(byTheme).sort((a, b) => b[1] - a[1])[0];
    return {
      category, count: items.length, negShare: pct(neg, items.length),
      returnCount: items.filter((t) => RETURN_THEMES.has(t.theme)).length,
      sizingCount: items.filter((t) => t.theme === "sizing").length,
      warrantyCount: items.filter((t) => t.theme === "warranty").length,
      careCount: items.filter((t) => t.theme === "product_care").length,
      topTheme: topTheme ? (THEME_META[topTheme[0]] || {}).label || topTheme[0] : "—",
    };
  }).sort((a, b) => b.count - a.count);

  // Top individual products by ticket volume.
  const prodCounts = {};
  tickets.forEach((t) => { if (t.product_id) prodCounts[t.product_id] = (prodCounts[t.product_id] || 0) + 1; });
  const topProducts = Object.entries(prodCounts).map(([id, count]) => ({
    product_id: id, title: (prodById[id] || {}).title_en || id,
    category: (prodById[id] || {}).category || "—", count,
  })).sort((a, b) => b.count - a.count).slice(0, 8);

  // --- Customer-risk panel -------------------------------------------------
  const byCustomer = {};
  tickets.forEach((t) => { if (t.customer_id) (byCustomer[t.customer_id] ||= []).push(t); });
  const riskCustomers = Object.entries(byCustomer).map(([cid, its]) => {
    const neg = its.filter((t) => t.sentiment === "negative").length;
    const recentNeg = its.some((t) => t.sentiment === "negative" && OPEN.has(t.status) && refDay - dayNum(t.created_at) <= 120);
    const returns = returnsByCustomer[cid] || 0;
    const score = its.length * 2 + neg + returns * 2 + (recentNeg ? 2 : 0);
    let rec;
    if (recentNeg || neg >= 2) rec = "Service-first outreach before any marketing; resolve open issues.";
    else if (returns >= 1) rec = "Fit/returns follow-up; suppress promo until resolved.";
    else rec = "Monitor — proactive check-in if another ticket lands.";
    return { customer_id: cid, first_name: nameByCustomer[cid] || "—", tickets: its.length, negatives: neg, returns, recentNeg, score, recommendation: rec };
  }).filter((c) => c.tickets >= 2 || c.negatives >= 1 || c.returns >= 1)
    .sort((a, b) => b.score - a.score);
  const multiTicketCustomers = Object.values(byCustomer).filter((its) => its.length >= 2).length;

  // --- Content gaps --------------------------------------------------------
  const contentGaps = Object.entries(CONTENT_GAPS)
    .map(([theme, g]) => {
      const t = themes.find((x) => x.theme === theme);
      return t && t.count >= GAP_MIN ? { theme, label: t.label, count: t.count, negShare: t.negShare, rec: g.rec, owner: g.owner } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);

  // --- Automation opportunities -------------------------------------------
  const automations = Object.entries(AUTOMATION)
    .map(([theme, a]) => {
      const t = themes.find((x) => x.theme === theme);
      return t && t.count > 0 ? { theme, name: a.name, owner: a.owner, detail: a.detail, count: t.count } : null;
    })
    .filter(Boolean);
  const escalationCount = tickets.filter((t) => t.urgency === "high" && t.sentiment === "negative").length;
  if (escalationCount > 0) automations.push({
    theme: "escalation", name: "Escalation rule: high-urgency + negative", owner: OWNERS.service,
    detail: "Auto-flag and route high-urgency negative tickets to a senior agent within SLA.", count: escalationCount,
  });
  automations.sort((a, b) => b.count - a.count);
  const automationCandidates = automations.reduce((s, a) => s + a.count, 0);

  // --- Metrics -------------------------------------------------------------
  const negativeTickets = tickets.filter((t) => t.sentiment === "negative").length;
  const affectedCustomers = new Set(tickets.map((t) => t.customer_id).filter(Boolean)).size;
  const topCategory = categories[0];
  const metrics = {
    totalTickets: tickets.length,
    openTickets: tickets.filter((t) => OPEN.has(t.status)).length,
    negativeTickets,
    highUrgency: tickets.filter((t) => t.urgency === "high").length,
    affectedCustomers,
    topCategoryIssue: topCategory ? `${topCategory.category} (${topCategory.count})` : "—",
    automationCandidates,
    contentGaps: contentGaps.length,
  };

  // --- Action queue (owner-routed, prioritised) ---------------------------
  const actions = [];
  const push = (owner, title, rec, signal, priority) => actions.push({ owner, title, recommendation: rec, signal, priority });
  const topReturnCat = categories.filter((c) => c.returnCount > 0).sort((a, b) => b.returnCount - a.returnCount)[0];
  if (topReturnCat && topReturnCat.returnCount >= 3)
    push(OWNERS.merchandising, `Return friction on ${topReturnCat.category}`, `Investigate fit/quality on ${topReturnCat.category}; ${topReturnCat.returnCount} return/exchange tickets concentrate here.`, topReturnCat.returnCount, "high");
  const sizingTheme = themes.find((t) => t.theme === "sizing");
  if (sizingTheme && sizingTheme.count >= GAP_MIN)
    push(OWNERS.content, "Add size guidance to product pages", `${sizingTheme.count} size-advice tickets — a fit finder / size chart will deflect contacts and cut returns.`, sizingTheme.count, "high");
  const deliveryTheme = themes.find((t) => t.theme === "delivery");
  if (deliveryTheme && deliveryTheme.count >= GAP_MIN)
    push(OWNERS.automation, "Ship delivery-status auto-reply", `${deliveryTheme.count} delivery-status contacts are automatable — biggest volume deflection.`, deliveryTheme.count, "high");
  const warrantyTheme = themes.find((t) => t.theme === "warranty");
  if (warrantyTheme && warrantyTheme.count >= 3)
    push(OWNERS.merchandising, "Investigate warranty cluster", `${warrantyTheme.count} warranty tickets — check the bottle family for a quality or claims-clarity issue.`, warrantyTheme.count, "medium");
  const logisticsCount = tickets.filter((t) => t.theme === "damaged" || t.theme === "missing_package").length;
  if (logisticsCount >= 3)
    push(OWNERS.logistics, "Audit packaging & carrier handling", `${logisticsCount} damaged / missing-package tickets — audit packaging and carrier performance.`, logisticsCount, "medium");
  const sustTheme = themes.find((t) => t.theme === "sustainability");
  if (sustTheme && sustTheme.count >= GAP_MIN)
    push(OWNERS.content, "Clarify recycled-material claims", `${sustTheme.count} sustainability-claim questions — publish defensible, specific claims.`, sustTheme.count, "low");
  if (escalationCount > 0)
    push(OWNERS.service, "Escalation SLA for urgent negatives", `${escalationCount} high-urgency negative tickets need a defined escalation path.`, escalationCount, "high");
  if (riskCustomers.length > 0)
    push(OWNERS.ecommerce, "Lifecycle follow-up for support-risk customers", `${riskCustomers.length} repeat-contact / returning customers need service-first lifecycle handling, not promos.`, riskCustomers.length, "medium");
  const prioRank = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => prioRank[a.priority] - prioRank[b.priority] || b.signal - a.signal);

  return { refDay, tickets, metrics, themes, categories, topProducts, riskCustomers, multiTicketCustomers, contentGaps, automations, actions, prodById };
}

// Example ticket snippets + commercial framing for a selected theme/category/customer.
export function insightDetail(model, selection) {
  if (!selection) return null;
  const { kind, key } = selection;
  let items = [], title = "", why = "";
  if (kind === "theme") {
    items = model.tickets.filter((t) => t.theme === key);
    const meta = THEME_META[key] || {};
    title = meta.label || key; why = meta.why || "";
  } else if (kind === "category") {
    items = model.tickets.filter((t) => t.category === key);
    title = key; why = "Ticket friction concentrated on this category — a fix here has the widest effect.";
  } else if (kind === "customer") {
    items = model.tickets.filter((t) => t.customer_id === key);
    const rc = model.riskCustomers.find((c) => c.customer_id === key);
    title = `${rc ? rc.first_name + " · " : ""}${key}`;
    why = rc ? rc.recommendation : "Contact history for this customer.";
  }
  const affected = new Set(items.map((t) => t.customer_id).filter(Boolean)).size;
  const negatives = items.filter((t) => t.sentiment === "negative").length;
  const examples = items.slice(0, 5).map((t) => ({
    ticket_id: t.ticket_id, subject: t.subject, message: t.message,
    sentiment: t.sentiment, urgency: t.urgency, status: t.status,
    product: (model.prodById[t.product_id] || {}).title_en || t.product_id, category: t.category,
  }));
  return { kind, key, title, why, count: items.length, affected, negatives, negShare: pct(negatives, items.length), examples };
}
