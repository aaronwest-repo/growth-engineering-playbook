// LTV / CAC / payback core. Dependency-free ES module, imported by the browser
// UI (app.js) and the Node smoke test (tests/ltv.test.mjs). No DOM, no network,
// no PII — it reads the shared order + customer data and a documented CAC table.
//
// The number most growth teams quote wrong is LTV. Revenue-based "LTV" flatters
// every channel because it ignores discounts, returns, and cost of goods; the
// only figure you can safely compare to acquisition cost is lifetime CONTRIBUTION
// margin. This computes realised per-customer contribution from the real orders,
// groups customers by how they were acquired, and puts it next to CAC to get the
// LTV:CAC ratio and the payback period — flagging the segments acquired at a loss
// or with a payback so slow it's a cash-flow problem. Deterministic.

export function parseCsv(text) {
  const lines = String(text || "").trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = (cells[i] ?? "").trim(); });
    return row;
  });
}

const round = (n, p = 2) => { const f = 10 ** p; return Math.round(n * f) / f; };
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375;

// Per-order contribution margin: net revenue + shipping collected − variable costs.
export function orderContribution(o) {
  const gross = +o.gross_revenue || 0;
  const discount = +o.discount || 0;
  const shipRev = +o.shipping_revenue || 0;
  const productCost = +o.product_cost || 0;
  const shipCost = +o.shipping_cost || 0;
  const returned = +o.returned_amount || 0;
  return gross - discount + shipRev - productCost - shipCost - returned;
}

export function orderNetRevenue(o) {
  return (+o.gross_revenue || 0) - (+o.discount || 0) + (+o.shipping_revenue || 0) - (+o.returned_amount || 0);
}

// Build one record per customer from their orders, keyed off acquisition.
export function buildCustomers({ orders, customers }, options = {}) {
  const asOf = options.asOf
    ? new Date(options.asOf).getTime()
    : Math.max(...orders.map((o) => new Date(o.order_date).getTime()));

  const profile = {};
  (customers || []).forEach((c) => { profile[c.customer_id] = c; });

  const byCustomer = {};
  for (const o of orders) {
    const id = o.customer_id;
    (byCustomer[id] || (byCustomer[id] = [])).push(o);
  }

  return Object.entries(byCustomer).map(([id, os]) => {
    os.sort((a, b) => new Date(a.order_date) - new Date(b.order_date));
    const first = os[0], last = os[os.length - 1];
    const acqDate = new Date(first.order_date).getTime();
    const tenureMonths = Math.max((asOf - acqDate) / MS_PER_MONTH, 0.5);
    const contribution = os.reduce((s, o) => s + orderContribution(o), 0);
    const revenue = os.reduce((s, o) => s + orderNetRevenue(o), 0);
    const p = profile[id] || {};
    return {
      customerId: id,
      acqChannel: first.channel || "unknown",
      acqDate: first.order_date,
      lastOrderDate: last.order_date,
      tenureMonths: round(tenureMonths, 2),
      orders: os.length,
      revenue: round(revenue),
      contribution: round(contribution),
      monthlyContribution: round(contribution / tenureMonths),
      aov: round(revenue / os.length),
      repeat: os.length > 1,
      tier: p.loyalty_tier || "none",
      country: p.country || "??",
    };
  });
}

