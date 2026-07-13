// Marketing budget allocator core. Dependency-free ES module, imported by the
// browser UI (app.js) and the Node smoke test (tests/allocator.test.mjs). No DOM,
// no network, no PII.
//
// Budget allocation is the largest controllable growth decision, and it's almost
// always made wrong: split evenly, or poured into whichever channel has the best
// *average* ROAS. Both ignore diminishing returns. The channel with the best
// average return can still be the worst place for your NEXT euro if it's already
// saturated. The correct rule is marginal: keep moving budget to the channel with
// the highest marginal return until every active channel returns the same thing —
// water-filling against a single shadow price. This computes that optimum, grades
// it against the current plan, and finds the profit-maximising budget where the
// marginal euro stops paying for itself. Deterministic.

const round = (n, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f; };

// Diminishing-returns response: incremental revenue at spend s.
export function response(ch, s) {
  return ch.vmax * (1 - Math.exp(-s / ch.k));
}
// Gross profit and net contribution (profit after the spend itself).
export function grossProfit(ch, s) { return ch.margin * response(ch, s); }
export function netContribution(ch, s) { return grossProfit(ch, s) - s; }

// Marginal incremental revenue per euro at spend s (dResponse/ds).
export function marginalRevenue(ch, s) { return (ch.vmax / ch.k) * Math.exp(-s / ch.k); }
// Marginal ROAS = incremental revenue per euro; marginal profit = margin*that − 1.
export function marginalRoas(ch, s) { return marginalRevenue(ch, s); }
export function marginalProfit(ch, s) { return ch.margin * marginalRevenue(ch, s) - 1; }

// Spend that drives marginal profit down to a shadow price λ (0 if not worth it).
// margin*(vmax/k)*e^(−s/k) − 1 = λ  →  s = k * ln( margin*vmax / (k*(1+λ)) ).
function spendForLambda(ch, lambda, objective) {
  // Objective "revenue" ignores margin (optimise revenue per euro, not profit).
  const m = objective === "revenue" ? 1 : ch.margin;
  const ratio = (m * ch.vmax) / (ch.k * (1 + lambda));
  if (ratio <= 1) return 0;
  return ch.k * Math.log(ratio);
}

// Allocate a fixed total budget across channels by water-filling on λ.
export function allocateBudget(channels, budget, objective = "profit") {
  // λ high → little spend; λ low → lots. Bisect λ so total spend hits budget.
  let lo = -1 + 1e-9, hi = Math.max(...channels.map((c) => (objective === "revenue" ? c.vmax : c.margin * c.vmax) / c.k));
  const totalAt = (lambda) => channels.reduce((s, c) => s + spendForLambda(c, lambda, objective), 0);
  if (totalAt(lo) <= budget) {
    // Even at the profit floor the channels don't want the whole budget.
    return channels.map((c) => ({ id: c.id, spend: spendForLambda(c, -1 + 1e-9, objective) }));
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (totalAt(mid) > budget) lo = mid; else hi = mid;
  }
  const lambda = (lo + hi) / 2;
  return channels.map((c) => ({ id: c.id, spend: spendForLambda(c, lambda, objective), lambda }));
}

// Unconstrained profit-maximising spend per channel (λ = 0: marginal profit = 0).
export function profitMaxSpend(channels, objective = "profit") {
  return channels.map((c) => ({ id: c.id, spend: spendForLambda(c, 0, objective) }));
}

function evalPlan(channels, spendById, objective) {
  const byId = Object.fromEntries(channels.map((c) => [c.id, c]));
  let spend = 0, revenue = 0, gross = 0, contribution = 0;
  const rows = Object.entries(spendById).map(([id, s]) => {
    const c = byId[id];
    const rev = response(c, s), gp = grossProfit(c, s), nc = netContribution(c, s);
    spend += s; revenue += rev; gross += gp; contribution += nc;
    return { id, channel: c.channel, source: c.source, margin: c.margin, spend: s,
      revenue: rev, grossProfit: gp, contribution: nc,
      roas: s > 0 ? rev / s : 0, marginalRoas: marginalRoas(c, s), marginalProfit: marginalProfit(c, s) };
  });
  const objVal = objective === "revenue" ? revenue : contribution;
  return { rows, totals: { spend, revenue, gross, contribution, objVal } };
}

