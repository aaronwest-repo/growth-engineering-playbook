// UI for the Customer Support Insight Miner. All logic lives in support.js.
import { parseCsv, buildInsights, insightDetail } from "./support.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (x) => Number(x).toLocaleString("en-US");
const sentCls = (s) => (s === "negative" ? "tag-neg" : s === "positive" ? "tag-pos" : "tag-neu");

let model = null;
let selection = null;

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  try {
    const [ts, cs, os, ps] = await Promise.all([
      fetchText("../shared-data/customers/support-tickets.csv"),
      fetchText("../shared-data/customers/customers.csv"),
      fetchText("../shared-data/customers/orders.csv"),
      fetchText("../shared-data/catalog/products-clean.csv"),
    ]);
    model = buildInsights({ tickets: parseCsv(ts), customers: parseCsv(cs), orders: parseCsv(os), products: parseCsv(ps) });
    $("fileInfo").innerHTML = `Mined <strong>${num(model.metrics.totalTickets)}</strong> support tickets · <strong>${num(model.metrics.affectedCustomers)}</strong> customers · <strong>${model.themes.length}</strong> themes across <strong>${model.categories.length}</strong> categories <span style="color:var(--muted)">(shared-data)</span>`;
    selection = { kind: "theme", key: model.themes[0].theme };
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load data. Serve the repo from its <strong>root</strong> and open <code>/12-customer-support-insight-miner/</code>.`;
  }
}

function render() {
  renderMetrics(model.metrics);
  renderThemes();
  renderHeatmap();
  renderContentGaps();
  renderAutomations();
  renderActions();
  renderRisk();
  renderInsight();
}

function renderMetrics(m) {
  const cards = [
    ["Total tickets", num(m.totalTickets), ""],
    ["Open / pending", num(m.openTickets), "warn"],
    ["Negative", num(m.negativeTickets), "bad"],
    ["High urgency", num(m.highUrgency), "bad"],
    ["Affected customers", num(m.affectedCustomers), ""],
    ["Top category issue", m.topCategoryIssue, "warn", true],
    ["Automation candidates", num(m.automationCandidates), "good"],
    ["Content gaps", num(m.contentGaps), "warn"],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(v)}</dd></div>`).join("");
}

function renderThemes() {
  $("themes").innerHTML = model.themes.map((t) => {
    const total = t.count || 1;
    const seg = (n, cls) => (n > 0 ? `<span class="${cls}" style="width:${(n / total) * 100}%"></span>` : "");
    return `<div class="theme-row" data-kind="theme" data-key="${t.theme}" aria-selected="${isSel("theme", t.theme)}">
      <span class="tl" title="${esc(t.label)}">${esc(t.label)}</span>
      <span class="sbar" title="neg ${t.sentiment.negative} · neu ${t.sentiment.neutral} · pos ${t.sentiment.positive}">
        ${seg(t.sentiment.negative, "sbar-neg")}${seg(t.sentiment.neutral, "sbar-neu")}${seg(t.sentiment.positive, "sbar-pos")}
      </span>
      <span class="ct">${t.count}${t.urgency.high ? `<br><span class="hi">${t.urgency.high}⚡</span>` : ""}</span>
    </div>`;
  }).join("");
  bindSelect("#themes .theme-row");
}

