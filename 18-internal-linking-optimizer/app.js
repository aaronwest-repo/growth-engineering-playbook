// UI for the Internal Linking Optimizer. All logic lives in linking.js.
import { optimize, REASON_LABELS } from "./linking.js";
import { CORPUS } from "./corpus.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const R = optimize(CORPUS);
let cluster = "all";
let reason = "all";
let selectedUrl = null;

function init() {
  $("clusterSelect").innerHTML = `<option value="all">All clusters</option>` +
    R.clusters.map((c) => `<option value="${esc(c.topic)}">${esc(c.topic)} (${c.size})</option>`).join("");
  $("clusterSelect").value = cluster; // pin to JS state (ignore any browser-restored value)
  $("clusterSelect").addEventListener("change", (e) => { cluster = e.target.value; render(); });
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => { reason = b.dataset.value; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); render(); })));
  selectedUrl = R.orphans[0]?.url || R.pages[0].url;
  render();
}

function reasonMatch(s) {
  if (reason === "all") return true;
  if (reason === "pillar") return s.reason === "link_to_pillar" || s.reason === "pillar_to_member";
  return s.reason === reason;
}
function clusterMatch(s) {
  if (cluster === "all") return true;
  return R.topicOf[s.from] === cluster || R.topicOf[s.to] === cluster;
}

function render() {
  renderMetrics();
  renderClusters();
  renderOrphans();
  renderSuggestions();
  renderDetail();
}

function renderMetrics() {
  const m = R.metrics;
  const cards = [
    ["Pages", m.pages, ""],
    ["Clusters", m.clusters, ""],
    ["Internal links", m.internalLinks, ""],
    ["Orphan pages", m.orphanPages, m.orphanPages ? "bad" : "good"],
    ["Suggested links", m.suggestions, "good"],
    ["Avg out-links", m.avgOutLinks, m.avgOutLinks < 1 ? "warn" : ""],
    ["Pillars", m.pillars, ""],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");
}

function renderClusters() {
  $("clusters").innerHTML = R.clusters.map((c) => `
    <li data-topic="${esc(c.topic)}" aria-selected="${c.topic === cluster}">
      <div class="cl-top"><span class="cl-name">${esc(c.topic)}</span><span class="cl-h ${c.healthy ? "ok" : "bad"}">${c.healthy ? "healthy" : "needs work"}</span></div>
      <div class="cl-sub">Pillar: <b>${esc(c.pillarTitle)}</b> · ${c.size} pages · ${c.internalLinks} internal links · pillar inbound ${c.pillarInbound}${c.orphans.length ? ` · <span style="color:var(--warn)">${c.orphans.length} orphan(s)</span>` : ""}</div>
    </li>`).join("");
  $("clusters").querySelectorAll("li").forEach((li) =>
    li.addEventListener("click", () => { cluster = cluster === li.dataset.topic ? "all" : li.dataset.topic; $("clusterSelect").value = cluster; render(); }));
}

function renderOrphans() {
  const list = R.orphans.filter((o) => cluster === "all" || o.topic === cluster);
  $("orphans").innerHTML = list.length ? list.map((o) => `
    <li data-url="${esc(o.url)}">
      <div class="t">${esc(o.title)} <span class="url">${esc(o.url)}</span></div>
      <div class="rec">${o.recommendedFrom ? `Link from <b>${esc(R.byUrl[o.recommendedFrom]?.title || o.recommendedFrom)}</b>` : "No obvious source — add to a hub page"}</div>
    </li>`).join("") : "<p class='section-sub' style='color:var(--good)'>✓ No orphan pages in this view.</p>";
  $("orphans").querySelectorAll("li").forEach((li) => li.addEventListener("click", () => { selectedUrl = li.dataset.url; render(); }));
}

function renderSuggestions() {
  const rows = R.suggestions.filter((s) => reasonMatch(s) && clusterMatch(s));
  $("sugTitle").textContent = `Link Suggestions — ${rows.length}`;
  $("suggestions").innerHTML = `<thead><tr>
      <th>Add link</th><th>Why</th><th class="n">Strength</th><th>Shared terms</th>
    </tr></thead><tbody>${rows.slice(0, 40).map((s) => `
      <tr data-url="${esc(s.from)}">
        <td><strong>${esc(s.fromTitle)}</strong> <span class="arrow">→</span> ${esc(s.toTitle)}${s.crossCluster ? ' <span class="terms">(cross-cluster)</span>' : ""}<br><span class="url">${esc(s.from)} → ${esc(s.to)}</span></td>
        <td><span class="rtag ${s.reason}">${esc(REASON_LABELS[s.reason])}</span></td>
        <td class="n"><span class="str">${s.strength.toFixed(2)}</span></td>
        <td class="terms">${esc(s.shared.slice(0, 4).join(", ") || "—")}</td>
      </tr>`).join("")}</tbody>`;
  $("suggestions").querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => { selectedUrl = tr.dataset.url; render(); }));
}

function renderDetail() {
  const p = R.byUrl[selectedUrl];
  if (!p) { $("detail").innerHTML = "<p class='section-sub'>Select a page.</p>"; return; }
  const linkList = (arr, add) => arr.length
    ? `<ul class="lnk">${arr.map((x) => `<li>${add ? '<span class="add">+</span>' : ""}${esc(add ? (R.byUrl[x.to]?.title || x.to) : (R.byUrl[x]?.title || x))}${add ? ` <span class="rtag ${x.reason}" style="margin-left:6px">${esc(REASON_LABELS[x.reason])}</span>` : ""}<br><span class="url">${esc(add ? x.to : x)}</span></li>`).join("")}</ul>`
    : "<p class='section-sub'>None.</p>";
  $("detail").innerHTML = `
    <dl class="pd-meta">
      <dt>Page</dt><dd><strong>${esc(p.title)}</strong> <span class="url">${esc(p.url)}</span></dd>
      <dt>Cluster</dt><dd>${esc(p.topic)}${p.pillar ? ' <span class="rtag link_to_pillar">pillar</span>' : ""}</dd>
      <dt>Inbound</dt><dd>${p.inbound}${p.inbound === 0 ? ' <span style="color:var(--bad)">(orphan)</span>' : ""}</dd>
      <dt>Words</dt><dd>${p.words}</dd>
    </dl>
    <h4 style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">Current outbound links (${p.outLinks.length})</h4>
    ${linkList(p.outLinks, false)}
    <h4 style="margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">Suggested links to add (${p.suggestionsOut.length})</h4>
    ${linkList(p.suggestionsOut, true)}`;
}

init();
