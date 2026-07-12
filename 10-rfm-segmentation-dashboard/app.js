// UI for the RFM Segmentation Dashboard. All logic lives in rfm.js.
import { parseCsv, buildSegmentation } from "./rfm.js";

const C = "../shared-data/customers/";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (x) => Number(x).toLocaleString("en-US");
const eur = (x) => "€" + Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 });
const scoreCls = (s) => `score s${s}`;

let model = null;
let selectedSegment = "vip_loyalists";
let selectedCustomerId = null;

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  try {
    const [cs, os, ts] = await Promise.all([
      fetchText(C + "customers.csv"), fetchText(C + "orders.csv"), fetchText(C + "support-tickets.csv"),
    ]);
    model = buildSegmentation({ customers: parseCsv(cs), orders: parseCsv(os), tickets: parseCsv(ts) });
    $("fileInfo").innerHTML = `Reference date <strong>${esc(model.refDate)}</strong> (latest order) · <strong>${num(model.metrics.customersScored)}</strong> customers with orders scored <span style="color:var(--muted)">(shared-data)</span>`;
    if (!model.activeSegments.includes(selectedSegment)) selectedSegment = model.activeSegments[0];
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load customer data (<code>${esc(C)}</code>). Serve the repo from its <strong>root</strong> and open <code>/10-rfm-segmentation-dashboard/</code>.`;
  }
}

function render() {
  if (!model) return;
  renderMetrics(model.metrics);
  renderMatrix(model.matrix);
  renderSegmentCards();
  renderSegmentDetail();
}

function renderMetrics(m) {
  const cards = [
    ["Customers scored", num(m.customersScored), ""],
    ["Active (≤180d)", num(m.activeCustomers), "good"],
    ["VIP loyalists", num(m.vipCustomers), "good"],
    ["At risk / dormant", num(m.atRiskDormant), "warn"],
    ["Suppressed", num(m.suppressedCustomers), "bad"],
    ["Segmentable rev.", eur(m.segmentableRevenue), ""],
    ["Return-adj. rev.", eur(m.returnAdjustedRevenue), "good"],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");
}

function renderMatrix(matrix) {
  const maxCount = Math.max(1, ...matrix.flat().map((c) => c.count));
  const head = `<tr><th></th>${[1, 2, 3, 4, 5].map((f) => `<th class="axis">F${f}</th>`).join("")}</tr>`;
  const rows = matrix.map((row) => {
    const r = row[0].r;
    const cells = row.map((c) => {
      const intensity = c.count / maxCount;
      const bg = c.count ? `rgba(79,156,249,${(0.12 + intensity * 0.5).toFixed(2)})` : "transparent";
      return `<td><div class="cell" style="background:${bg}" title="R${c.r} · F${c.f}: ${c.count} customer(s), ${eur(c.revenue)} net">
        <b>${c.count || "·"}</b>${c.count ? `<small>${eur(c.revenue)}</small>` : ""}</div></td>`;
    }).join("");
    return `<tr><th class="axis">R${r}</th>${cells}</tr>`;
  }).join("");
  $("matrix").innerHTML = head + rows;
}

function renderSegmentCards() {
  $("segCards").innerHTML = model.activeSegments.map((k) => {
    const s = model.segments[k];
    return `<button type="button" class="seg-card ${s.tone}" data-seg="${k}" aria-pressed="${k === selectedSegment}">
      <div class="sc-label">${esc(s.label)}</div>
      <div class="sc-stats">${s.count} customer(s) · ${eur(s.revenue)} net</div>
    </button>`;
  }).join("");
  $("segCards").querySelectorAll(".seg-card").forEach((btn) =>
    btn.addEventListener("click", () => { selectedSegment = btn.dataset.seg; selectedCustomerId = null; renderSegmentCards(); renderSegmentDetail(); }));
}

function renderSegmentDetail() {
  const seg = model.segments[selectedSegment];
  const rec = seg.recommendation;
  const members = seg.customers;

  // Campaign recommendation panel.
  const emailable = members.filter((p) => p.eligibility.emailEligible).length;
  $("recommendation").innerHTML = `
    <h3>${esc(seg.label)}<span class="tag ${seg.tone}">${seg.count} customers · ${eur(seg.revenue)} net</span></h3>
    <p style="color:var(--muted);margin:6px 0 0;font-size:13.5px">${esc(rec.why)}</p>
    <dl>
      <dt>Recommended action</dt><dd>${esc(rec.action)}</dd>
      <dt>Incentive</dt><dd>${esc(rec.incentive)}</dd>
      <dt>Email-eligible now</dt><dd>${emailable} of ${seg.count}${seg.count && emailable < seg.count ? ` <span class="flag">— ${seg.count - emailable} held/suppressed</span>` : ""}</dd>
    </dl>`;

  // Suppression / warnings panel (aggregated across the segment).
  const rules = [
    ["No marketing consent", (p) => p.eligibility.suppressed, "bad"],
    ["Newsletter opt-out", (p) => !p.consent.newsletter, "warn"],
    ["No personalization consent", (p) => !p.consent.personalization, "warn"],
    ["Recent purchase (hold promo)", (p) => p.eligibility.recentPurchaseHold, "warn"],
    ["High returns risk", (p) => p.eligibility.returnsRisk, "bad"],
    ["Recent negative support", (p) => p.eligibility.supportRisk, "bad"],
  ];
  const rowsHtml = rules.map(([label, fn]) => {
    const n = members.filter(fn).length;
    return `<li><span>${esc(label)}</span><span class="${n ? "cnt" : "none"}">${n || "0"}</span></li>`;
  }).join("");
  $("suppression").innerHTML = `<ul class="warn-list">${rowsHtml}</ul>
    <p class="section-sub" style="margin:12px 0 0">Counts are customers in <strong>${esc(seg.label)}</strong> hit by each rule. A customer can trigger several.</p>`;

  renderCustomerTable(members);
  if (!members.some((p) => p.customer_id === selectedCustomerId)) selectedCustomerId = members[0]?.customer_id || null;
  renderWhy();
}

function renderCustomerTable(members) {
  $("custTitle").textContent = `Customers — ${model.segments[selectedSegment].label} (${members.length})`;
  const rows = members
    .slice()
    .sort((a, b) => b.netRevenue - a.netRevenue)
    .map((p) => {
      const warnMark = p.eligibility.suppressed || p.eligibility.returnsRisk || p.eligibility.supportRisk
        ? `<span class="flag bad" title="${esc(p.warnings.join("; "))}">●</span>`
        : p.warnings.length ? `<span class="flag" title="${esc(p.warnings.join("; "))}">●</span>` : "";
      return `<tr data-id="${p.customer_id}" aria-selected="${p.customer_id === selectedCustomerId}">
        <td>${esc(p.first_name)} <span style="color:var(--muted)">${esc(p.customer_id)}</span></td>
        <td>${esc(p.country)}</td>
        <td><span class="${scoreCls(p.r)}">${p.r}</span></td>
        <td><span class="${scoreCls(p.f)}">${p.f}</span></td>
        <td><span class="${scoreCls(p.m)}">${p.m}</span></td>
        <td>${esc(p.lastOrderDate)}</td>
        <td class="n">${p.frequency}</td>
        <td class="n">${eur(p.netRevenue)}</td>
        <td class="n">${warnMark}</td>
      </tr>`;
    }).join("");
  $("cust").innerHTML = `<thead><tr>
      <th>Customer</th><th>Country</th><th>R</th><th>F</th><th>M</th>
      <th>Last order</th><th class="n">Orders</th><th class="n">Net €</th><th class="n">⚠</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="9" style="color:var(--muted)">No customers in this segment.</td></tr>'}</tbody>`;
  $("cust").querySelectorAll("tbody tr[data-id]").forEach((tr) =>
    tr.addEventListener("click", () => { selectedCustomerId = tr.dataset.id; renderCustomerTable(members); renderWhy(); }));
}

