// Consent-mode / tracking-loss impact simulator core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/consent.test.mjs). No DOM, no network, no PII — it works from
// the shared conversion + web-event streams.
//
// Your analytics under-reports, and by a predictable amount. Consent declines,
// Safari/ITP cookie prevention, and ad-blockers each strip a slice of conversions
// before they're ever recorded — and the loss is NOT uniform across channels, so
// it quietly biases budget toward the trackable ones. This models the observed-vs-
// actual gap by channel, shows how much Google-style consent-mode modelling
// recovers, and decomposes the loss by cause. Deterministic expected-value maths —
// no RNG — so the numbers are reproducible and inspectable.

export function parseJsonl(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

const round = (n) => Math.round(n * 100) / 100;
const round0 = (n) => Math.round(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const DECLINE_LEVELS = { "0%": 0, "10%": 0.10, "20%": 0.20, "40%": 0.40 };
export const ITP_LEVELS = { "0%": 0, "15%": 0.15, "30%": 0.30 };
export const ADBLOCK_LEVELS = { "0%": 0, "5%": 0.05, "15%": 0.15 };
export const MODELING_RATE = 0.65; // consent-mode recovers ~65% of consent-declined signal

// Per-channel trackability profile: multipliers on the base loss rates, reflecting
// the typical browser/consent mix of each channel. Affiliate & organic skew
// Safari/privacy-heavy (more cookie/ITP loss); email & paid_search are more
// logged-in / consented (less loss). Fallback: neutral (1x).
export const PROFILES = {
  affiliate:   { decline: 1.0, itp: 1.3, adblock: 1.4 },
  organic:     { decline: 1.0, itp: 1.4, adblock: 0.7 },
  direct:      { decline: 0.9, itp: 1.2, adblock: 0.7 },
  social:      { decline: 1.1, itp: 1.1, adblock: 1.3 },
  paid_search: { decline: 0.6, itp: 0.5, adblock: 0.5 },
  email:       { decline: 0.4, itp: 0.9, adblock: 0.5 },
};
const profile = (c) => PROFILES[c] || { decline: 1, itp: 1, adblock: 1 };

// Ground-truth conversions per last-touch channel from the event streams.
export function buildBaseline({ webEvents, conversions }) {
  const touches = {};
  for (const e of webEvents) {
    (touches[e.visitor_id] ||= []).push([new Date(e.occurred_at).getTime(), e.source || e.medium || "direct"]);
  }
  const byChannel = {};
  for (const c of conversions) {
    const seq = (touches[c.visitor_id] || []).filter(([t]) => t <= new Date(c.converted_at).getTime()).sort((a, b) => a[0] - b[0]);
    const ch = seq.length ? seq[seq.length - 1][1] : "direct";
    (byChannel[ch] ||= { channel: ch, conversions: 0, revenue: 0 });
    byChannel[ch].conversions += 1;
    byChannel[ch].revenue += c.order_value || 0;
  }
  const channels = Object.values(byChannel).map((c) => ({ ...c, revenue: round(c.revenue) })).sort((a, b) => b.revenue - a.revenue);
  return {
    channels,
    totalConversions: channels.reduce((s, c) => s + c.conversions, 0),
    totalRevenue: round(channels.reduce((s, c) => s + c.revenue, 0)),
  };
}

// Simulate observed vs actual under the chosen loss rates.
export function simulate(baseline, opts = {}) {
  const decline = DECLINE_LEVELS[opts.decline] ?? 0;
  const itp = ITP_LEVELS[opts.itp] ?? 0;
  const adblock = ADBLOCK_LEVELS[opts.adblock] ?? 0;
  const consentMode = !!opts.consentMode;

  const rows = baseline.channels.map((c) => {
    const p = profile(c.channel);
    const dEff = clamp(decline * p.decline, 0, 0.95);
    const iEff = clamp(itp * p.itp, 0, 0.95);
    const aEff = clamp(adblock * p.adblock, 0, 0.95);
    const tracked = (1 - dEff) * (1 - iEff) * (1 - aEff);

    // Sequential loss decomposition (sums exactly to the total loss).
    const lostConsent = c.revenue * dEff;
    const afterConsent = c.revenue * (1 - dEff);
    const lostItp = afterConsent * iEff;
    const afterItp = afterConsent * (1 - iEff);
    const lostAdblock = afterItp * aEff;

    const observed = c.revenue * tracked;
    const recovered = consentMode ? lostConsent * MODELING_RATE : 0; // consent mode models consent-declined losses only
    const reported = observed + recovered;

    return {
      channel: c.channel, actual: c.revenue, actualConversions: c.conversions,
      trackedPct: round0(tracked * 100),
      observed: round(observed), reported: round(reported), recovered: round(recovered),
      gap: round(c.revenue - reported), gapPct: round0(((c.revenue - reported) / (c.revenue || 1)) * 100),
      lostConsent: round(lostConsent), lostItp: round(lostItp), lostAdblock: round(lostAdblock),
    };
  });

  const sum = (k) => round(rows.reduce((s, r) => s + r[k], 0));
  const actual = baseline.totalRevenue;
  const observed = sum("observed"), reported = sum("reported"), recovered = sum("recovered");
  const loss = { consent: sum("lostConsent"), itp: sum("lostItp"), adblock: sum("lostAdblock") };
  const byGap = rows.slice().sort((a, b) => b.gapPct - a.gapPct);

  const metrics = {
    actualRevenue: actual,
    observedRevenue: observed,
    observedPct: round0((observed / (actual || 1)) * 100),
    underReportPct: round0(((actual - observed) / (actual || 1)) * 100),
    reportedRevenue: reported,
    recovered,
    residualGapPct: round0(((actual - reported) / (actual || 1)) * 100),
    mostAffected: byGap[0] ? byGap[0].channel : "—",
  };

  return {
    options: { decline: opts.decline || "0%", itp: opts.itp || "0%", adblock: opts.adblock || "0%", consentMode },
    rows, byGap, loss, metrics, actual, observed, reported, recovered,
  };
}
