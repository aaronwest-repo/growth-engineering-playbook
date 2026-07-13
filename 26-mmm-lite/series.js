// Weekly marketing time series for the fictional Northstar Outfitters store.
// Invented, deterministic — no real spend, revenue, or PII.
//
// This is generated from a KNOWN data-generating process so the model can be
// graded against ground truth: each channel has a true carryover (adstock θ), a
// saturation scale, and a revenue coefficient; weekly sales are the organic base
// (level + trend + annual seasonality) plus each channel's adstocked, saturated
// contribution, plus a little deterministic noise. mmm.js never sees these true
// params — it re-estimates them from spend + sales alone. GROUND_TRUTH is exported
// only so the smoke test can check the fit actually recovers them.
//
// Spend patterns are deliberately different per channel (steady search, flighted
// social, ramping affiliate, spiky email) so the regression is well-conditioned.

const WEEKS = 104; // two years of weekly data

// Deterministic LCG so the series is identical on every load.
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (1103515245 * s + 12345) >>> 0; return s / 4294967296; };
}

// Geometric adstock: effect carries over and decays by θ each week.
function adstock(x, theta) {
  const out = new Array(x.length);
  let carry = 0;
  for (let t = 0; t < x.length; t++) { carry = x[t] + theta * carry; out[t] = carry; }
  return out;
}
const saturate = (x, k) => 1 - Math.exp(-x / k);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// True generating parameters (hidden from the model).
const SPEC = [
  { id: "paid_search", channel: "Paid search", source: "google / cpc", base: 5000, theta: 0.2, beta: 12000, seed: 101,
    pattern: (t, r) => 1 + 0.15 * Math.sin((2 * Math.PI * t) / 52) + 0.25 * (r() - 0.5) },
  { id: "paid_social", channel: "Paid social", source: "facebook / paid-social", base: 4000, theta: 0.6, beta: 9000, seed: 202,
    pattern: (t, r) => (t % 8 < 3 ? 1.6 : 0.6) + 0.2 * (r() - 0.5) }, // flighted bursts
  { id: "affiliate", channel: "Affiliate", source: "affiliate / referral", base: 6000, theta: 0.3, beta: 11000, seed: 303,
    pattern: (t, r) => 0.7 + 0.6 * (t / WEEKS) + 0.2 * (r() - 0.5) }, // gradual ramp
  { id: "newsletter", channel: "Newsletter", source: "email / owned", base: 1500, theta: 0.0, beta: 6000, seed: 404,
    pattern: (t, r) => (t % 4 === 0 ? 2.4 : 0.5) + 0.15 * (r() - 0.5) }, // spiky campaigns
];

// --- Generate spend series -------------------------------------------------
const channels = SPEC.map((c) => {
  const r = lcg(c.seed);
  const spend = [];
  for (let t = 0; t < WEEKS; t++) spend.push(Math.max(200, Math.round(c.base * c.pattern(t, r))));
  return { id: c.id, channel: c.channel, source: c.source, spend };
});

// --- Generate sales from the true DGP --------------------------------------
const noise = lcg(999);
const sales = new Array(WEEKS).fill(0);
const truthContribution = {};
const kByChannel = {};
SPEC.forEach((c, i) => {
  const k = 2 * mean(channels[i].spend); // saturation scale, data-driven
  kByChannel[c.id] = k;
  const contrib = adstock(channels[i].spend, c.theta).map((a) => c.beta * saturate(a, k));
  truthContribution[c.id] = contrib;
  for (let t = 0; t < WEEKS; t++) sales[t] += contrib[t];
});
const base = [];
for (let t = 0; t < WEEKS; t++) {
  const b = 20000 + 45 * t + 3500 * Math.sin((2 * Math.PI * t) / 52 + 1);
  base.push(b);
  sales[t] += b + (noise() - 0.5) * 900; // small deterministic noise
}

export const SERIES = {
  weeks: WEEKS,
  channels: channels.map((c) => ({ id: c.id, channel: c.channel, source: c.source, spend: c.spend.slice() })),
  sales: sales.map((v) => Math.round(v)),
};

// Exposed only for the smoke test to verify recovery.
export const GROUND_TRUTH = {
  theta: Object.fromEntries(SPEC.map((c) => [c.id, c.theta])),
  k: kByChannel,
  baseShare: base.reduce((s, v) => s + v, 0) / sales.reduce((s, v) => s + v, 0),
  roi: Object.fromEntries(SPEC.map((c, i) => [
    c.id,
    truthContribution[c.id].reduce((s, v) => s + v, 0) / channels[i].spend.reduce((s, v) => s + v, 0),
  ])),
};
