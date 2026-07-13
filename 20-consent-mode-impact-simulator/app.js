// UI for the Consent-Mode & Tracking-Loss Simulator. Logic lives in consent.js.
import { parseJsonl, buildBaseline, simulate } from "./consent.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => "€" + Math.round(Number(x)).toLocaleString("en-US");
const chLabel = (c) => c.replace(/_/g, " ");

let baseline = null;
let options = { decline: "20%", itp: "15%", adblock: "5%", consentMode: false };

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  try {
    const [we, cv] = await Promise.all([
      fetchText("../shared-data/events/web-events.jsonl"),
      fetchText("../shared-data/events/conversions.jsonl"),
    ]);
    baseline = buildBaseline({ webEvents: parseJsonl(we), conversions: parseJsonl(cv) });
    $("fileInfo").innerHTML = `Ground truth: <strong>${baseline.totalConversions}</strong> conversions · <strong>${eur(baseline.totalRevenue)}</strong> across <strong>${baseline.channels.length}</strong> channels <span style="color:var(--muted)">(shared-data)</span>`;
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load event data. Serve the repo from its <strong>root</strong> and open <code>/20-consent-mode-impact-simulator/</code>.`;
  }
}

function setControl(control, value, seg, btn) {
  options[control] = control === "consentMode" ? value === "on" : value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  if (!baseline) return;
  const s = simulate(baseline, options);
  renderMetrics(s);
  renderCmp3(s);
  renderLoss(s);
  renderChannels(s);
  renderInsight(s);
}

function renderMetrics(s) {
  const m = s.metrics;
  const cards = [
    ["Actual revenue", eur(m.actualRevenue), ""],
    ["Observed", `${m.observedPct}%`, m.observedPct >= 90 ? "good" : m.observedPct >= 70 ? "warn" : "bad"],
    ["Under-reported", `${m.underReportPct}%`, m.underReportPct ? "bad" : "good"],
    ["Reported (c-mode)", eur(m.reportedRevenue), options.consentMode ? "good" : ""],
    ["Recovered", eur(m.recovered), m.recovered ? "good" : ""],
    ["Residual gap", `${m.residualGapPct}%`, m.residualGapPct >= 20 ? "bad" : m.residualGapPct ? "warn" : "good"],
    ["Most affected", chLabel(m.mostAffected), "bad", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(v)}</dd></div>`).join("");
}

function renderCmp3(s) {
  const A = s.actual || 1;
  const bar = (cls, label, val, note) => `
    <div class="row">
      <div class="lab"><span>${label}</span><b>${eur(val)} · ${Math.round((val / A) * 100)}%</b></div>
      <div class="track"><div class="fill ${cls}" style="width:${Math.max(2, (val / A) * 100)}%">${val / A > 0.12 ? eur(val) : ""}</div></div>
      ${note ? `<div class="foot">${note}</div>` : ""}
    </div>`;
  $("cmp3").innerHTML =
    bar("actual", "Actual (what really happened)", s.actual, "Ground truth — every conversion in the data.") +
    bar("observed", "Observed (what analytics records)", s.observed, `You're flying on ${s.metrics.observedPct}% of the truth.`) +
    (options.consentMode
      ? bar("reported", "Reported (with consent-mode modelling)", s.reported, `Modelling recovers ${eur(s.recovered)} of the consent-declined slice — ${s.metrics.residualGapPct}% still missing.`)
      : `<div class="foot" style="margin-top:-4px">Turn on consent-mode modelling to see how much is recoverable.</div>`);
}

function renderLoss(s) {
  const items = [
    ["consent", "Consent declined", s.loss.consent],
    ["itp", "Safari / ITP loss", s.loss.itp],
    ["adblock", "Ad-blockers", s.loss.adblock],
  ];
  if (options.consentMode) items.push(["recovered", "↑ Consent-mode recovered", s.recovered]);
  const max = Math.max(...items.map(([, , v]) => v), 1);
  $("loss").innerHTML = items.map(([cls, label, v]) => `
    <li><span>${esc(label)}</span>
      <span class="bar ${cls}"><span style="width:${(v / max) * 100}%"></span></span>
      <span class="v" style="color:${cls === "recovered" ? "var(--good)" : "var(--text)"}">${cls === "recovered" ? "+" : "−"}${eur(v)}</span></li>`).join("");
}

function renderChannels(s) {
  const rows = s.byGap.map((r) => {
    const cls = r.gapPct >= 40 ? "hi" : r.gapPct >= 25 ? "mid" : "lo";
    return `<tr>
      <td>${esc(chLabel(r.channel))}</td>
      <td>${eur(r.actual)}</td>
      <td>${r.trackedPct}%<span class="trk"><span style="width:${r.trackedPct}%"></span></span></td>
      <td>${eur(r.observed)}</td>
      <td>${options.consentMode ? eur(r.reported) : "—"}</td>
      <td class="gappct ${cls}">${r.gapPct}%</td>
    </tr>`;
  }).join("");
  $("channels").innerHTML = `<thead><tr>
      <th>Channel</th><th>Actual</th><th>Tracked</th><th>Observed</th><th>Reported</th><th>Gap</th>
    </tr></thead><tbody>${rows}</tbody>`;
}

function renderInsight(s) {
  const worst = s.byGap[0], best = s.byGap[s.byGap.length - 1];
  $("insight").innerHTML = `
    <p>At these settings your analytics shows <strong>${eur(s.observed)}</strong> of <strong>${eur(s.actual)}</strong> in real revenue — a <strong>${s.metrics.underReportPct}% under-report</strong>${options.consentMode ? `, or ${s.metrics.residualGapPct}% even with consent-mode modelling` : ""}.</p>
    <p><strong>${chLabel(worst.channel)}</strong> is under-reported by <strong>${worst.gapPct}%</strong> while <strong>${chLabel(best.channel)}</strong> loses only <strong>${best.gapPct}%</strong>. That difference is the trap: optimise to observed data and you'll shift budget <em>toward</em> the trackable channels and <em>away</em> from the ones that are simply harder to measure — the same last-click bias problem, one layer down. Model the gap before you cut a channel.</p>`;
}

init();
