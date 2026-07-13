// UI for the GEO / AEO Content Checker. All logic lives in geo.js.
import { analyze } from "./geo.js";
import { SAMPLES } from "./samples.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const gcls = (n) => (n >= 70 ? "70" : n >= 50 ? "50" : "0");

function init() {
  $("sampleSelect").innerHTML = SAMPLES.map((s, i) => `<option value="${i}">${esc(s.title)}</option>`).join("");
  $("content").value = SAMPLES[0].text;
  $("sampleSelect").addEventListener("change", (e) => { $("content").value = SAMPLES[Number(e.target.value)].text; render(); });
  $("content").addEventListener("input", render);
  $("question").addEventListener("input", render);
  render();
}

function render() {
  const a = analyze($("content").value, { targetQuestion: $("question").value });
  renderMetrics(a);
  renderBreakdown(a);
  renderSnippets(a);
  renderRecs(a);
  renderSchema(a);
  renderCoverage(a);
  renderOutline(a);
}

function renderMetrics(a) {
  const dim = (k) => a.dimensions.find((d) => d.key === k).score;
  const overallCls = a.overall >= 70 ? "good" : a.overall >= 50 ? "warn" : "bad";
  const cards = [
    ["AEO score", `${a.overall} <span class="grade">${a.grade}</span>`, overallCls],
    ["Quotable sentences", a.quotableCount, a.quotableCount ? "good" : "bad"],
    ["Definitions", a.definitionCount, a.definitionCount ? "good" : "warn"],
    ["Question headings", dim("questionHeadings"), ""],
    ["Schema types", a.schema.length, ""],
    ["Words", a.stats.words, ""],
    ["Avg ¶ words", a.stats.avgParaWords, a.stats.avgParaWords <= 60 ? "good" : "warn"],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");
}

function renderBreakdown(a) {
  $("breakdown").innerHTML = a.dimensions.map((d) => `
    <div class="dim">
      <div class="top"><span>${esc(d.label)}</span><span class="s g${gcls(d.score)}">${d.score}</span></div>
      <div class="bar"><span class="bg${gcls(d.score)}" style="width:${d.score}%"></span></div>
      <p class="find">${esc(d.findings[0])}</p>
    </div>`).join("");
}

function renderSnippets(a) {
  if (!a.quotableSnippets.length) { $("snippets").innerHTML = "<p class='section-sub'>No clean, self-contained sentences to lift. Trim long sentences and avoid opening with “this / it / they”.</p>"; return; }
  $("snippets").innerHTML = a.quotableSnippets.map((s) => `
    <div class="snip ${esc(s.tag)}">${esc(s.text)}<span class="tag">${esc(s.tag)}</span></div>`).join("");
}

function renderRecs(a) {
  if (!a.recommendations.length) { $("recs").innerHTML = "<p class='section-sub' style='color:var(--good)'>✓ No high-impact issues — this page is well structured for answer engines.</p>"; return; }
  $("recs").innerHTML = `<ul class="rec-list">${a.recommendations.map((r) => `
    <li><span class="imp">+${r.impact}</span><span>${esc(r.text)}<br><span class="rec-dim">${esc(r.dim)}</span></span></li>`).join("")}</ul>`;
}

function renderSchema(a) {
  const faq = a.schema.find((s) => s.type === "FAQPage" && s.pairs);
  const ld = { "@context": "https://schema.org", "@type": "Article", headline: a.title };
  let snippet;
  if (faq) {
    snippet = {
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: faq.pairs.slice(0, 2).map((p) => ({ "@type": "Question", name: p.q, acceptedAnswer: { "@type": "Answer", text: p.a.slice(0, 120) + (p.a.length > 120 ? "…" : "") } })),
    };
  } else snippet = ld;
  $("schema").innerHTML = `
    <ul class="schema-list">${a.schema.map((s) => `<li><span class="t">${esc(s.type)}</span> — ${esc(s.reason)}</li>`).join("")}</ul>
    <pre>${esc(JSON.stringify(snippet, null, 2))}</pre>`;
}

function renderCoverage(a) {
  if (!a.coverage) { $("coverage").innerHTML = "<p class='section-sub'>Enter a target question above to check whether the page answers it early and quotably.</p>"; return; }
  const c = a.coverage;
  const cls = c.score >= 70 ? "good" : c.score >= 45 ? "warn" : "bad";
  $("coverage").innerHTML = `
    <p class="verdict ${cls}">${esc(c.verdict)} <span style="color:var(--muted);font-weight:400">(match ${c.matched}/${c.of} keywords · ${c.early ? "early" : "buried"} · ${c.quotable ? "quotable" : "not standalone"})</span></p>
    ${c.answer ? `<div class="ans">${esc(c.answer)}</div>` : ""}`;
}

function renderOutline(a) {
  if (!a.outline.length) { $("outline").innerHTML = "<p class='section-sub'>No subheadings found — add question-shaped H2s to segment answers.</p>"; return; }
  $("outline").innerHTML = `<ul class="outline">${a.outline.map((o) => `
    <li class="lvl${o.level}">
      <span class="flag ${o.isQuestion ? "q" : "noq"}">${o.isQuestion ? "Q" : "—"}</span>
      <span>${esc(o.text)}${!o.hasAnswerBelow ? ' <span style="color:var(--warn);font-size:11px">(no answer below)</span>' : ""}</span>
    </li>`).join("")}</ul>`;
}

init();
