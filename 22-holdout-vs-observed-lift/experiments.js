// Sample holdout (incrementality) experiments for the fictional Northstar
// Outfitters marketing mix. Invented — no real brands, spend, or PII.
//
// Each row is one geo/audience holdout test: a randomly-withheld CONTROL group
// that never saw the campaign, and a TREATMENT group that did. The control tells
// you what would have happened anyway (the organic baseline). The gap between
// the two groups — not the platform's reported number — is the true incremental
// effect the ad spend actually caused.
//
// The mix is deliberately varied so the tool has a real story to tell:
//   - brand-search + retargeting: huge reported ROAS, but the control converts
//     almost as well → the spend mostly harvests demand that already existed.
//   - prospecting / affiliate / generic-search: treatment clearly beats control
//     → genuinely incremental, even though reported ROAS looks unremarkable.
//   - newsletter: significant at 95% but not at 99% → the confidence bar matters.
//   - instagram-awareness: holdout far too small → wide interval, can't conclude.
//
// Fields: treatment/control are {users, conversions}; revenue is the treatment
// group's observed revenue; spend is the campaign cost over the test window.
// Incremental revenue is derived from treatment AOV, never stored, so the
// reported-vs-incremental gap is always computed, never asserted.

export const EXPERIMENTS = [
  {
    id: "brand-search",
    channel: "Brand search",
    source: "google / cpc",
    note: "Bidding on our own brand name. People typing “northstar outfitters” were already looking for us.",
    treatment: { users: 8000, conversions: 480 },
    control: { users: 4000, conversions: 224 },
    revenue: 62400,
    spend: 9000,
  },
  {
    id: "retargeting",
    channel: "Retargeting",
    source: "facebook / paid-social",
    note: "Chasing recent site visitors with display ads. Most were coming back regardless.",
    treatment: { users: 12000, conversions: 360 },
    control: { users: 6000, conversions: 168 },
    revenue: 34200,
    spend: 8000,
  },
  {
    id: "prospecting",
    channel: "Prospecting (lookalike)",
    source: "facebook / paid-social",
    note: "Cold lookalike audiences who had never heard of us. New demand, not harvested demand.",
    treatment: { users: 20000, conversions: 300 },
    control: { users: 10000, conversions: 90 },
    revenue: 33000,
    spend: 11000,
  },
  {
    id: "affiliate-partner",
    channel: "Affiliate partner",
    source: "affiliate / referral",
    note: "An outdoor blog's audience. Reaches people our other channels don't touch.",
    treatment: { users: 15000, conversions: 375 },
    control: { users: 7500, conversions: 120 },
    revenue: 37500,
    spend: 12000,
  },
  {
    id: "newsletter",
    channel: "Newsletter",
    source: "email / owned",
    note: "Our own list. Cheap to send, so reported ROAS is enormous — but they're already customers.",
    treatment: { users: 9000, conversions: 450 },
    control: { users: 4500, conversions: 189 },
    revenue: 47250,
    spend: 6000,
  },
  {
    id: "generic-search",
    channel: "Generic search",
    source: "google / cpc",
    note: "Non-brand terms like “hiking jacket”. Genuinely new shoppers comparing options.",
    treatment: { users: 10000, conversions: 250 },
    control: { users: 5000, conversions: 75 },
    revenue: 30000,
    spend: 10000,
  },
  {
    id: "instagram-awareness",
    channel: "Instagram awareness",
    source: "instagram / paid-social",
    note: "A small brand-awareness burst. The holdout was tiny, so the result is inconclusive by design.",
    treatment: { users: 1500, conversions: 33 },
    control: { users: 750, conversions: 15 },
    revenue: 3795,
    spend: 3000,
  },
];