const GROUPERS = {
  channel: (c) => c.acqChannel,
  tier: (c) => c.tier,
  country: (c) => c.country,
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Aggregate customers into segments and attach CAC, LTV:CAC and payback.
export function analyzeSegments(customers, cac, options = {}) {
  const groupBy = options.groupBy || "channel";
  const basis = options.basis || "contribution"; // contribution | revenue
  const grouper = GROUPERS[groupBy] || GROUPERS.channel;
  const cacFor = (key) => (groupBy === "channel" ? (cac[key] ?? 0) : blendedCac(customers, cac, grouper, key));

  const groups = {};
  for (const c of customers) (groups[grouper(c)] || (groups[grouper(c)] = [])).push(c);

  return Object.entries(groups).map(([key, cs]) => {
    const ltvs = cs.map((c) => (basis === "revenue" ? c.revenue : c.contribution));
    const avgLtv = mean(ltvs);
    const avgMonthly = mean(cs.map((c) => (basis === "revenue" ? c.revenue : c.contribution) / c.tenureMonths));
    const cacVal = cacFor(key);
    const ltvCac = cacVal ? avgLtv / cacVal : Infinity;
    const paybackMonths = avgMonthly > 0 ? cacVal / avgMonthly : Infinity;
    const repeatRate = cs.filter((c) => c.repeat).length / cs.length;

    let verdict;
    if (ltvCac < 1) verdict = "loss";
    else if (ltvCac < 3) verdict = "marginal";
    else if (paybackMonths > 24) verdict = "slow";
    else verdict = "healthy";

    return {
      key, label: options.labels?.[key] || key,
      customers: cs.length,
      avgLtv: round(avgLtv), medianLtv: round(median(ltvs)),
      avgOrders: round(mean(cs.map((c) => c.orders)), 2),
      avgAov: round(mean(cs.map((c) => c.aov))),
      repeatRate: round(repeatRate, 3),
      avgMonthlyContribution: round(avgMonthly),
      cac: round(cacVal), ltvCac: ltvCac === Infinity ? Infinity : round(ltvCac, 2),
      paybackMonths: paybackMonths === Infinity ? Infinity : round(paybackMonths, 1),
      totalLtv: round(avgLtv * cs.length), totalCac: round(cacVal * cs.length),
      netProfit: round((avgLtv - cacVal) * cs.length),
      verdict,
    };
  });
}

function median(xs) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// For non-channel groupings, blend CAC by the channel mix of the segment.
function blendedCac(customers, cac, grouper, key) {
  const cs = customers.filter((c) => grouper(c) === key);
  return mean(cs.map((c) => cac[c.acqChannel] ?? 0));
}

export const SORTS = {
  ltvCac: (a, b) => b.ltvCac - a.ltvCac,
  payback: (a, b) => a.paybackMonths - b.paybackMonths,
  customers: (a, b) => b.customers - a.customers,
  netProfit: (a, b) => b.netProfit - a.netProfit,
};

export const VERDICTS = {
  healthy: { label: "Healthy", cls: "good" },
  marginal: { label: "Marginal", cls: "warn" },
  slow: { label: "Slow payback", cls: "warn" },
  loss: { label: "Acquired at a loss", cls: "bad" },
};

// A simple payback curve for one segment: cumulative contribution per customer at
// the segment's average monthly rate, vs the CAC line. Honest about being an
// average-rate projection (real cohort triangles are case #28's job).
export function paybackCurve(segment, months = 18) {
  const rate = segment.avgMonthlyContribution;
  const pts = [];
  for (let m = 0; m <= months; m++) pts.push({ month: m, cumulative: round(rate * m) });
  return { points: pts, cac: segment.cac, crossMonth: segment.paybackMonths };
}

export function buildReport({ orders, customers }, cac, options = {}) {
  const custRecords = buildCustomers({ orders, customers }, options);
  const segments = analyzeSegments(custRecords, cac, options);
  const sortKey = options.sort || "ltvCac";
  const sorted = segments.slice().sort(SORTS[sortKey] || SORTS.ltvCac);

  const basis = options.basis || "contribution";
  const totalLtv = segments.reduce((s, g) => s + g.totalLtv, 0);
  const totalCac = segments.reduce((s, g) => s + g.totalCac, 0);
  const totalCustomers = custRecords.length;

  const blendedLtv = totalCustomers ? totalLtv / totalCustomers : 0;
  const blendedCacVal = totalCustomers ? totalCac / totalCustomers : 0;
  const lossMakers = segments.filter((g) => g.verdict === "loss");
  const slow = segments.filter((g) => g.verdict === "slow" || g.verdict === "marginal");

  const metrics = {
    customers: totalCustomers,
    basis,
    blendedLtv: round(blendedLtv),
    blendedCac: round(blendedCacVal),
    blendedLtvCac: blendedCacVal ? round(blendedLtv / blendedCacVal, 2) : Infinity,
    netProfit: round(totalLtv - totalCac),
    repeatRate: round(custRecords.filter((c) => c.repeat).length / (totalCustomers || 1), 3),
    lossSegments: lossMakers.length,
    atRiskSegments: slow.length,
    unprofitableSpend: round(lossMakers.reduce((s, g) => s + Math.max(g.totalCac - g.totalLtv, 0), 0)),
  };

  return { customers: custRecords, segments, sorted, metrics, groupBy: options.groupBy || "channel", basis };
}
