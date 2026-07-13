// Free-shipping threshold calculator core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/threshold.test.mjs). No DOM, no network, no PII — everything
// is derived from the order data.
//
// The free-shipping threshold is a CONTRIBUTION-MARGIN decision, not a marketing
// round number. A threshold moves three groups of orders, and a credible model
// needs all three:
//   1. Subsidy   — orders already above T now ship free (a give-back you eat).
//   2. Nudge     — orders within reach top up to T (incremental margin - shipping).
//   3. Conversion— free shipping lifts checkout completion on the qualifying band
//                  (the real reason thresholds exist), net of shipping + COGS.
// The tool finds the margin-aware threshold, the minimum conversion lift needed
// to break even, and contrasts the naive "revenue uplift" story with real net
// contribution. Both behavioural levers are explicit assumptions, shown with
// their sensitivity — the recommendation is only as good as those inputs.

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
const round = (n) => Math.round(n * 100) / 100;
const round0 = (n) => Math.round(n);

export const NUDGE_RATES = { low: 0.15, med: 0.30, high: 0.50 };
export const CONV_LIFTS = { off: 0, "4%": 0.04, "8%": 0.08, "12%": 0.12 };
export const WINDOWS = { "€15": 15, "€25": 25, "€40": 40 };
export const SHIPPING_COSTS = { "€5": 5, "€8": 8, "€12": 12 };
export const THRESHOLD_MIN = 100, THRESHOLD_MAX = 325, THRESHOLD_STEP = 25;

export function buildModel({ orders }) {
  const rows = orders.map((o) => ({
    value: num(o.gross_revenue),
    productCost: num(o.product_cost),
    discount: num(o.discount),
    shippingCost: num(o.shipping_cost),
  })).filter((r) => r.value > 0);

  const values = rows.map((r) => r.value).sort((a, b) => a - b);
  const n = values.length || 1;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const gross = sum(rows.map((r) => r.value));
  const contribution = sum(rows.map((r) => r.value - r.productCost - r.discount));
  const marginRate = gross > 0 ? round(contribution / gross) : 0;
  const avgShippingCost = round(sum(rows.map((r) => r.shippingCost)) / n);
  const aov = round(gross / n);
  const q = (p) => values[Math.min(values.length - 1, Math.max(0, Math.floor(p * (values.length - 1))))];

  const binSize = 50;
  const bins = {};
  values.forEach((v) => { const b = Math.floor(v / binSize) * binSize; bins[b] = (bins[b] || 0) + 1; });
  const histogram = Object.keys(bins).map(Number).sort((a, b) => a - b)
    .map((b) => ({ from: b, to: b + binSize, count: bins[b] }));

  const candidateThresholds = [];
  for (let t = THRESHOLD_MIN; t <= THRESHOLD_MAX; t += THRESHOLD_STEP) candidateThresholds.push(t);

  return {
    values, n, aov, marginRate, avgShippingCost, gross, contribution,
    median: round0(q(0.5)), p10: round0(q(0.1)), p90: round0(q(0.9)),
    min: round0(values[0]), max: round0(values[n - 1]),
    histogram, binSize, candidateThresholds, binMax: Math.max(...histogram.map((h) => h.count)),
  };
}

