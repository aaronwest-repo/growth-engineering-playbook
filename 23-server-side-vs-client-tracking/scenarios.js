// Sample traffic segments for the server-side vs client-side tracking model.
// Invented profile for the fictional Northstar Outfitters storefront — no real
// analytics data or PII. Loss is heterogeneous: a Safari/iOS shopper and a
// Firefox+ad-block shopper lose events for completely different reasons, so the
// segments carry their own loss rates rather than one blended number.
//
// Every rate is the fraction of events LOST to that cause, as a decimal.
//   consentDecline — user rejected analytics consent. Blocks BOTH client and
//                    server: you legally cannot send the event either way. This
//                    is the ceiling no architecture can beat.
//   adBlock        — extension/DNS blocks the client tag. Client-side only.
//   itp            — ITP / cookie expiry / storage partitioning drops the event
//                    or its identifiers. Client-side only.
//   beaconDrop     — the browser unloads before the client beacon fires, or the
//                    request is throttled. Client-side only.
//   serverError    — server tag mis-fires, times out, or is dropped downstream.
//                    Server-side only (small).
//
// Server-side tracking is immune to ad-block, ITP and beacon-drop (it sends the
// event from your backend), but it is NOT a consent workaround and adds its own
// small failure mode. That asymmetry is the whole point of the tool.

export const SCENARIOS = [
  {
    id: "safari-ios",
    segment: "Safari / iOS mobile",
    note: "Apple's ITP caps first-party cookies and partitions storage; a big slice of client events lose their identity or drop entirely.",
    trueEvents: 32000,
    consentDecline: 0.18, adBlock: 0.12, itp: 0.35, beaconDrop: 0.06, serverError: 0.03,
  },
  {
    id: "chrome-desktop",
    segment: "Chrome / desktop",
    note: "The friendliest environment: low ad-block, durable cookies. Client-side already captures most of it, so server-side adds the least here.",
    trueEvents: 40000,
    consentDecline: 0.15, adBlock: 0.08, itp: 0.05, beaconDrop: 0.03, serverError: 0.03,
  },
  {
    id: "android-mobile",
    segment: "Android / mobile Chrome",
    note: "Middle of the road — some ad-block and flaky-network beacon loss, moderate cookie churn.",
    trueEvents: 28000,
    consentDecline: 0.16, adBlock: 0.10, itp: 0.10, beaconDrop: 0.05, serverError: 0.03,
  },
  {
    id: "privacy-heavy",
    segment: "Firefox + ad-block",
    note: "Privacy-forward users: nearly half run content blockers that kill the client tag outright. Server-side recovers the most volume here.",
    trueEvents: 12000,
    consentDecline: 0.22, adBlock: 0.45, itp: 0.20, beaconDrop: 0.05, serverError: 0.03,
  },
  {
    id: "eu-consent",
    segment: "EU consent-heavy",
    note: "High GDPR consent-decline rate. The tech losses are recoverable, but consent is the wall — server-side cannot legally cross it.",
    trueEvents: 18000,
    consentDecline: 0.38, adBlock: 0.10, itp: 0.12, beaconDrop: 0.04, serverError: 0.03,
  },
];
