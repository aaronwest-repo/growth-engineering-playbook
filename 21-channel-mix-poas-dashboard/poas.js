// Channel-mix POAS (profit-on-ad-spend) dashboard core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/poas.test.mjs). No DOM, no network, no PII.
//
// ROAS is the metric that lies. A channel can look healthy on revenue-per-spend
// and still lose money once cost of goods is taken out — and blended numbers hide
// which channels those are. This reworks the campaign data around POAS (gross
// margin / spend) and net contribution, flags channels that clear ROAS but fail on
// profit, and adds an incrementality lens so owned/branded channels stop taking
// credit for demand that would have converted anyway. Decision-quality measurement,
// not channel reporting. Deterministic; nothing is sent anywhere.

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
const div = (a, b) => (b > 0 ? a / b : 0);

// Incrementality factors: how much of a channel's credited revenue is genuinely
// caused by the spend vs demand that would have converted anyway. Owned/branded
// channels are heavily over-credited by last-click; prospecting is fully
// incremental. Documented assumptions, not measurements.
export const INCREMENTALITY = {
  newsletter: 0.45, affiliate: 0.75, google: 0.85, bing: 0.85, facebook: 1.0, instagram: 1.0,
};
const incFactor = (c) => INCREMENTALITY[c] ?? 0.9;

export const RANK_FIELDS = { roas: "ROAS", poas: "POAS", contribution: "Net contribution", incContribution: "Incremental contribution" };

export function buildDashboard({ campaigns }, opts = {}) {
  const rankBy = RANK_FIELDS[opts.rankBy] ? opts.rankBy : "poas";
  const incremental = !!opts.incremental;

  // Aggregate campaigns by source (channel).
  const by = {};
  for (const r of campaigns) {
    const ch = r.source || "unknown";
    const a = (by[ch] ||= { channel: ch, spend: 0, revenue: 0, margin: 0, orders: 0, newCustomers: 0, clicks: 0, sessions: 0, campaigns: 0 });
    a.spend += num(r.spend); a.revenue += num(r.revenue); a.margin += num(r.gross_margin);
    a.orders += num(r.orders); a.newCustomers += num(r.new_customers);
    a.clicks += num(r.clicks); a.sessions += num(r.sessions); a.campaigns += 1;
  }

  const rows = Object.values(by).map((a) => {
    const f = incFactor(a.channel);
    const roas = round(div(a.revenue, a.spend));
    const poas = round(div(a.margin, a.spend));
    const contribution = round(a.margin - a.spend);
    const incMargin = a.margin * f;
    const incContribution = round(incMargin - a.spend);
    const incPoas = round(div(incMargin, a.spend));
    return {
      channel: a.channel,
      spend: round(a.spend), revenue: round(a.revenue), margin: round(a.margin),
      orders: a.orders, newCustomers: a.newCustomers,
      roas, poas, contribution,
      cpa: round(div(a.spend, a.orders)), cac: round(div(a.spend, a.newCustomers)),
      aov: round(div(a.revenue, a.orders)),
      marginRate: round(div(a.margin, a.revenue)),
      incFactor: f, incPoas, incContribution,
      profitable: contribution > 0,
      incProfitable: incContribution > 0,
    };
  });

  // Blended (what a top-line dashboard shows).
  const T = rows.reduce((t, r) => { t.spend += r.spend; t.revenue += r.revenue; t.margin += r.margin; t.orders += r.orders; return t; },
    { spend: 0, revenue: 0, margin: 0, orders: 0 });
  const marginRate = round(div(T.margin, T.revenue));
  const breakevenRoas = round(div(1, marginRate)); // ROAS a channel needs to break even on profit
  const blended = {
    spend: round(T.spend), revenue: round(T.revenue), margin: round(T.margin),
    roas: round(div(T.revenue, T.spend)), poas: round(div(T.margin, T.spend)),
    contribution: round(T.margin - T.spend), marginRate, breakevenRoas,
  };

  const key = incremental && rankBy === "contribution" ? "incContribution" : rankBy;
  const ranked = rows.slice().sort((a, b) => b[key] - a[key]);

  const unprofitable = rows.filter((r) => (incremental ? !r.incProfitable : !r.profitable));
  // Channels that clear a healthy-looking ROAS but lose money on profit.
  const roasTraps = rows.filter((r) => r.roas >= 1.5 && r.poas < 1).sort((a, b) => a.poas - b.poas);

  const metrics = {
    spend: blended.spend,
    revenue: blended.revenue,
    blendedRoas: blended.roas,
    blendedPoas: blended.poas,
    contribution: blended.contribution,
    unprofitableChannels: unprofitable.length,
    bestChannel: ranked[0] ? ranked[0].channel : "—",
  };

  return { rows, ranked, blended, breakevenRoas, unprofitable, roasTraps, metrics, options: { rankBy, incremental } };
}
