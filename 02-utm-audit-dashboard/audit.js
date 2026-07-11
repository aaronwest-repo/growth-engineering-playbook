// UTM audit + decision-metrics core for the campaign dashboard.
//
// Dependency-free ES module, imported by both the browser UI (app.js) and the
// Node smoke test (tests/audit.test.mjs), so the logic that ships is the logic
// that is tested. No DOM, no I/O — pure functions over parsed campaign rows.

// --- Canonical taxonomies --------------------------------------------------
// Maps the messy real-world labels back to one intended channel / medium.
export const SOURCE_CANON = {
  google: "Google",
  facebook: "Meta", fb: "Meta", meta: "Meta",
  instagram: "Instagram", ig: "Instagram",
  bing: "Bing",
  newsletter: "Newsletter", email: "Newsletter",
  affiliate: "Affiliate",
};

export const MEDIUM_CANON = {
  cpc: "cpc", ppc: "cpc",
  "paid-social": "paid-social", "paid social": "paid-social", social: "paid-social",
  email: "email", newsletter: "email",
  affiliate: "affiliate", referral: "affiliate",
};

export function canonicalSource(raw) {
  const key = String(raw || "").trim().toLowerCase();
  return SOURCE_CANON[key] || (String(raw || "").trim() || "(unknown)");
}

export function canonicalMedium(raw) {
  const key = String(raw || "").trim().toLowerCase();
  return MEDIUM_CANON[key] || (key || "(unknown)");
}

/** Normalize a campaign name so spelling variants collapse to one key. */
export function canonicalCampaign(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- CSV parsing -----------------------------------------------------------
/** Minimal RFC-4180-ish parser (handles quotes); returns array of objects. */
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const pushField = () => { record.push(field); field = ""; };
  const pushRecord = () => { rows.push(record); record = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushField(); pushRecord();
    } else if (c === "\r") {
      // ignore; \n handles the newline
    } else {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) { pushField(); pushRecord(); }

  const rawRows = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  if (!rawRows.length) return [];
  const header = rawRows[0].map((h) => h.trim());
  return rawRows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i] : ""; });
    return obj;
  });
}

// --- Audit -----------------------------------------------------------------
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function metrics(agg) {
  return {
    ...agg,
    roas: agg.spend > 0 ? agg.revenue / agg.spend : null,
    poas: agg.spend > 0 ? agg.grossMargin / agg.spend : null,
    cpa: agg.orders > 0 ? agg.spend / agg.orders : null,
  };
}

/**
 * Audit a set of parsed campaign rows. Returns hygiene issues, per-channel and
 * blended decision metrics, and plain-English verdicts.
 */
