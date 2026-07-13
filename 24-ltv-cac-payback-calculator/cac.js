// Customer-acquisition cost per acquisition channel for the fictional Northstar
// Outfitters store. These are DOCUMENTED ASSUMPTIONS, not measured spend — the
// blended cost to acquire one new customer through each channel, the way a real
// finance-plus-marketing review would agree on planning numbers. Invented, no
// real budgets or PII.
//
// The spread is the teaching point: "free" channels (direct, organic) are cheap
// per customer but capacity-limited, while paid prospecting (social, paid search)
// buys volume at a cost that the customer's lifetime margin has to clear. LTV is
// computed from the real order data; only the cost side lives here so the
// assumption is explicit and easy to change.

export const CAC = {
  direct: 8, // brand/PR/word-of-mouth spillover — minimal attributable cost
  organic: 6, // SEO/content amortised per acquired customer
  email: 14, // list-building + ESP cost (newsletter-signup acquisition)
  affiliate: 35, // partner commission on the acquiring order
  paid_search: 48, // non-brand search prospecting
  social: 55, // paid-social prospecting to cold audiences
};

// Human labels + display order.
export const CHANNEL_LABELS = {
  direct: "Direct", organic: "Organic", email: "Email",
  affiliate: "Affiliate", paid_search: "Paid search", social: "Paid social",
};

// LTV:CAC rule-of-thumb bands and payback thresholds used for verdicts.
export const THRESHOLDS = {
  ltvCacHealthy: 3, // the classic "3:1 or better" SaaS/e-comm rule of thumb
  ltvCacMarginal: 1, // below 1 you lose money on every acquisition
  paybackHealthy: 12, // recover CAC within a year
  paybackSlow: 24, // beyond two years is a cash-flow problem
};
