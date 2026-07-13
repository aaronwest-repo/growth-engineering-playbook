// UI for the Channel-Mix POAS Dashboard. All logic lives in poas.js.
import { parseCsv, buildDashboard, RANK_FIELDS } from "./poas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => (x < 0 ? "−€" : "€") + Math.abs(Math.round(Number(x))).toLocaleString("en-US");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

let campaigns = null;
let options = { rankBy: "poas", incremental: false };

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  try {
    campaigns = parseCsv(await fetchText("../shared-data/marketing/campaigns-clean.csv"));
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load campaign data. Serve the repo from its <strong>root</strong> and open <code>/21-channel-mix-poas-dashboard/</code>.`;
  }
}

function setControl(control, value, seg, btn) {
  options[control] = control === "incremental" ? value === "on" : value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  if (!campaigns) return;
  const d = buildDashboard({ campaigns }, options);
  $("fileInfo").innerHTML = `<strong>${d.rows.length}</strong> channels · <strong>${eur(d.blended.spend)}</strong> ad spend · <strong>${eur(d.blended.revenue)}</strong> revenue · breakeven ROAS <strong>${d.breakevenRoas}×</strong> <span style="color:var(--muted)">(shared-data)</span>`;
  renderMetrics(d);
  renderContrib(d);
  renderBlended(d);
  renderChannels(d);
  renderInsight(d);
}

function renderMetrics(d) {
  const m = d.metrics;
  const cards = [
    ["Ad spend", eur(m.spend), ""],
    ["Revenue", eur(m.revenue), ""],
    ["Blended ROAS", m.blendedRoas + "×", "good"],
    ["Blended POAS", m.blendedPoas + "×", m.blendedPoas >= 1 ? "good" : "bad"],
    ["Net contribution", eur(m.contribution), m.contribution >= 0 ? "good" : "bad"],
    ["Unprofitable channels", m.unprofitableChannels, m.unprofitableChannels ? "bad" : "good"],
    ["Top channel", cap(m.bestChannel), "good", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(String(v))}</dd></div>`).join("");
}

function renderContrib(d) {
  const key = options.incremental ? "incContribution" : "contribution";
  const rows = d.rows.slice().sort((a, b) => b[key] - a[key]);
  const max = Math.max(...rows.map((r) => Math.abs(r[key])), 1);
  $("contrib").innerHTML = rows.map((r) => {
    const v = r[key], w = (Math.abs(v) / max) * 50;
    const fill = v >= 0 ? `<span class="div-fill pos" style="width:${w}%"></span>` : `<span class="div-fill neg" style="width:${w}%"></span>`;
    return `<div class="div-row">
      <span class="div-ch">${esc(cap(r.channel))}</span>
      <span class="div-track"><span class="div-mid"></span>${fill}</span>
      <span class="div-val ${v >= 0 ? "pos" : "neg"}">${eur(v)}</span>
    </div>`;
  }).join("");
  $("contribNote").innerHTML = options.incremental
    ? `Incrementality lens on: owned/branded channels discounted to their <em>incremental</em> contribution.`
    : `Two channels are below zero — money-losing after cost of goods, yet both show a positive ROAS.`;
}

function renderBlended(d) {
  const b = d.blended;
  $("blended").innerHTML = `
    <dt>Blended ROAS</dt><dd>${b.roas}×</dd>
    <dt>Blended POAS</dt><dd>${b.poas}×</dd>
    <dt>Net contribution</dt><dd style="color:var(--good)">${eur(b.contribution)}</dd>
    <dt>Margin rate</dt><dd>${Math.round(b.marginRate * 100)}%</dd>
    <dt>Breakeven ROAS</dt><dd>${b.breakevenRoas}×</dd>`;
  const lost = d.unprofitable.reduce((s, r) => s + (options.incremental ? r.incContribution : r.contribution), 0);
  $("callout").innerHTML = d.unprofitable.length
    ? `The blended <b>${b.poas}× POAS</b> looks healthy — but <b>${d.unprofitable.length} channel(s)</b> lose <b>${eur(Math.abs(lost))}</b>. Optimise to the blended number and you'd keep funding them.`
    : `All channels clear breakeven at these settings.`;
}

function renderChannels(d) {
  const key = options.incremental && options.rankBy === "contribution" ? "incContribution" : options.rankBy;
  const rows = d.rows.slice().sort((a, b) => b[key] - a[key]);
  const incCol = options.incremental;
  $("channels").innerHTML = `<thead><tr>
      <th>Channel</th><th>Spend</th><th>Revenue</th><th>ROAS</th><th>POAS</th><th>Contribution</th>${incCol ? "<th>Incremental</th>" : ""}<th>CPA</th>
    </tr></thead><tbody>${rows.map((r) => {
    const bad = options.incremental ? !r.incProfitable : !r.profitable;
    const trap = r.roas >= 1.5 && r.poas < 1;
    return `<tr class="${bad ? "bad" : ""}">
      <td class="ch">${esc(cap(r.channel))}${trap ? ' <span class="roas-trap">ROAS trap</span>' : ""}</td>
      <td>${eur(r.spend)}</td>
      <td>${eur(r.revenue)}</td>
      <td>${r.roas}×</td>
      <td><span class="poas-pill ${r.poas >= 1 ? "ok" : "no"}">${r.poas}×</span></td>
      <td>${eur(r.contribution)}</td>
      ${incCol ? `<td>${eur(r.incContribution)}</td>` : ""}
      <td>${eur(r.cpa)}</td>
    </tr>`;
  }).join("")}</tbody>`;
}

function renderInsight(d) {
  const traps = d.roasTraps;
  const best = d.ranked[0];
  const worst = d.rows.slice().sort((a, b) => a.contribution - b.contribution)[0];
  $("insight").innerHTML = `
    <p>Blended POAS is a healthy <b>${d.blended.poas}×</b>, so a top-line report says "keep spending". But a channel only makes money above <b>${d.breakevenRoas}× ROAS</b> (1 ÷ ${Math.round(d.blended.marginRate * 100)}% margin) — and <b>${cap(worst.channel)}</b> returns <b>${eur(worst.contribution)}</b>${traps.length ? `, while <b>${cap(traps[0].channel)}</b> is the classic trap: ${traps[0].roas}× ROAS looks fine but its ${traps[0].poas}× POAS means it loses money` : ""}.</p>
    <p>The move: fund on <b>POAS and contribution</b>, not ROAS. Cut or fix the sub-breakeven channels, scale <b>${cap(best.channel)}</b>, and apply an incrementality haircut before crowning owned/branded channels — otherwise you're paying to capture demand you already had (the same bias as the attribution and consent-mode tools).</p>`;
}

init();
