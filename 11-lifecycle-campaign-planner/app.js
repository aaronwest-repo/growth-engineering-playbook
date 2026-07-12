// UI for the Lifecycle Campaign Planner. All logic lives in planner.js.
import { parseCsv, buildProfiles, planCampaigns } from "./planner.js";

const C = "../shared-data/customers/";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (x) => Number(x).toLocaleString("en-US");
const eur = (x) => "€" + Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 });
const eur2 = (x) => "€" + Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let base = null;
let plan = null;
let options = { objective: "winback", incentive: "none", holdout: "0%", strictness: "basic" };
let selectedCampaign = "winback";

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));

  try {
    const [cs, os, ts] = await Promise.all([
      fetchText(C + "customers.csv"), fetchText(C + "orders.csv"), fetchText(C + "support-tickets.csv"),
    ]);
    base = buildProfiles({ customers: parseCsv(cs), orders: parseCsv(os), tickets: parseCsv(ts) });
    $("fileInfo").innerHTML = `Reference date <strong>${esc(base.refDate)}</strong> · <strong>${num(base.profiles.length)}</strong> customers scored · AOV <strong>${eur(base.aov)}</strong> · gross margin <strong>${Math.round(base.marginRate * 100)}%</strong> <span style="color:var(--muted)">(shared-data)</span>`;
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load customer data (<code>${esc(C)}</code>). Serve the repo from its <strong>root</strong> and open <code>/11-lifecycle-campaign-planner/</code>.`;
  }
}

function setControl(control, value, seg, btn) {
  options[control] = value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  if (control === "objective") selectedCampaign = null; // let plan pick the objective's campaign
  render();
}

function render() {
  if (!base) return;
  plan = planCampaigns(base, options);
  if (!selectedCampaign || !plan.campaigns.some((c) => c.key === selectedCampaign)) selectedCampaign = plan.selected;
  renderMetrics(plan.metrics);
  renderCampaigns();
  renderDetail();
}

function renderMetrics(m) {
  const cards = [
    ["Eligible", num(m.eligibleCustomers), "good"],
    ["Suppressed", num(m.suppressedCustomers), "bad"],
    ["Campaigns", num(m.campaignsPlanned), ""],
    ["Holdout", num(m.holdoutCustomers), "warn"],
    ["Revenue opp.", eur(m.revenueOpportunity), "good"],
    ["Incentive cost", eur(m.incentiveCost), m.incentiveCost > 0 ? "warn" : ""],
    ["Risk warnings", num(m.riskWarnings), m.riskWarnings ? "warn" : "good"],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");
}

function renderCampaigns() {
  $("campGrid").innerHTML = plan.campaigns.map((c) => `
    <button type="button" class="camp-card" data-key="${c.key}" aria-pressed="${c.key === selectedCampaign}">
      <div class="cc-name">${esc(c.name)}</div>
      <div class="cc-seg">${esc(c.segmentLabels.join(" · "))}</div>
      <div class="cc-stats"><span><b>${c.targetedCount}</b> targeted</span>${c.holdoutCount ? `<span class="cc-hold">${c.holdoutCount} holdout</span>` : ""}${c.suppressed.length ? `<span>${c.suppressed.length} suppressed</span>` : ""}</div>
    </button>`).join("");
  $("campGrid").querySelectorAll(".camp-card").forEach((btn) =>
    btn.addEventListener("click", () => { selectedCampaign = btn.dataset.key; renderCampaigns(); renderDetail(); }));
}

function current() { return plan.campaigns.find((c) => c.key === selectedCampaign); }

function renderDetail() {
  const c = current();
  if (!c) return;
  renderAudience(c);
  renderBrief(c);
  renderTimeline(c);
  renderMeasurement(c);
  renderRisk(c);
}

function renderAudience(c) {
  const reasons = {};
  c.suppressed.forEach((s) => (reasons[s.reason] = (reasons[s.reason] || 0) + 1));
  const reasonOrder = ["No marketing consent", "High return risk", "Unresolved negative support ticket", "Recent purchase (avoid over-mailing)", "Newsletter opt-out"];
  const supHtml = reasonOrder.map((r) => `<li><span>${esc(r)}</span><span class="${reasons[r] ? "cnt" : "none"}">${reasons[r] || 0}</span></li>`).join("");
  $("audience").innerHTML = `
    <div class="aud-top">
      <span class="pill t">${c.targetedCount} targeted</span>
      <span class="pill h">${c.holdoutCount} holdout (${Math.round(c.holdoutPct * 100)}%)</span>
      <span class="pill s">${c.suppressed.length} suppressed</span>
    </div>
    <div>${c.segmentLabels.map((s) => `<span class="seg-chip">${esc(s)}</span>`).join("")}</div>
    <p class="section-sub" style="margin:10px 0 2px">Suppression reasons (${options.strictness})</p>
    <ul class="sup-list">${supHtml}</ul>`;
}

function renderBrief(c) {
  const b = c.brief;
  const incentive = c.usesIncentive
    ? (c.incentivePct > 0 ? `${Math.round(c.incentivePct * 100)}% off — margin-aware, redeemers only` : "No active incentive (set one above)")
    : "None — this moment is not a discount play";
  $("brief").innerHTML = `<dl>
    <dt>Subject</dt><dd class="subj">${esc(b.subject)}</dd>
    <dt>Preheader</dt><dd class="pre">${esc(b.preheader)}</dd>
    <dt>Angle</dt><dd>${esc(b.angle)}</dd>
    <dt>CTA</dt><dd>${esc(b.cta)}</dd>
    <dt>Incentive</dt><dd>${esc(incentive)}</dd>
    <dt>Suggestion</dt><dd>${esc(b.suggestion)}</dd>
    <dt>Tone</dt><dd>${esc(b.tone)}</dd>
  </dl>`;
}

function renderTimeline(c) {
  const t = c.timeline;
  const items = [
    { date: t.sendDate, label: "Send — campaign goes out to the targeted audience", cls: "" },
    t.followUpDate ? { date: t.followUpDate, label: "Follow-up — reminder to non-openers / non-converters", cls: "" } : null,
    { date: t.measureEnd, label: `Measurement window closes (${t.measureDays}d) — compare targeted vs holdout on ${c.targetMetric.toLowerCase()}`, cls: "measure" },
  ].filter(Boolean);
  const holdNote = c.holdoutCount > 0
    ? `<li class="hold"><span class="t-date">Holdout</span><br><span class="t-label">${c.holdoutCount} eligible customers deliberately not sent, as the measurement baseline</span></li>`
    : `<li class="hold"><span class="t-date">No holdout</span><br><span class="t-label">0% held out — lift will not be separable from baseline (see risk)</span></li>`;
  $("timeline").innerHTML = `<ul class="tl">${items.map((i) => `<li class="${i.cls}"><span class="t-date">${esc(i.date)}</span><br><span class="t-label">${esc(i.label)}</span></li>`).join("")}${holdNote}</ul>`;
}

function renderMeasurement(c) {
  const netCls = c.netContribution >= 0 ? "pos" : "neg";
  $("measurement").innerHTML = `<dl>
    <dt>Target metric</dt><dd>${esc(c.targetMetric)}</dd>
    <dt>Targeted / holdout</dt><dd>${c.targetedCount} / ${c.holdoutCount}</dd>
    <dt>Expected incremental conversion</dt><dd>${Math.round(c.convRate * 100)}%</dd>
    <dt>Expected converters</dt><dd>${c.expectedConverters}</dd>
    <div class="sep"></div>
    <dt>Revenue opportunity</dt><dd>${eur2(c.revenueOpportunity)}</dd>
    <dt>Gross margin (${Math.round(base.marginRate * 100)}%)</dt><dd>${eur2(c.grossMargin)}</dd>
    <dt>Incentive cost</dt><dd>${c.incentiveCost > 0 ? "−" + eur2(c.incentiveCost) : eur2(0)}</dd>
    <div class="sep"></div>
    <dt><strong>Net expected contribution</strong></dt><dd class="net ${netCls}"><strong>${eur2(c.netContribution)}</strong></dd>
  </dl>`;
}

function renderRisk(c) {
  if (!c.warnings.length) { $("risk").innerHTML = `<p class="risk-none">✓ No risk flags for this campaign under the current scenario.</p>`; return; }
  $("risk").innerHTML = `<ul class="risk-list">${c.warnings.map((w) =>
    `<li><span class="rtag ${esc(w.type)}">${esc(w.type.replace(/_/g, " "))}</span><span>${esc(w.text)}</span></li>`).join("")}</ul>`;
}

init();