// Evaluate one policy scenario vs the baseline (customers pay their own shipping).
export function evaluate(model, opts = {}) {
  const threshold = opts.threshold ?? model.aov;
  const nudgeRate = NUDGE_RATES[opts.nudge] ?? NUDGE_RATES.med;
  const convLift = CONV_LIFTS[opts.conv] ?? CONV_LIFTS["8%"];
  const window = WINDOWS[opts.window] ?? WINDOWS["€25"];
  const shippingCost = SHIPPING_COSTS[opts.shipping] ?? Math.max(5, Math.round(model.avgShippingCost));
  const m = model.marginRate;

  let above = 0, reach = 0, far = 0;
  let subsidyCost = 0, nudgeGain = 0, addedValue = 0, perNudgerSum = 0;
  let qualMarginSum = 0, qualRevenueSum = 0, naiveNudgeRev = 0;

  for (const v of model.values) {
    if (v >= threshold) {
      above++;
      subsidyCost += shippingCost;                 // absorbing shipping on an order we'd have won
      qualMarginSum += v * m;
      qualRevenueSum += v;
    } else if (v >= threshold - window) {
      reach++;
      const incMargin = (threshold - v) * m;       // margin on the top-up items
      const per = incMargin - shippingCost;        // net per nudger (they now ship free too)
      perNudgerSum += per;
      nudgeGain += nudgeRate * per;
      addedValue += nudgeRate * (threshold - v);
      naiveNudgeRev += nudgeRate * (threshold - v);
    } else {
      far++;
    }
  }

  // Conversion lift: free shipping recovers abandoned checkouts on the qualifying
  // band. Each incremental order contributes its own margin minus the shipping.
  const qualContribNetShip = qualMarginSum - subsidyCost;  // Σ_{v≥T}(v·m − ship)
  const convOrders = convLift * above;
  const convGain = convLift * qualContribNetShip;

  const netDelta = nudgeGain + convGain - subsidyCost;

  // Naive (vanity) view: count nudged revenue + full revenue of conversion-driven
  // orders as "uplift", ignoring subsidy and COGS.
  const naiveUplift = naiveNudgeRev + convLift * qualRevenueSum;

  // Minimum conversion lift to break even, holding the other levers fixed.
  const breakEvenConv = qualContribNetShip > 0
    ? Math.max(0, (subsidyCost - nudgeGain) / qualContribNetShip)
    : Infinity;

  const perNudgerAvg = reach ? round(perNudgerSum / reach) : 0;
  const aovAfter = round((model.gross + addedValue) / model.n);
  const contributionBreakEvenBasket = m > 0 ? round(shippingCost / m) : Infinity;

  return {
    threshold, nudgeRate, convLift, window, shippingCost, marginRate: m,
    counts: { above, reach, far, total: model.n },
    pctQualify: round0((above / model.n) * 100),
    pctReach: round0((reach / model.n) * 100),
    expectedNudgers: round(reach * nudgeRate),
    convOrders: round(convOrders),
    subsidyCost: round(subsidyCost),
    nudgeGain: round(nudgeGain),
    convGain: round(convGain),
    netDelta: round(netDelta),
    naiveUplift: round(naiveUplift),
    perNudgerAvg,
    breakEvenConv,
    aovBefore: model.aov, aovAfter, aovLift: round(aovAfter - model.aov),
    contributionBreakEvenBasket,
  };
}

// Sweep every candidate threshold; recommend the one with the highest net delta.
export function sweep(model, opts = {}) {
  const rows = model.candidateThresholds.map((t) => {
    const r = evaluate(model, { ...opts, threshold: t });
    return {
      threshold: t, netDelta: r.netDelta, subsidyCost: r.subsidyCost,
      nudgeGain: r.nudgeGain, convGain: r.convGain, pctQualify: r.pctQualify,
    };
  });
  const best = rows.reduce((a, b) => (b.netDelta > a.netDelta ? b : a), rows[0]);
  return { rows, recommended: best.threshold, recommendedNet: best.netDelta };
}

// Advisory warnings for the selected scenario.
export function warningsFor(res) {
  const w = [];
  if (res.netDelta < 0)
    w.push({ type: "loss", text: `At €${res.threshold} this policy is net-negative (${res.netDelta} vs baseline): the shipping you subsidise outweighs the nudge + conversion gains.` });
  if (res.perNudgerAvg < 0)
    w.push({ type: "nudge", text: `Each nudged order averages ${res.perNudgerAvg} — the top-up margin doesn't cover the shipping you now absorb. Nudging customers who are only a few euros short loses money.` });
  if (!Number.isFinite(res.breakEvenConv))
    w.push({ type: "unwinnable", text: `Qualifying orders don't cover their own shipping, so no conversion lift can make this threshold pay.` });
  else if (res.breakEvenConv > 0.20)
    w.push({ type: "breakeven", text: `This threshold needs a ${Math.round(res.breakEvenConv * 100)}% conversion lift just to break even — an optimistic ask. It leans on demand response you'd have to prove.` });
  if (res.threshold < res.contributionBreakEvenBasket)
    w.push({ type: "margin", text: `€${res.threshold} is below the contribution break-even basket (€${res.contributionBreakEvenBasket}) — free shipping on orders whose own margin can't cover shipping.` });
  if (res.pctReach <= 3)
    w.push({ type: "reach", text: `Only ${res.pctReach}% of orders sit within reach of €${res.threshold}, so there's little basket to nudge — the case rests almost entirely on the conversion-lift assumption.` });
  return w;
}
