// UI for the Cart Recovery Automation demo. All logic lives in automation.js.
import { parseJsonl, parseCsv, buildModel, run } from "./automation.js";

const CARTS_URL = "../shared-data/events/cart-events.jsonl";
const PRODUCTS_URL = "../shared-data/catalog/products-clean.csv";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => "€" + Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 });
const num = (x) => Number(x).toLocaleString("en-US");
const shortTime = (iso) => String(iso).replace("T", " ").replace("Z", "").slice(5, 16);
const STATUS = { recovered: "Recovered", sent: "Sent", suppressed: "Suppressed", failed: "Failed", held_for_approval: "Held for approval" };

let model = null;
let options = { delayMinutes: 120, maxRetries: 3, approvalMode: "auto", suppression: "basic" };
const approvals = new Set();

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status + " " + url);
  return r.text();
}

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  try {
    const [cartsText, productsText] = await Promise.all([fetchText(CARTS_URL), fetchText(PRODUCTS_URL)]);
    model = buildModel({ carts: parseJsonl(cartsText), products: parseCsv(productsText) });
    $("fileInfo").innerHTML = `Loaded: <strong>${num(model.carts.length)}</strong> abandoned carts · <strong>${num(Object.keys(model.productsById).length)}</strong> catalog products <span style="color:var(--muted)">(shared-data)</span>`;
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load cart data (<code>${esc(CARTS_URL)}</code>). Serve the repo from its <strong>root</strong> and open <code>/07-cart-recovery-automation/</code>.`;
  }
}

function setControl(control, value, seg, btn) {
  options[control] = control === "delayMinutes" || control === "maxRetries" ? Number(value) : value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  if (!model) return;
  const res = run(model, options, approvals);
  renderMetrics(res.metrics);
  renderTimeline(res.timeline);
  renderEmail(res.email);
  renderDecisions(res.decisionLog);
  renderErrorRetry(res.errorRetry);
  renderApproval(res.approvalQueue);
  renderImpact(res.impact);
}

function renderMetrics(m) {
  const cards = [
    ["Carts entered", num(m.cartsEntered), ""],
    ["Eligible", num(m.eligible), ""],
    ["Suppressed", num(m.suppressed), "warn"],
    ["Emails sent", num(m.emailsSent), ""],
    ["Recovered orders", num(m.recoveredOrders), "good"],
    ["Recovered revenue", eur(m.recoveredRevenue), "good"],
    ["Failures / retries", `${m.failures} / ${m.retries}`, "bad"],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

function renderTimeline(t) {
  if (!t) { $("timeline").innerHTML = "<p class='empty'>No workflow to show.</p>"; return; }
  $("timeline").innerHTML = `
    <div style="margin-bottom:8px"><strong>${esc(t.cart_id)}</strong> <span class="status-pill s-${t.status}">${esc(STATUS[t.status] || t.status)}</span></div>
    <ul class="steps">
      ${t.steps.map((s) => `<li><time>${esc(shortTime(s.t))}</time><span class="dot ${esc(s.kind)}"></span><span>${esc(s.label)}</span></li>`).join("")}
    </ul>`;
}

function renderEmail(e) {
  if (!e) { $("email").innerHTML = "<div class='panel empty'>No eligible cart to render.</div>"; return; }
  $("email").innerHTML = `
    <div class="email">
      <div class="bar">To: ${esc(e.to)} · <span style="color:var(--muted)">(hashed token — no real address)</span></div>
      <div class="body">
        <p class="subject">${esc(e.subject)}</p>
        <p class="preheader">${esc(e.preheader)}</p>
        <ul class="items">${e.products.map((p) => `<li><span>${esc(p.title)}</span><span>${esc(p.price)}</span></li>`).join("")}</ul>
        <div class="total">Cart total: ${esc(e.cartValue)}</div>
        <p style="margin:12px 0 0"><span class="cta">${esc(e.cta)}</span></p>
      </div>
    </div>`;
}

function renderDecisions(log) {
  $("decisions").innerHTML = log.map((d) => `
    <div class="decision-row">
      <span>${esc(d.rule)}<br><span class="d">${esc(d.detail)}</span></span>
      <span class="c">${num(d.count)}</span>
    </div>`).join("") || "<p class='empty'>No decisions.</p>";
}

function renderErrorRetry(er) {
  if (!er) { $("errorRetry").innerHTML = "<p class='empty'>No provider errors in this scenario.</p>"; return; }
  $("errorRetry").innerHTML = `
    <div><strong>${esc(er.cart_id)}</strong> · ${esc(STATUS[er.status] || er.status)} · ${er.attempts} attempt(s), ${er.retries} retry(ies)</div>
    <ul class="retry-tl">
      ${er.schedule.map((s) => `<li><span>Attempt ${s.attempt} · ${esc(shortTime(s.at))}</span><span class="${s.result === "accepted" ? "ok" : "err"}">${esc(s.result)}</span></li>`).join("")}
    </ul>
    <div class="alert">⚠ ${esc(er.alert)}</div>`;
}

function renderApproval(queue) {
  if (!queue.length) {
    $("approval").innerHTML = `<p class="empty">${options.approvalMode === "human" ? "No high-value carts awaiting approval." : "Auto-send mode — no approval gate active. Switch to Human approval to see high-value carts held."}</p>`;
    return;
  }
  $("approval").innerHTML = queue.map((c) => `
    <div class="approval-row">
      <span><strong>${esc(c.cart_id)}</strong> · ${esc(eur(c.cart_value))} · ${c.items} item(s)</span>
      <button class="btn-approve" data-cart="${esc(c.cart_id)}">Approve &amp; send</button>
    </div>`).join("");
  $("approval").querySelectorAll(".btn-approve").forEach((b) =>
    b.addEventListener("click", () => { approvals.add(b.dataset.cart); render(); }));
}

function renderImpact(i) {
  $("impact").innerHTML = `
    <div class="impact-card saved"><p>Recovered revenue</p><div class="big">${eur(i.recoveredRevenue)}</div><p>${num(i.recoveredOrders)} orders brought back by the workflow.</p></div>
    <div class="impact-card guard"><p>Bad sends avoided</p><div class="big">${num(i.avoidedBadSends)}</div><p>Emails suppressed after purchase or without consent.</p></div>
    <div class="impact-card caught"><p>Failures caught</p><div class="big">${num(i.failuresCaught)}</div><p>Provider failures escalated, not lost silently.</p></div>
    <div class="impact-card"><p>Total suppressed</p><div class="big">${num(i.suppressed)}</div><p>Strict suppression trades recovery volume for cleaner, safer sending.</p></div>`;
}

init();
