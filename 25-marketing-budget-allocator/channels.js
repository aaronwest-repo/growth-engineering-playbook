// Channel response curves for the fictional Northstar Outfitters marketing mix.
// Invented planning parameters — no real budgets, spend, or PII.
//
// Each channel has a DIMINISHING-RETURNS response curve: incremental revenue as a
// function of spend, of the form
//
//     response(s) = vmax * (1 − e^(−s / k))
//
// where `vmax` is the revenue ceiling the channel can drive at infinite spend and
// `k` is the spend scale (smaller k saturates faster). The first euro into a
// channel returns `margin * vmax / k` in gross profit; every euro after returns
// less. That curvature is the whole game: the optimal budget doesn't chase the
// highest average ROAS, it equalises the *marginal* return across channels.
//
// The mix is calibrated to echo the measurement tools: retargeting and brand
// search saturate fast (they mostly harvest demand — see the holdout and POAS
// tools), while email and generic search still have steep, unfarmed marginal
// returns. `currentSpend` is the status-quo plan the optimiser is graded against.

export const CHANNELS = [
  {
    id: "brand_search", channel: "Brand search", source: "google / cpc",
    currentSpend: 9000, vmax: 70000, k: 4000, margin: 0.60,
    note: "Saturates fast — you're near the ceiling of people already searching your name.",
  },
  {
    id: "generic_search", channel: "Generic search", source: "google / cpc",
    currentSpend: 10000, vmax: 90000, k: 14000, margin: 0.45,
    note: "Broad, slow-saturating demand — still steep marginal returns at current spend.",
  },
  {
    id: "paid_social", channel: "Paid social", source: "facebook / paid-social",
    currentSpend: 11000, vmax: 60000, k: 9000, margin: 0.45,
    note: "Prospecting reach, but the current plan has pushed it past its profitable margin.",
  },
  {
    id: "retargeting", channel: "Retargeting", source: "facebook / paid-social",
    currentSpend: 8000, vmax: 30000, k: 3500, margin: 0.50,
    note: "Tiny audience, saturates almost immediately — most spend here is wasted.",
  },
  {
    id: "affiliate", channel: "Affiliate", source: "affiliate / referral",
    currentSpend: 12000, vmax: 85000, k: 15000, margin: 0.42,
    note: "Large partner reach with a low margin — profitable but not far above breakeven.",
  },
  {
    id: "newsletter", channel: "Newsletter", source: "email / owned",
    currentSpend: 4000, vmax: 60000, k: 8000, margin: 0.55,
    note: "High-margin owned channel, badly underfunded — the steepest marginal return in the mix.",
  },
];
