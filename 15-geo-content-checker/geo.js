// GEO / AEO content checker core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/geo.test.mjs). No DOM, no network, no PII.
//
// Search is shifting from ten blue links to answer engines (AI Overviews,
// ChatGPT, Perplexity) that EXTRACT and QUOTE content. GEO/AEO is about making a
// page's answer machine-liftable: answer-first structure, self-contained
// definitions, question-shaped headings, scannable chunks, concrete facts, and
// the right structured data. This audits an article the way an answer engine
// reads it — deterministic keyword/structure rules, not an LLM, so every score is
// inspectable — and shows the exact sentences a model would quote.

const STOP = new Set("the a an and or but of to in on for with at by from as is are was were be been being this that these those it its their your our you we they he she into over under about it's".split(" "));
const QWORDS = /^(what|how|why|when|where|which|who|should|can|is|are|does|do|will|could)\b/i;
const PRON_CONJ = /^(this|that|these|those|it|they|he|she|we|but|and|so|because|however|also|then|thus|therefore|which|there|here)\b/i;
const DEF_RE = /^[A-Z][A-Za-z0-9 ,'()/\-]{1,48}?\s+(is|are|refers to|means|is defined as|is a|is an|is the)\s+/;

const words = (s) => s.trim().split(/\s+/).filter(Boolean);
const wc = (s) => (s.trim() ? words(s).length : 0);
const sentences = (s) => s.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 1);
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const keywords = (s) => [...new Set(words(s.toLowerCase().replace(/[^a-z0-9\s]/g, "")).filter((w) => w.length > 3 && !STOP.has(w)))];

