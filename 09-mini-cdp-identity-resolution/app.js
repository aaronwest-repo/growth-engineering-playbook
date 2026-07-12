// UI for the Mini CDP Identity Resolution demo. All logic lives in cdp.js.
import { parseCsv, parseJsonl, buildModel, resolve } from "./cdp.js";

const C = "../shared-data/customers/";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (x) => Number(x).toLocaleString("en-US");
const eur = (x) => "€" + Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 });

let model = null;
let options = { mode: "balanced", respectConsent: true };
let current = null; // resolve() result
let selectedProfileId = null;

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  $("profileSelect").addEventListener("change", (e) => { selectedProfileId = e.target.value; renderProfile(); });

  try {
    const [cs, os, es, ts, we] = await Promise.all([
      fetchText(C + "customers.csv"), fetchText(C + "orders.csv"),
      fetchText(C + "email-events.csv"), fetchText(C + "support-tickets.csv"),
      fetchText("../shared-data/events/web-events.jsonl"),
    ]);
    model = buildModel({
      customers: parseCsv(cs), orders: parseCsv(os), emails: parseCsv(es),
      tickets: parseCsv(ts), webEvents: parseJsonl(we),
    });
    $("fileInfo").innerHTML = `Loaded: <strong>${num(model.customers.length)}</strong> customer records · <strong>${num(model.orders.length)}</strong> orders · <strong>${num(model.emails.length)}</strong> email events · <strong>${num(model.tickets.length)}</strong> tickets <span style="color:var(--muted)">(shared-data)</span>`;
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load customer data (<code>${esc(C)}</code>). Serve the repo from its <strong>root</strong> and open <code>/09-mini-cdp-identity-resolution/</code>.`;
  }
}

function setControl(control, value, seg, btn) {
  options[control] = control === "respectConsent" ? value === "respect" : value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  if (!model) return;
  current = resolve(model, options);
  renderMetrics(current.metrics);
  populateProfiles();
  renderProfile();
  renderMergeQueue(current.mergeQueue);
  renderFalseMerge(current);
  renderAudit(current.mergeQueue);
}

function renderMetrics(m) {
  const cards = [
    ["Raw records", num(m.rawRecords), ""],
    ["Candidate identities", num(m.candidateIdentities), ""],
    ["Resolved profiles", num(m.resolvedProfiles), "good"],
    ["Auto-merged", num(m.autoMerged), "good"],
    ["Needs review", num(m.needsReview), "warn"],
    ["Blocked merges", num(m.blockedMerges), "bad"],
    ["Consent conflicts", num(m.consentConflicts), "warn"],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");
}

function populateProfiles() {
  // Prefer merged profiles (they best show identity stitching), then by activity.
  const sorted = current.profiles.slice().sort((a, b) =>
    (b.merged - a.merged) || (b.orders.length + b.emails.length + b.tickets.length) - (a.orders.length + a.emails.length + a.tickets.length));
  if (!sorted.some((p) => p.profile_id === selectedProfileId)) selectedProfileId = sorted[0]?.profile_id || null;
  $("profileSelect").innerHTML = sorted.map((p) =>
    `<option value="${esc(p.profile_id)}">${esc(p.first_name)} · ${esc(p.country)} · ${p.recordIds.length} record(s)${p.merged ? " · merged" : ""}${p.orders.length ? " · " + p.orders.length + " orders" : ""}</option>`).join("");
  $("profileSelect").value = selectedProfileId || "";
}

function renderProfile() {
  const p = current?.profiles.find((x) => x.profile_id === selectedProfileId);
  if (!p) { $("identityGraph").innerHTML = "<p style='color:var(--muted)'>No profile.</p>"; $("segments").innerHTML = ""; return; }

  const confCls = p.merged ? "conf merged" : "conf";
  const evidence = current.mergeQueue.filter((d) => d.decision === "auto_merge" && d.records.every((id) => p.recordIds.includes(id)));
  $("identityGraph").innerHTML = `
    <div class="ig-head">
      <strong>${esc(p.first_name)} — ${esc(p.country)}/${esc(p.language)}</strong>
      <span class="${confCls}">${p.merged ? "merged" : "single"} · confidence ${(p.confidence * 100).toFixed(0)}%</span>
    </div>
    <div class="ig-node"><h4>Customer records (${p.recordIds.length})</h4><div class="chips">${p.recordIds.map((id) => `<span class="chip">${esc(id)}</span>`).join("")}</div>
      <div class="chips" style="margin-top:5px">${p.email_hashes.map((h) => `<span class="chip">${esc(h)}</span>`).join("") || '<span class="q-note">no email_hash</span>'}</div></div>
    <div class="ig-node"><h4>Orders (${p.orders.length}) · ${eur(p.revenue)} net</h4>
      <div class="chips">${p.orders.slice(0, 8).map((o) => `<span class="chip">${esc(o.order_id)} · ${eur(o.gross_revenue)}</span>`).join("") || '<span class="q-note">none</span>'}</div></div>
    <div class="ig-node"><h4>Email events (${p.emails.length})</h4>
      <div class="chips">${[...new Set(p.emails.map((e) => e.event_type))].map((t) => `<span class="chip">${esc(t)}</span>`).join("") || '<span class="q-note">none</span>'}</div></div>
    <div class="ig-node"><h4>Support tickets (${p.tickets.length})</h4>
      <div class="chips">${p.tickets.map((t) => `<span class="chip">${esc(t.theme)} · ${esc(t.sentiment)}</span>`).join("") || '<span class="q-note">none</span>'}</div></div>
    <div class="ig-node"><h4>Web sessions (device-graph, illustrative)</h4>
      <div class="chips">${p.webEvents.length ? p.webEvents.map((w) => `<span class="chip">${esc(w.event_type)}</span>`).join("") : '<span class="q-note">none stitched</span>'}</div></div>
    ${evidence.length ? `<p class="evidence">Merge evidence: ${evidence.map((e) => esc(e.evidence)).join("; ")}.</p>` : `<p class="evidence">Single record — no merge required.</p>`}`;

  // Segments + consent
  const segClass = (s) => s === "VIP" ? "vip" : /risk/.test(s) ? "risk" : "ok";
  $("segments").innerHTML = `
    <div>${p.segments.length ? p.segments.map((s) => `<span class="seg-chip ${segClass(s)}">${esc(s)}</span>`).join("") : '<span class="q-note">no segment yet</span>'}</div>
    <p class="consent-line">Net revenue: <b>${eur(p.revenue)}</b> · Loyalty: <b>${esc(p.loyalty)}</b></p>
    <p class="consent-line">Consent — marketing: <b>${p.consent.marketing ? "yes" : "no"}</b> · personalization: <b>${p.consent.personalization ? "yes" : "no"}</b> · newsletter: <b>${p.consent.newsletter ? "yes" : "no"}</b>${p.consent.conflict ? ' · <span style="color:var(--warn)">conflict resolved to most restrictive</span>' : ""}</p>`;
}

function renderMergeQueue(queue) {
  const shown = queue.filter((d) => d.decision !== "ignored_strict").slice(0, 14);
  const list = shown.length ? shown : queue.slice(0, 14);
  $("mergeQueue").innerHTML = list.map((d) => `
    <div class="q-row">
      <span class="dec dec-${d.decision}">${esc(d.decision.replace(/_/g, " "))}</span>
      <span>${esc(d.records.join(" ↔ "))}<br><span class="q-note">${esc(d.evidence)} — ${esc(d.consentNote)}</span></span>
      <span class="cf">${(d.confidence * 100).toFixed(0)}%</span>
    </div>`).join("") || "<p class='q-note'>No merge decisions.</p>";
}

function renderFalseMerge(res) {
  const risks = res.falseMergeRisks;
  const ex = risks[0];
  const mode = res.options.mode;
  let body = `<p>Two different people can share a first name and country. Merging them on that alone leaks one customer's data into another's profile — wrong personalization, mis-sent lifecycle emails, corrupted metrics. <strong>Aggressive</strong> mode merges on this weak evidence; <strong>balanced</strong> holds it for a human.</p>`;
  if (ex) {
    const merged = mode === "aggressive";
    body += `<div class="ex">
      <div>Example: <strong>${esc(ex.name)}</strong> in <strong>${esc(ex.country)}</strong> — records <code>${esc(ex.a)}</code> and <code>${esc(ex.b)}</code>, fuzzy score ${(ex.score * 100).toFixed(0)}%.</div>
      <div class="verdict ${merged ? "merge" : "hold"}">${merged ? "⚠ Aggressive mode MERGED these — likely a false merge." : "✓ Held for review — not auto-merged."}</div>
    </div>`;
  } else {
    body += `<div class="ex"><div class="q-note">No fuzzy candidates under the current mode (strict ignores weak matches entirely).</div></div>`;
  }
  $("falseMerge").innerHTML = body;
}

function renderAudit(queue) {
  const rows = queue.slice(0, 20);
  $("audit").innerHTML = `<thead><tr><th>Rule</th><th>Evidence</th><th class="cf">Conf.</th><th>Decision</th><th>Consent note</th></tr></thead>
    <tbody>${rows.map((d) => `<tr>
      <td>${esc(d.rule)}</td>
      <td>${esc(d.evidence)}</td>
      <td class="cf">${(d.confidence * 100).toFixed(0)}%</td>
      <td><span class="dec dec-${d.decision}">${esc(d.decision.replace(/_/g, " "))}</span></td>
      <td>${esc(d.consentNote)}</td>
    </tr>`).join("")}</tbody>`;
}

init();
