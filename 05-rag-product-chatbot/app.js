import { answerQuestion, buildCorpus, parseCsv } from "./rag.js";

const PRODUCT_URL = "../shared-data/catalog/products-clean.csv";
const DOCS = [
  "faq.md",
  "shipping-policy.md",
  "returns-policy.md",
  "warranty-policy.md",
  "size-guide.md",
  "sustainability-policy.md",
];

const examples = [
  "Can I return the Aurora Shell Jacket and how long is shipping?",
  "Which hiking shoe is sturdier, TrailForge Hiker or Cascade Trail Runner?",
  "Where is my order and tracking number?",
  "Is the Fjord Rain Jacket sustainable?",
  "Can you recommend a mountain tent with solar charging?",
];

const state = {
  corpus: [],
  products: [],
  docs: [],
  current: null,
};

const $ = (id) => document.getElementById(id);

async function init() {
  const [productText, ...docTexts] = await Promise.all([
    fetch(PRODUCT_URL).then((r) => r.text()),
    ...DOCS.map((name) => fetch(`../shared-data/content/${name}`).then((r) => r.text())),
  ]);
  state.products = parseCsv(productText);
  state.docs = DOCS.map((fileName, i) => ({ fileName, text: docTexts[i] }));
  state.corpus = buildCorpus(state.products, state.docs);

  $("corpusStats").innerHTML = `
    <strong>${state.products.length}</strong> products
    <span>-</span>
    <strong>${state.docs.length}</strong> policy docs
    <span>-</span>
    <strong>${state.corpus.length}</strong> chunks
  `;
  renderExamples();
  ask(examples[0]);
}

function renderExamples() {
  $("examples").innerHTML = examples.map((question, index) => `
    <button type="button" data-question="${escapeAttr(question)}" ${index === 0 ? 'aria-pressed="true"' : 'aria-pressed="false"'}>
      ${escapeHtml(question)}
    </button>
  `).join("");
}

function ask(question) {
  $("questionInput").value = question;
  state.current = answerQuestion(state.corpus, question);
  document.querySelectorAll("[data-question]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.question === question));
  });
  renderAnswer(question, state.current);
}

function renderAnswer(question, result) {
  const modeClass = result.mode === "rag" ? "good" : result.mode === "intent" ? "warn" : "bad";
  $("chat").innerHTML = `
    <article class="message user">
      <span>You</span>
      <p>${escapeHtml(question)}</p>
    </article>
    <article class="message bot ${modeClass}">
      <span>Northstar Assistant</span>
      <p>${escapeHtml(result.answer)}</p>
      ${result.citations.length ? renderCitations(result.citations) : ""}
    </article>
  `;

  $("router").innerHTML = `
    <div class="route-card ${modeClass}">
      <b>${labelForMode(result.mode)}</b>
      <span>${escapeHtml(result.intent.reason)}</span>
    </div>
    <dl>
      <div><dt>Intent</dt><dd>${result.intent.intent}</dd></div>
      <div><dt>Route confidence</dt><dd>${Math.round(result.intent.confidence * 100)}%</dd></div>
      <div><dt>Answer confidence</dt><dd>${Math.round(result.confidence * 100)}%</dd></div>
      <div><dt>Citations</dt><dd>${result.citations.length}</dd></div>
    </dl>
  `;

  $("retrieval").innerHTML = result.retrieval.length ? result.retrieval.map((chunk, index) => `
    <article class="chunk">
      <div>
        <b>${index + 1}. ${escapeHtml(chunk.title)}</b>
        <span>${escapeHtml(chunk.source)} - score ${chunk.score}</span>
      </div>
      <p>${escapeHtml(shorten(chunk.text, 260))}</p>
    </article>
  `).join("") : `
    <article class="chunk empty">
      <b>No retrieval context used</b>
      <p>This route did not use generative answering. It either refused or handed off to a transactional intent.</p>
    </article>
  `;
}

function renderCitations(citations) {
  return `
    <ul class="citations">
      ${citations.map((c) => `<li><strong>${escapeHtml(c.title)}</strong><span>${escapeHtml(c.source)}</span></li>`).join("")}
    </ul>
  `;
}

function labelForMode(mode) {
  if (mode === "rag") return "Answered from retrieved context";
  if (mode === "intent") return "Routed to a workflow intent";
  return "Refused because retrieval was weak";
}

$("examples").addEventListener("click", (event) => {
  const button = event.target.closest("[data-question]");
  if (button) ask(button.dataset.question);
});

$("askForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const question = $("questionInput").value.trim();
  if (question) ask(question);
});

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function shorten(value, max) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}

init().catch((error) => {
  $("chat").innerHTML = `<article class="message bot bad"><span>Error</span><p>${escapeHtml(error.message)}</p></article>`;
});
