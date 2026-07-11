// UI for the Affiliate Tracking Simulator. All logic lives in simulator.js.
import { parseJsonl, buildModel, simulate } from "./simulator.js";

const EVENTS = "../shared-data/events/";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => "€" + Number(x).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const num = (x) => Number(x).toLocaleString("en-US");
const shortTime = (iso) => iso.replace("T", " ").replace("Z", "").slice(5, 16); // MM-DD HH:MM

const STATUS_LABEL = {
  approved: "Approved", approved_deduped: "Approved (deduped)", approved_flagged: "Approved (flagged)",
  rejected_return: "Rejected — return", rejected_suspicious: "Rejected — suspicious",
  rejected_cross_channel: "Rejected — cross-channel", rejected_outside_window: "Rejected — outside window",
  lost_cookie: "Lost — cookie", non_affiliate: "Non-affiliate",
};

let model = null;
let options = { windowDays: 30, rule: "last_affiliate", cookieLoss: 0, validation: "strict" };

async function fetchJsonl(name) {
  const r = await fetch(EVENTS + name);
  if (!r.ok) throw new Error(r.status + " " + name);
  return parseJsonl(await r.text());
}

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));

  try {
    const [clicks, web, conversions] = await Promise.all([
      fetchJsonl("affiliate-clicks.jsonl"),
      fetchJsonl("web-events.jsonl"),
      fetchJsonl("conversions.jsonl"),
    ]);
    model = buildModel({ clicks, web, conversions });
    $("fileInfo").innerHTML = `Loaded: <strong>${num(clicks.length)}</strong> affiliate clicks · <strong>${num(web.length)}</strong> web events · <strong>${num(conversions.length)}</strong> conversions <span style="color:var(--muted)">(shared-data)</span>`;
    render();
  } catch (err) {
    $("fileInfo").innerHTML = `Couldn't load event data (<code>${esc(EVENTS)}</code>). Serve the repo from its <strong>root</strong> and open <code>/06-affiliate-tracking-simulator/</code>.`;
  }
}

function setControl(control, value, seg, btn) {
  options[control] = control === "windowDays" ? Number(value) : control === "cookieLoss" ? Number(value) : value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  if (!model) return;
  const sim = simulate(model, options);
  renderMetrics(sim.metrics);
  renderJourneys(sim.journeys);
  renderQueue(sim.queue);
  renderDedup(sim.dedup);
  renderFraud(sim.fraud);
  renderImpact(sim.impact);
}

function renderMetrics(m) {
  const cards = [
    ["Affiliate clicks", num(m.affiliateClicks), ""],
    ["Conversions", num(m.conversions), ""],
    ["Tracked", num(m.trackedConversions), "good"],
    ["Lost", num(m.lostConversions), "bad"],
    ["Approved commission", eur(m.approvedCommission), "good"],
    ["Rejected commission", eur(m.rejectedCommission), "bad"],
    ["Overpayment prevented", eur(m.overpaymentPrevented), "warn"],
  ];
  $("metrics").innerHTML = cards
    .map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
}

function renderJourneys(journeys) {
  if (!journeys.length) { $("journeys").innerHTML = "<p>No journeys to show.</p>"; return; }
  $("journeys").innerHTML = journeys.map((j) => `
    <div class="journey">
      <h4>${esc(j.order_id)} · ${esc(j.visitor_id)}
        <span class="status-pill s-${j.status}">${esc(STATUS_LABEL[j.status] || j.status)}</span></h4>
      <p class="verdict" style="color:var(--muted)">${esc(j.reason)} ${j.attributed ? "→ credited to " + esc(j.winner) : ""}</p>
      <ul class="steps">
        ${j.steps.map((s) => `<li><time>${esc(shortTime(s.t))}</time><span class="dot ${esc(s.kind)}"></span><span>${esc(s.label)}</span></li>`).join("")}
      </ul>
    </div>`).join("");
}

function renderQueue(queue) {
  const order = ["approved", "approved_deduped", "approved_flagged", "rejected_return",
    "rejected_suspicious", "rejected_cross_channel", "rejected_outside_window", "lost_cookie", "non_affiliate"];
  const rows = order.filter((s) => queue[s] && queue[s].length).map((s) => {
    const items = queue[s];
    const example = items[0];
    return `<div class="queue-row">
      <span><span class="status-pill s-${s}">${esc(STATUS_LABEL[s] || s)}</span>
        <span style="color:var(--muted);font-size:12px"> — ${esc(example.reason)}</span></span>
      <span class="queue-count">${items.length}</span>
    </div>`;
  }).join("");
  $("queue").innerHTML = rows || "<p>No conversions.</p>";
}

function renderDedup(dedup) {
  if (!dedup.length) { $("dedup").innerHTML = "<tbody><tr><td>No competing claims under the current window.</td></tr></tbody>"; return; }
  $("dedup").innerHTML = `<thead><tr><th>Order</th><th>Publishers claiming</th><th>Winner</th><th>Outcome</th></tr></thead>
    <tbody>${dedup.map((d) => `<tr>
      <td>${esc(d.order_id)}</td>
      <td>${esc(d.publishers.join(", "))}</td>
      <td>${esc(d.winner)}</td>
      <td>${esc(STATUS_LABEL[d.status] || d.status)}</td>
    </tr>`).join("")}</tbody>`;
}

function renderFraud(fraud) {
  $("fraud").innerHTML = fraud.map((p) => `
    <div class="fraud-card ${p.flagged ? "flagged" : ""}">
      <h4>${esc(p.publisher_name)} <span style="font-size:12px;color:var(--muted)">${esc(p.publisher_id)}</span></h4>
      <div style="font-size:12.5px;color:var(--muted)">${num(p.clicks)} clicks · ${num(p.visitors)} visitors · ${num(p.validConversions)} valid conversions</div>
      ${p.signals.length ? `<ul class="signals">${p.signals.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      <p class="verdict">${esc(p.verdict)}</p>
    </div>`).join("");
}

function renderImpact(impact) {
  const wc = impact.windowComparison;
  $("impact").innerHTML = `
    <div class="impact-card loss">
      <p>Undercounted revenue (cookie loss)</p>
      <div class="big">${eur(impact.undercountedRevenue)}</div>
      <p>Affiliate-influenced sales not credited — ${eur(impact.undercountedCommission)} in commission the publisher never sees.</p>
    </div>
    <div class="impact-card saved">
      <p>Overpayment prevented</p>
      <div class="big">${eur(impact.overpaymentPrevented)}</div>
      <p>Commission blocked by validation and dedup: returns, flagged publishers, and duplicate claims.</p>
    </div>
    <div class="impact-card">
      <p>Attribution window changes the bill</p>
      <div class="win-cmp">
        <span>1d <b>${eur(wc[1].approvedCommission)}</b></span>
        <span>7d <b>${eur(wc[7].approvedCommission)}</b></span>
        <span>30d <b>${eur(wc[30].approvedCommission)}</b></span>
      </div>
      <p style="margin-top:6px">Approved commission at each window under the current rule — the window is a commercial choice, not a detail.</p>
    </div>`;
}

init();