// --- Parse a markdown-ish article into an ordered structure ---------------
export function parse(text) {
  const lines = String(text || "").split(/\r?\n/);
  const structure = [];
  let para = [];
  const flush = () => { if (para.length) { structure.push({ type: "p", text: para.join(" ").trim() }); para = []; } };
  let list = null;
  const flushList = () => { if (list) { structure.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (h) { flush(); flushList(); structure.push({ type: "h", level: h[1].length, text: h[2].trim() }); }
    else if (li) { flush(); if (!list) list = { type: "list", ordered: /\d/.test(li[1]), items: [] }; list.items.push(li[2].trim()); }
    else if (!line) { flush(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flush(); flushList();
  const titleNode = structure.find((n) => n.type === "h" && n.level === 1);
  const title = titleNode ? titleNode.text : (structure.find((n) => n.type === "p")?.text.split(/[.!?]/)[0] || "Untitled");
  return { structure, title };
}

function isQuestionHeading(t) { return t.trim().endsWith("?") || QWORDS.test(t.trim()); }
function isDefinition(s) { return DEF_RE.test(s) && !PRON_CONJ.test(s); }
function isConcrete(s) { return /\d/.test(s) || /[€$%]/.test(s) || /\b\d+\s*(days?|weeks?|hours?|%|kg|g|km|€|EUR)\b/i.test(s); }
function isQuotable(s) {
  const n = wc(s);
  return n >= 8 && n <= 32 && /[.?!]$/.test(s) && !PRON_CONJ.test(s) && /[a-zA-Z]/.test(s);
}

// --- The audit -------------------------------------------------------------
export function analyze(text, opts = {}) {
  const { structure, title } = parse(text);
  const headings = structure.filter((n) => n.type === "h" && n.level >= 2);
  const paras = structure.filter((n) => n.type === "p");
  const lists = structure.filter((n) => n.type === "list");
  const allText = structure.map((n) => n.text || (n.items || []).join(" ")).join(" ");
  const totalWords = wc(allText);
  const allSentences = paras.flatMap((p) => sentences(p.text));
  const titleKW = keywords(title);

  // Lede = first paragraph before the first H2.
  const firstH2 = structure.findIndex((n) => n.type === "h" && n.level >= 2);
  const ledeNode = structure.find((n, i) => n.type === "p" && (firstH2 === -1 || i < firstH2));
  const lede = ledeNode ? ledeNode.text : "";

  // 1. Answer-first lede -----------------------------------------------------
  const dims = {};
  {
    const findings = [];
    let score = 100;
    if (!lede) { score = 25; findings.push("No intro paragraph before the first heading — an answer engine has nothing to lift up top."); }
    else {
      const lw = wc(lede);
      const hits = titleKW.filter((k) => lede.toLowerCase().includes(k)).length;
      if (lw > 70) { score -= Math.min(45, (lw - 70) * 0.7); findings.push(`Opening paragraph is ${lw} words — lead with a one-sentence answer, then elaborate.`); }
      else if (lw <= 45) findings.push(`Concise ${lw}-word opening — good for extraction.`);
      if (titleKW.length && hits === 0) { score -= 25; findings.push("The opening doesn't restate the topic from the title — answer engines match intent on the lede."); }
      if (!/[.!?]/.test(lede.split(" ").slice(0, 30).join(" "))) { score -= 10; }
    }
    dims.answerFirst = { key: "answerFirst", label: "Answer-first lede", score: clamp(score), findings };
  }

  // 2. Extractable definitions ----------------------------------------------
  {
    const defs = allSentences.filter(isDefinition);
    const score = defs.length >= 3 ? 100 : defs.length === 2 ? 88 : defs.length === 1 ? 66 : 30;
    const findings = defs.length
      ? [`${defs.length} self-contained definition(s) an engine can quote directly.`]
      : ["No definitional sentences (“X is …”). Add one clear definition of your core term."];
    dims.definitions = { key: "definitions", label: "Extractable definitions", score, findings, examples: defs.slice(0, 3) };
  }

  // 3. Question-shaped headings ---------------------------------------------
  {
    const q = headings.filter((h) => isQuestionHeading(h.text));
    const ratio = headings.length ? q.length / headings.length : 0;
    const score = headings.length ? clamp(35 + ratio * 75) : 30;
    const findings = [];
    if (!headings.length) findings.push("No subheadings — answer engines use headings to locate a question's answer.");
    else {
      findings.push(`${q.length}/${headings.length} headings are question-shaped.`);
      const nonQ = headings.filter((h) => !isQuestionHeading(h.text)).slice(0, 2);
      nonQ.forEach((h) => findings.push(`Rephrase “${h.text}” as a question a user would ask.`));
    }
    dims.questionHeadings = { key: "questionHeadings", label: "Question-shaped headings", score, findings };
  }

  // 4. Scannability ----------------------------------------------------------
  {
    const paraW = paras.map((p) => wc(p.text));
    const avg = paraW.length ? paraW.reduce((a, b) => a + b, 0) / paraW.length : 0;
    const longs = paraW.filter((w) => w > 90);
    const shortRatio = paraW.length ? paraW.filter((w) => w <= 60).length / paraW.length : 0;
    const density = totalWords ? headings.length / (totalWords / 200) : 0;
    let score = 30 + shortRatio * 45 + (lists.length ? 15 : 0) + Math.min(15, density * 10);
    score -= longs.length * 10;
    const findings = [];
    if (longs.length) findings.push(`${longs.length} paragraph(s) over 90 words — break into scannable chunks.`);
    if (!lists.length) findings.push("No lists — bullet or numbered lists are highly extractable.");
    if (density < 0.5 && headings.length) findings.push("Low heading density — add subheadings to segment answers.");
    if (!findings.length) findings.push("Well-segmented: short paragraphs, headings, and lists.");
    dims.scannability = { key: "scannability", label: "Scannability", score: clamp(score), findings };
  }

  // 5. Quotable statements ---------------------------------------------------
  const quotable = allSentences.filter(isQuotable);
  {
    const ratio = allSentences.length ? quotable.length / allSentences.length : 0;
    const score = clamp(Math.min(100, quotable.length * 14) * 0.6 + ratio * 80 * 0.4);
    const findings = quotable.length
      ? [`${quotable.length} self-contained, quotable sentence(s) (8–32 words, no dangling references).`]
      : ["Few standalone sentences — trim long ones and avoid opening with “this/it/they”."];
    dims.quotability = { key: "quotability", label: "Quotable statements", score, findings };
  }

  // 6. Specificity -----------------------------------------------------------
  {
    const concrete = allSentences.filter(isConcrete).length;
    const ratio = allSentences.length ? concrete / allSentences.length : 0;
    const score = clamp(35 + ratio * 160);
    const findings = concrete
      ? [`${concrete} sentence(s) with concrete facts/numbers — engines prefer specifics over vague claims.`]
      : ["No numbers or specifics — concrete facts get quoted; vague claims get skipped."];
    dims.specificity = { key: "specificity", label: "Specificity (facts & numbers)", score, findings };
  }

  // --- Overall score --------------------------------------------------------
  const W = { answerFirst: 0.22, quotability: 0.2, definitions: 0.18, questionHeadings: 0.16, scannability: 0.14, specificity: 0.1 };
  const overall = clamp(Object.entries(W).reduce((s, [k, w]) => s + dims[k].score * w, 0));
  const grade = overall >= 85 ? "A" : overall >= 70 ? "B" : overall >= 55 ? "C" : overall >= 40 ? "D" : "F";

  // --- Quotable snippets (what an engine would lift) ------------------------
  const ranked = quotable.map((s) => ({
    text: s,
    tag: isDefinition(s) ? "definition" : isConcrete(s) ? "concrete" : "standalone",
    rank: (isDefinition(s) ? 3 : 0) + (isConcrete(s) ? 2 : 0) + (Math.abs(wc(s) - 18) < 8 ? 1 : 0),
  })).sort((a, b) => b.rank - a.rank).slice(0, 5);

  // --- Schema recommendation ------------------------------------------------
  const schema = [{ type: "Article", detected: true, reason: "Every editorial page should expose Article schema (headline, author, datePublished)." }];
  const qaPairs = [];
  structure.forEach((n, i) => {
    if (n.type === "h" && n.level >= 2 && isQuestionHeading(n.text)) {
      const ans = structure.slice(i + 1).find((x) => x.type === "p");
      if (ans) qaPairs.push({ q: n.text, a: ans.text });
    }
  });
  if (qaPairs.length >= 2) schema.push({ type: "FAQPage", detected: true, reason: `${qaPairs.length} question headings with answers — mark up as FAQPage for rich results and AI extraction.`, pairs: qaPairs.slice(0, 4) });
  if (lists.some((l) => l.ordered) || /\bstep\b/i.test(allText)) schema.push({ type: "HowTo", detected: true, reason: "Ordered steps detected — HowTo schema exposes the procedure to answer engines." });
  if (dims.definitions.score >= 66) schema.push({ type: "DefinedTerm", detected: true, reason: "A clear definition is present — DefinedTerm can make it citable." });

  // --- Answer coverage for a target question -------------------------------
  let coverage = null;
  if (opts.targetQuestion && opts.targetQuestion.trim()) {
    const qk = keywords(opts.targetQuestion);
    let best = null, bestScore = -1, bestIdx = -1;
    allSentences.forEach((s) => {
      const sl = s.toLowerCase();
      const hit = qk.filter((k) => sl.includes(k)).length;
      if (hit > bestScore) { bestScore = hit; best = s; }
    });
    // location: which paragraph index holds it
    const pIdx = paras.findIndex((p) => p.text.includes(best || " "));
    const early = pIdx >= 0 && pIdx <= 1;
    const covScore = clamp((qk.length ? (bestScore / qk.length) : 0) * 70 + (early ? 30 : 0));
    coverage = {
      question: opts.targetQuestion.trim(),
      answer: best || "",
      matched: bestScore, of: qk.length,
      early, quotable: best ? isQuotable(best) : false,
      score: covScore,
      verdict: !best ? "No matching sentence found." : early ? "Answered early and directly — good." : "The answer exists but is buried — move a direct answer near the top.",
    };
  }

  // --- Prioritised recommendations -----------------------------------------
  const recs = Object.values(dims)
    .filter((d) => d.score < 75)
    .map((d) => ({ dim: d.label, impact: Math.round((100 - d.score) * (W[d.key] || 0.1)), text: d.findings.find((f) => /\b(add|break|rephrase|lead|move|trim|no |few )/i.test(f)) || d.findings[0] }))
    .sort((a, b) => b.impact - a.impact);

  // --- Outline --------------------------------------------------------------
  const outline = headings.map((h, i) => {
    const gi = structure.indexOf(h);
    const ans = structure.slice(gi + 1).find((x) => x.type === "p");
    return { level: h.level, text: h.text, isQuestion: isQuestionHeading(h.text), hasAnswerBelow: !!ans };
  });

  return {
    title,
    stats: { words: totalWords, paragraphs: paras.length, headings: headings.length, sentences: allSentences.length, lists: lists.length, avgParaWords: paras.length ? Math.round(paras.reduce((s, p) => s + wc(p.text), 0) / paras.length) : 0 },
    dimensions: Object.values(dims),
    overall, grade,
    quotableSnippets: ranked, quotableCount: quotable.length,
    definitionCount: dims.definitions.examples.length,
    schema, coverage, recommendations: recs, outline,
  };
}