function renderHeatmap() {
  const max = Math.max(...model.categories.map((c) => c.count), 1);
  const rows = model.categories.map((c) => {
    const bg = `rgba(79,156,249,${(0.12 + (c.count / max) * 0.5).toFixed(2)})`;
    return `<tr data-kind="category" data-key="${esc(c.category)}" aria-selected="${isSel("category", c.category)}">
      <td>${esc(c.category)}</td>
      <td><span class="cell" style="background:${bg}">${c.count}</span></td>
      <td class="${c.negShare >= 50 ? "neg-hi" : ""}">${c.negShare}%</td>
      <td>${c.returnCount || "·"}</td>
      <td>${c.sizingCount || "·"}</td>
      <td>${c.warrantyCount || "·"}</td>
      <td>${c.careCount || "·"}</td>
    </tr>`;
  }).join("");
  $("heatmap").innerHTML = `<table class="heat"><thead><tr>
      <th>Category</th><th>Tickets</th><th>Neg%</th><th>Returns</th><th>Size</th><th>Warranty</th><th>Care</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  bindSelect("#heatmap tbody tr");
}

function renderContentGaps() {
  $("contentGaps").innerHTML = model.contentGaps.length
    ? `<ul class="ilist">${model.contentGaps.map((g) => `<li>
        <div class="top"><span class="name">${esc(g.label)}</span><span class="cnt">${g.count}</span></div>
        <p class="desc">${esc(g.rec)}</p><span class="owner">${esc(g.owner)}</span>
      </li>`).join("")}</ul>`
    : `<p class="section-sub">No recurring content gaps above threshold.</p>`;
}

function renderAutomations() {
  $("automations").innerHTML = `<ul class="ilist">${model.automations.map((a) => `<li>
      <div class="top"><span class="name">${esc(a.name)}</span><span class="cnt">${a.count}</span></div>
      <p class="desc">${esc(a.detail)}</p><span class="owner">${esc(a.owner)}</span>
    </li>`).join("")}</ul>`;
}

function renderActions() {
  $("actions").innerHTML = `<thead><tr>
      <th>Priority</th><th>Owner</th><th>Action</th><th class="sig">Signal</th>
    </tr></thead><tbody>${model.actions.map((a) => `<tr>
      <td><span class="prio ${a.priority}">${esc(a.priority)}</span></td>
      <td>${esc(a.owner)}</td>
      <td><strong>${esc(a.title)}</strong><br><span class="section-sub">${esc(a.recommendation)}</span></td>
      <td class="sig">${a.signal}</td>
    </tr>`).join("")}</tbody>`;
}

function renderRisk() {
  const rows = model.riskCustomers.slice(0, 12).map((c) => `<tr data-kind="customer" data-key="${esc(c.customer_id)}" aria-selected="${isSel("customer", c.customer_id)}">
    <td>${esc(c.first_name)} <span style="color:var(--muted)">${esc(c.customer_id)}</span></td>
    <td>${c.tickets}</td>
    <td class="${c.negatives ? "flag" : ""}">${c.negatives || "·"}</td>
    <td class="${c.returns ? "flag" : ""}">${c.returns || "·"}</td>
    <td style="text-align:left;color:var(--muted)">${esc(c.recommendation)}</td>
  </tr>`).join("");
  $("risk").innerHTML = `<table class="risk"><thead><tr>
      <th>Customer</th><th>Tickets</th><th>Neg</th><th>Returns</th><th style="text-align:left">Lifecycle recommendation</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <p class="section-sub" style="margin:10px 0 0">${model.multiTicketCustomers} customers have 2+ tickets · showing top ${Math.min(12, model.riskCustomers.length)} by risk score.</p>`;
  bindSelect("#risk tbody tr");
}

function renderInsight() {
  const d = insightDetail(model, selection);
  if (!d) { $("insight").innerHTML = "<p class='section-sub'>Select a theme, category, or customer.</p>"; return; }
  const snips = d.examples.map((e) => `<div class="snip">
    <div class="sh"><span class="subj">${esc(e.subject)}</span><span class="meta"><span class="${sentCls(e.sentiment)}">${esc(e.sentiment)}</span> · ${esc(e.urgency)} · ${esc(e.status)}</span></div>
    <p class="msg">${esc(e.message)}</p>
    <div class="prod">${esc(e.product)} · ${esc(e.category)} · ${esc(e.ticket_id)}</div>
  </div>`).join("");
  $("insight").innerHTML = `
    <div class="ihead"><h3>${esc(d.title)}</h3>
      <span class="stat">${d.count} tickets · ${d.affected} customers · ${d.negShare}% negative</span></div>
    <p class="why">${esc(d.why)}</p>
    ${snips || "<p class='section-sub'>No example tickets.</p>"}`;
}

// --- selection helpers -----------------------------------------------------
function isSel(kind, key) { return selection && selection.kind === kind && selection.key === key; }
function bindSelect(sel) {
  document.querySelectorAll(sel).forEach((el) =>
    el.addEventListener("click", () => { selection = { kind: el.dataset.kind, key: el.dataset.key }; render(); }));
}

init();