function renderWhy() {
  const p = model.profiles.find((x) => x.customer_id === selectedCustomerId);
  if (!p) { $("why").innerHTML = "<p style='color:var(--muted)'>Select a customer above.</p>"; return; }
  const warnChips = p.warnings.length
    ? p.warnings.map((w) => `<span class="chip">${esc(w)}</span>`).join("")
    : '<span class="chip ok">No suppression flags — fully eligible</span>';
  $("why").innerHTML = `
    <p style="margin:0 0 4px"><strong>${esc(p.first_name)}</strong> <span style="color:var(--muted)">${esc(p.customer_id)} · ${esc(p.country)} · ${esc(p.loyalty_tier)} tier</span>
      → <strong style="color:var(--accent)">${esc(p.segmentLabel)}</strong> <span class="rfm-badge">${esc(p.code)}</span></p>
    <dl>
      <dt>Recency (R${p.r})</dt><dt>Frequency (F${p.f})</dt><dt>Monetary (M${p.m})</dt>
      <dd>${p.recencyDays}d since last order</dd><dd>${p.frequency} order(s)</dd><dd>${eur(p.netRevenue)} net</dd>
      <dt>Latest order</dt><dt>Gross / returned</dt><dt>Return-adj. margin</dt>
      <dd>${esc(p.lastOrderDate)}</dd><dd>${eur(p.grossRevenue)} / ${eur(p.returnedAmount)}</dd><dd>${eur(p.margin)}</dd>
    </dl>
    <p style="margin:0 0 2px;color:var(--muted);font-size:12px">Consent — marketing: <b style="color:var(--text)">${p.consent.marketing ? "yes" : "no"}</b> · personalization: <b style="color:var(--text)">${p.consent.personalization ? "yes" : "no"}</b> · newsletter: <b style="color:var(--text)">${p.consent.newsletter ? "yes" : "no"}</b></p>
    <div class="warns">${warnChips}</div>
    <p class="section-sub" style="margin:10px 0 0">Recommended: <strong style="color:var(--text)">${esc(p.recommendation.action)}</strong> — ${esc(p.recommendation.incentive)}.</p>`;
}

init();
