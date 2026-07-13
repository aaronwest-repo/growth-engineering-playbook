// Server-side vs client-side tracking core. Dependency-free ES module, imported
// by the browser UI (app.js) and the Node smoke test (tests/tracking.test.mjs).
// No DOM, no network, no PII.
//
// The question every measurement stack quietly gets wrong: how many of the events
// that actually happened do you actually capture? Client-side tags lose events to
// ad-block, ITP/cookie expiry, and beacon-drop — and the loss is biased by
// browser and device, so it silently distorts channel numbers. Server-side
// tracking is immune to those, but it is NOT a consent workaround (declined users
// are gone for both), and running client + server together double-counts unless
// you dedup on a shared event id.
//
// This models true event volume through each architecture, draws the consent
// ceiling no stack can beat, splits recoverable loss from unrecoverable, and
// shows the double-count a naive hybrid reports. Deterministic; nothing is sent.

const round = (n, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f; };

export const ARCHITECTURES = {
  client: { label: "Client-side" },
  server: { label: "Server-side" },
  hybrid: { label: "Hybrid (deduped)" },
  naive: { label: "Hybrid (no dedup)" },
};

// Capture rates (fraction of a segment's true events) under each architecture.
export function captureRates(seg) {
  const consentKept = 1 - seg.consentDecline; // ceiling: consent blocks both
  const clientSurv = (1 - seg.adBlock) * (1 - seg.itp) * (1 - seg.beaconDrop);
  const serverSurv = 1 - seg.serverError;

  const client = consentKept * clientSurv;
  const server = consentKept * serverSurv;
  // Deduped hybrid = an event is kept if client OR server captured it (union).
  const hybrid = consentKept * (1 - (1 - clientSurv) * (1 - serverSurv));
  // Naive hybrid = the two reported totals summed — double-counts the overlap.
  const naive = client + server;

  return { consentKept, clientSurv, serverSurv, client, server, hybrid, naive };
}

// Per-segment analysis in absolute events + the recoverable/consent split.
export function analyzeSegment(seg) {
  const r = captureRates(seg);
  const t = seg.trueEvents;

  const captured = {
    client: r.client * t, server: r.server * t, hybrid: r.hybrid * t, naive: r.naive * t,
  };
  const ceiling = r.consentKept * t; // perfect capture of consented traffic

  const clientLoss = t - captured.client;
  const recoverable = ceiling - captured.client; // tech loss server-side can win back
  const unrecoverable = t - ceiling; // consent — gone regardless
  const serverRecovery = captured.server - captured.client;
  const overcount = captured.naive - captured.hybrid; // phantom double-counted events

  // Sequential client-side loss waterfall (for the per-segment drill-down).
  const afterConsent = r.consentKept * t;
  const afterAdBlock = afterConsent * (1 - seg.adBlock);
  const afterItp = afterAdBlock * (1 - seg.itp);
  const afterBeacon = afterItp * (1 - seg.beaconDrop); // == captured.client
  const waterfall = [
    { cause: "True events", value: round(t), lost: 0, recoverable: false },
    { cause: "Consent declined", value: round(afterConsent), lost: round(t - afterConsent), recoverable: false },
    { cause: "Ad-block", value: round(afterAdBlock), lost: round(afterConsent - afterAdBlock), recoverable: true },
    { cause: "ITP / cookie loss", value: round(afterItp), lost: round(afterAdBlock - afterItp), recoverable: true },
    { cause: "Beacon drop", value: round(afterBeacon), lost: round(afterItp - afterBeacon), recoverable: true },
  ];

  return {
    id: seg.id, segment: seg.segment, note: seg.note, trueEvents: t,
    rates: r,
    captured: {
      client: round(captured.client), server: round(captured.server),
      hybrid: round(captured.hybrid), naive: round(captured.naive),
    },
    capturePct: {
      client: r.client, server: r.server, hybrid: r.hybrid, naive: r.naive,
    },
    ceiling: round(ceiling), ceilingPct: r.consentKept,
    clientLoss: round(clientLoss), recoverable: round(recoverable), unrecoverable: round(unrecoverable),
    serverRecovery: round(serverRecovery), overcount: round(overcount),
    waterfall,
  };
}

export const SORTS = {
  loss: (a, b) => (b.trueEvents - b.captured.client) / b.trueEvents - (a.trueEvents - a.captured.client) / a.trueEvents,
  recovery: (a, b) => b.serverRecovery - a.serverRecovery,
  volume: (a, b) => b.trueEvents - a.trueEvents,
};

// Portfolio report across all segments.
export function buildReport(scenarios, options = {}) {
  const sortKey = options.sort || "recovery";
  const rows = scenarios.map(analyzeSegment);
  const sorted = rows.slice().sort(SORTS[sortKey] || SORTS.recovery);

  const trueEvents = rows.reduce((s, r) => s + r.trueEvents, 0);
  const sum = (key) => rows.reduce((s, r) => s + r.captured[key], 0);
  const client = sum("client"), server = sum("server"), hybrid = sum("hybrid"), naive = sum("naive");
  const ceiling = rows.reduce((s, r) => s + r.ceiling, 0);
  const recoverable = rows.reduce((s, r) => s + r.recoverable, 0);
  const unrecoverable = rows.reduce((s, r) => s + r.unrecoverable, 0);

  const pct = (x) => (trueEvents ? x / trueEvents : 0);
  const metrics = {
    segments: rows.length,
    trueEvents: round(trueEvents),
    client: round(client), server: round(server), hybrid: round(hybrid), naive: round(naive),
    clientPct: pct(client), serverPct: pct(server), hybridPct: pct(hybrid), naivePct: pct(naive),
    ceiling: round(ceiling), ceilingPct: pct(ceiling),
    serverRecoveryPct: pct(server - client),
    recoverable: round(recoverable), unrecoverable: round(unrecoverable),
    recoverableShare: (trueEvents - client) ? recoverable / (trueEvents - client) : 0,
    overcount: round(naive - hybrid),
    overcountPct: hybrid ? (naive - hybrid) / hybrid : 0,
  };

  return { rows, sorted, metrics, sort: sortKey };
}