export function auditCampaigns(rows) {
  const totals = { spend: 0, revenue: 0, grossMargin: 0, orders: 0 };
  const channels = new Map(); // canonical name -> agg + raw label set
  const mediums = new Map();  // canonical medium -> raw label set
  const campaigns = new Map(); // canonical campaign -> {variants:Set, sources:Set}
  let missingRows = 0;
  let missingSpend = 0;

  for (const r of rows) {
    const spend = num(r.spend);
    const revenue = num(r.revenue);
    const grossMargin = num(r.gross_margin);
    const orders = num(r.orders);

    totals.spend += spend;
    totals.revenue += revenue;
    totals.grossMargin += grossMargin;
    totals.orders += orders;

    const ch = canonicalSource(r.source);
    if (!channels.has(ch)) {
      channels.set(ch, { name: ch, spend: 0, revenue: 0, grossMargin: 0, orders: 0, labels: new Set() });
    }
    const c = channels.get(ch);
    c.spend += spend; c.revenue += revenue; c.grossMargin += grossMargin; c.orders += orders;
    c.labels.add(String(r.source));

    const med = canonicalMedium(r.medium);
    if (!mediums.has(med)) mediums.set(med, new Set());
    mediums.get(med).add(String(r.medium));

    const rawCampaign = String(r.campaign || "").trim();
    if (!rawCampaign) {
      missingRows++;
      missingSpend += spend;
    } else {
      const key = canonicalCampaign(rawCampaign);
      if (!campaigns.has(key)) campaigns.set(key, { key, variants: new Set(), sources: new Set() });
      campaigns.get(key).variants.add(rawCampaign);
      campaigns.get(key).sources.add(ch);
    }
  }

  const channelList = [...channels.values()]
    .map((c) => ({ ...metrics(c), labels: [...c.labels].sort(), rawLabelCount: c.labels.size }))
    .sort((a, b) => b.spend - a.spend);

  const sourceInconsistencies = channelList
    .filter((c) => c.rawLabelCount > 1)
    .map((c) => ({ channel: c.name, labels: c.labels }));

  const mediumInconsistencies = [...mediums.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([canonical, set]) => ({ canonical, labels: [...set].sort() }));

  const namingCollisions = [...campaigns.values()]
    .filter((c) => c.variants.size > 1)
    .map((c) => ({ normalized: c.key, variants: [...c.variants].sort(), sources: [...c.sources].sort() }))
    .sort((a, b) => b.variants.length - a.variants.length);

  const blended = metrics(totals);

  return {
    totals: { ...blended, rowCount: rows.length },
    channels: channelList,
    issues: {
      sourceInconsistencies,
      mediumInconsistencies,
      missingCampaign: {
        rows: missingRows,
        spend: missingSpend,
        pctSpend: totals.spend > 0 ? missingSpend / totals.spend : 0,
      },
      namingCollisions,
    },
    verdicts: buildVerdicts({ blended, channelList, missingRows, missingSpend, totals, namingCollisions }),
  };
}

const euro = (x) => "€" + Math.round(x).toLocaleString("en-US");

function buildVerdicts({ blended, channelList, missingRows, missingSpend, totals, namingCollisions }) {
  const out = [];

  // Split-source spend (most fragmented channel first).
  const split = channelList.filter((c) => c.rawLabelCount > 1).sort((a, b) => b.rawLabelCount - a.rawLabelCount);
  if (split.length) {
    const c = split[0];
    out.push({
      severity: "warn",
      text: `Your ${c.name} spend is split across ${c.rawLabelCount} source labels (${c.labels.join(", ")}) — ${euro(c.spend)} that reports as separate "channels".`,
    });
  }

  // ROAS looks fine but POAS is under water.
  const trap = channelList
    .filter((c) => c.roas !== null && c.poas !== null && c.roas >= 1.8 && c.poas < 1)
    .sort((a, b) => b.spend - a.spend)[0];
  if (trap) {
    out.push({
      severity: "bad",
      text: `${trap.name}'s ROAS is ${trap.roas.toFixed(2)}× (looks healthy), but POAS is ${trap.poas.toFixed(2)}× — on gross margin it isn't covering its own ad spend.`,
    });
  }

  // Missing campaign tags.
  if (missingRows > 0) {
    out.push({
      severity: "warn",
      text: `Missing campaign tags hide ${euro(missingSpend)} in spend (${(missingSpend / totals.spend * 100).toFixed(1)}% of the total) from campaign-level decisions.`,
    });
  }

  // Blended vs channel: blended ROAS masking below-breakeven channels.
  const underwater = channelList.filter((c) => c.poas !== null && c.poas < 1);
  if (underwater.length && blended.roas !== null) {
    out.push({
      severity: "info",
      text: `Blended ROAS is ${blended.roas.toFixed(1)}×, but ${underwater.map((c) => c.name).join(" and ")} ${underwater.length === 1 ? "is" : "are"} below breakeven on margin — the average hides the losers.`,
    });
  }

  // Naming collisions.
  if (namingCollisions.length) {
    const worst = namingCollisions[0];
    out.push({
      severity: "warn",
      text: `"${worst.normalized}" appears under ${worst.variants.length} different spellings, so one campaign splits into ${worst.variants.length} rows in reporting.`,
    });
  }

  return out;
}