export const SORTS = {
  reallocation: (a, b) => Math.abs(b.deltaSpend) - Math.abs(a.deltaSpend),
  marginalRoas: (a, b) => b.optimal.marginalRoas - a.optimal.marginalRoas,
  contribution: (a, b) => b.optimal.contribution - a.optimal.contribution,
};

// Full report: current plan vs optimal allocation at the chosen budget/objective.
export function buildReport(channels, options = {}) {
  const objective = options.objective || "profit";
  const currentTotal = channels.reduce((s, c) => s + c.currentSpend, 0);

  let budget, mode;
  if (options.budgetMode === "max") {
    const pm = profitMaxSpend(channels, objective);
    budget = pm.reduce((s, x) => s + x.spend, 0);
    mode = "max";
  } else {
    const mult = options.budgetMultiplier || 1;
    budget = currentTotal * mult;
    mode = "fixed";
  }

  const current = evalPlan(channels, Object.fromEntries(channels.map((c) => [c.id, c.currentSpend])), objective);
  const optAlloc = mode === "max"
    ? profitMaxSpend(channels, objective)
    : allocateBudget(channels, budget, objective);
  const optimal = evalPlan(channels, Object.fromEntries(optAlloc.map((a) => [a.id, a.spend])), objective);

  const curById = Object.fromEntries(current.rows.map((r) => [r.id, r]));
  const merged = optimal.rows.map((o) => {
    const c = curById[o.id];
    return {
      id: o.id, channel: o.channel, source: o.source, margin: o.margin,
      current: c, optimal: o,
      deltaSpend: round(o.spend - c.spend),
      deltaContribution: round(o.contribution - c.contribution),
      action: o.spend > c.spend + 1 ? "increase" : o.spend < c.spend - 1 ? "cut" : "hold",
    };
  });
  const sortKey = options.sort || "reallocation";
  const sorted = merged.slice().sort(SORTS[sortKey] || SORTS.reallocation);

  const upliftAbs = optimal.totals.contribution - current.totals.contribution;
  const reallocated = merged.reduce((s, m) => s + Math.max(m.deltaSpend, 0), 0);

  const metrics = {
    budget: round(budget), currentBudget: round(currentTotal), mode, objective,
    currentContribution: round(current.totals.contribution),
    optimalContribution: round(optimal.totals.contribution),
    currentRevenue: round(current.totals.revenue),
    optimalRevenue: round(optimal.totals.revenue),
    upliftAbs: round(upliftAbs),
    upliftPct: current.totals.contribution ? upliftAbs / current.totals.contribution : 0,
    reallocated: round(reallocated),
    reallocatedPct: budget ? reallocated / budget : 0,
    increased: merged.filter((m) => m.action === "increase").length,
    cut: merged.filter((m) => m.action === "cut").length,
    optimalRoas: optimal.totals.spend ? round(optimal.totals.revenue / optimal.totals.spend, 2) : 0,
    currentRoas: current.totals.spend ? round(current.totals.revenue / current.totals.spend, 2) : 0,
  };

  return { channels: merged, sorted, current, optimal, metrics, budget, mode, objective };
}

// Sampled response curve for one channel, with current & optimal spend marked.
export function curve(ch, currentSpend, optimalSpend, points = 40) {
  const maxS = Math.max(currentSpend, optimalSpend, ch.k * 3) * 1.1;
  const pts = [];
  for (let i = 0; i <= points; i++) {
    const s = (i / points) * maxS;
    pts.push({ spend: round(s), contribution: round(netContribution(ch, s)) });
  }
  return { points: pts, maxS: round(maxS), currentSpend: round(currentSpend), optimalSpend: round(optimalSpend) };
}
