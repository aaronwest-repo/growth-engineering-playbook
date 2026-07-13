// Multi-touch attribution model comparator core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/attribution.test.mjs). No DOM, no network, no PII — it
// reconstructs conversion journeys from the shared event streams.
//
// Attribution is a CHOICE, not a truth. The same conversions, scored by different
// models — last-click, first-click, linear, position-based, time-decay — hand
// credit to different channels. Last-click flatters the closer; first-click
// flatters the introducer; the truth is a modelling decision you should make on
// purpose. This rebuilds each conversion's channel path, applies all five models,
// and shows how the "winning channel" moves — so the model stops being an
// invisible default. Deterministic; nothing is sent anywhere.

export function parseJsonl(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

const DAY = 86400000;
const round = (n) => Math.round(n * 100) / 100;
const t = (iso) => new Date(iso).getTime();

export const MODELS = ["first", "last", "linear", "position", "time_decay"];
export const MODEL_LABELS = {
  first: "First-click", last: "Last-click", linear: "Linear",
  position: "Position-based", time_decay: "Time-decay",
};
const HALF_LIFE_DAYS = 7;

// Credit weights for a journey of touches (each {channel, time}) under a model.
export function weights(touches, model, convTime) {
  const n = touches.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  if (model === "first") return touches.map((_, i) => (i === 0 ? 1 : 0));
  if (model === "last") return touches.map((_, i) => (i === n - 1 ? 1 : 0));
  if (model === "linear") return touches.map(() => 1 / n);
  if (model === "position") {
    if (n === 2) return [0.5, 0.5];
    const mid = 0.2 / (n - 2);
    return touches.map((_, i) => (i === 0 || i === n - 1 ? 0.4 : mid));
  }
  if (model === "time_decay") {
    const raw = touches.map((x) => Math.pow(2, -((convTime - x.time) / DAY) / HALF_LIFE_DAYS));
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    return raw.map((r) => r / sum);
  }
  return touches.map(() => 1 / n);
}

const collapse = (seq) => { const out = []; for (const x of seq) if (!out.length || out[out.length - 1].channel !== x.channel) out.push(x); return out; };

// Rebuild one journey (ordered channel touches) per conversion.
export function buildJourneys({ webEvents, conversions, lookbackDays = 45 }) {
  // Sessions per visitor: session -> {channel, time} (entry channel = first event's source).
  const sessions = {};
  for (const e of webEvents) {
    const v = e.visitor_id, s = e.session_id;
    if (!v || !s) continue;
    (sessions[v] ||= {});
    if (!sessions[v][s]) sessions[v][s] = { channel: e.source || e.medium || "direct", time: t(e.occurred_at) };
    else if (t(e.occurred_at) < sessions[v][s].time) sessions[v][s].time = t(e.occurred_at);
  }

  const journeys = conversions.map((c) => {
    const convTime = t(c.converted_at);
    const vs = sessions[c.visitor_id] || {};
    let touches = Object.values(vs)
      .filter((x) => x.time <= convTime && convTime - x.time <= lookbackDays * DAY)
      .sort((a, b) => a.time - b.time);
    touches = collapse(touches);
    // Competing-channel click near the conversion = a closing touch last-click would grab.
    if (c.competing_channel && (!touches.length || touches[touches.length - 1].channel !== c.competing_channel)) {
      touches.push({ channel: c.competing_channel, time: convTime, competing: true });
    }
    if (!touches.length) touches = [{ channel: "direct", time: convTime }];
    return {
      id: c.order_id, visitor: c.visitor_id, convTime,
      value: c.order_value || 0, margin: c.gross_margin || 0,
      touches, channels: touches.map((x) => x.channel),
      multiChannel: new Set(touches.map((x) => x.channel)).size > 1,
    };
  });
  return journeys;
}

// Apply all models across all journeys; aggregate credited value per channel.
export function compare(journeys) {
  const channels = [...new Set(journeys.flatMap((j) => j.channels))].sort();
  const totalValue = round(journeys.reduce((s, j) => s + j.value, 0));

  const byModel = {};
  for (const m of MODELS) {
    const credit = Object.fromEntries(channels.map((c) => [c, { value: 0, conv: 0 }]));
    for (const j of journeys) {
      const w = weights(j.touches, m, j.convTime);
      j.touches.forEach((tch, i) => { credit[tch.channel].value += w[i] * j.value; credit[tch.channel].conv += w[i]; });
    }
    channels.forEach((c) => { credit[c].value = round(credit[c].value); credit[c].conv = round(credit[c].conv); credit[c].share = round((credit[c].value / (totalValue || 1)) * 100); });
    const winner = channels.slice().sort((a, b) => credit[b].value - credit[a].value)[0];
    byModel[m] = { credit, winner };
  }

  // Last-click bias: share under last-click minus share under first-click.
  // Positive = a "closer" channel last-click over-credits; negative = an
  // "introducer" first-click favours that last-click under-credits.
  const bias = channels.map((c) => ({
    channel: c,
    lastShare: byModel.last.credit[c].share,
    firstShare: byModel.first.credit[c].share,
    delta: round(byModel.last.credit[c].share - byModel.first.credit[c].share),
  })).sort((a, b) => b.delta - a.delta);

  // Ranking per model (channel order by credited value) to show shuffles.
  const ranking = {};
  for (const m of MODELS) ranking[m] = channels.slice().sort((a, b) => byModel[m].credit[b].value - byModel[m].credit[a].value);

  const multi = journeys.filter((j) => j.multiChannel);
  const metrics = {
    conversions: journeys.length,
    revenue: totalValue,
    multiTouch: multi.length,
    avgPathLength: round(journeys.reduce((s, j) => s + j.touches.length, 0) / (journeys.length || 1)),
    channels: channels.length,
    models: MODELS.length,
  };

  return { channels, byModel, bias, ranking, metrics, journeys };
}

// Per-conversion split: how each model divides ONE journey's value across touches.
export function journeyDetail(journey) {
  const rows = MODELS.map((m) => {
    const w = weights(journey.touches, m, journey.convTime);
    return { model: m, splits: journey.touches.map((tch, i) => ({ channel: tch.channel, weight: round(w[i]), value: round(w[i] * journey.value) })) };
  });
  return { id: journey.id, channels: journey.channels, value: journey.value, rows };
}

export function analyze(data) {
  const journeys = buildJourneys(data);
  return { ...compare(journeys), journeys };
}
