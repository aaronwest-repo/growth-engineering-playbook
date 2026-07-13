// Smoke test for the GEO/AEO content checker core. Pure Node, no deps.
// Run: node tests/geo.test.mjs   (exits non-zero on any failure)

import { analyze, parse } from "../geo.js";
import { SAMPLES } from "../samples.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const byId = Object.fromEntries(SAMPLES.map((s) => [s.id, s]));
const strong = analyze(byId["aeo-strong"].text);
const weak = analyze(byId["aeo-weak"].text);
const howto = analyze(byId["howto"].text);
const thin = analyze(byId["thin-product"].text);

// --- Parsing ---------------------------------------------------------------
check("samples are available", SAMPLES.length >= 3);
check("parser extracts title + structure", parse(byId["aeo-strong"].text).title.length > 0 && parse(byId["aeo-strong"].text).structure.length > 3);

// --- Scoring discriminates -------------------------------------------------
check("every article gets an overall score 0..100 + grade",
  [strong, weak, howto, thin].every((a) => a.overall >= 0 && a.overall <= 100 && /[A-F]/.test(a.grade)));
check("a well-structured article scores higher than a wall-of-text",
  strong.overall > weak.overall, `strong=${strong.overall} weak=${weak.overall}`);
check("the thin product page scores poorly", thin.overall < 55, `thin=${thin.overall}`);
check("the strong sample earns a good grade", ["A", "B"].includes(strong.grade), `grade=${strong.grade}`);

// --- Dimensions ------------------------------------------------------------
check("six scored dimensions are returned", strong.dimensions.length === 6 && strong.dimensions.every((d) => typeof d.score === "number" && d.label && d.findings.length));
const dim = (a, k) => a.dimensions.find((d) => d.key === k).score;
check("question-heading dimension rewards question headings",
  dim(strong, "questionHeadings") > dim(weak, "questionHeadings"),
  `strong=${dim(strong, "questionHeadings")} weak=${dim(weak, "questionHeadings")}`);
check("answer-first dimension penalises the buried-lede article",
  dim(weak, "answerFirst") < dim(strong, "answerFirst"));
check("scannability penalises the wall-of-text article", dim(weak, "scannability") < dim(strong, "scannability"));

// --- Definitions + quotable snippets --------------------------------------
check("definitions are detected in the strong sample", dim(strong, "definitions") >= 66);
check("quotable snippets are extracted with tags",
  strong.quotableSnippets.length > 0 && strong.quotableSnippets.every((s) => s.text && ["definition", "concrete", "standalone"].includes(s.tag)));
check("the wall-of-text yields few quotable snippets", weak.quotableCount <= strong.quotableCount);

// --- Schema recommendation -------------------------------------------------
check("Article schema is always recommended", strong.schema.some((s) => s.type === "Article"));
check("FAQPage schema detected on the Q&A-structured sample",
  strong.schema.some((s) => s.type === "FAQPage" && s.pairs && s.pairs.length >= 2));
check("HowTo schema detected on the how-to sample",
  howto.schema.some((s) => s.type === "HowTo"));

// --- Answer coverage -------------------------------------------------------
const cov = analyze(byId["aeo-strong"].text, { targetQuestion: "What is answer engine optimization?" });
check("answer coverage locates and scores a target question",
  cov.coverage && cov.coverage.answer.length > 0 && typeof cov.coverage.score === "number" && cov.coverage.verdict,
  cov.coverage ? `score=${cov.coverage.score} early=${cov.coverage.early}` : "no coverage");
check("coverage marks an early, direct answer as good", cov.coverage.early === true);

// --- Recommendations -------------------------------------------------------
check("weak article generates prioritised recommendations",
  weak.recommendations.length > 0 && weak.recommendations.every((r) => r.text && typeof r.impact === "number"));
check("recommendations are impact-sorted (desc)",
  weak.recommendations.every((r, i, a) => i === 0 || a[i - 1].impact >= r.impact));

// --- Outline ---------------------------------------------------------------
check("outline flags question vs non-question headings",
  strong.outline.length > 0 && strong.outline.some((o) => o.isQuestion));

// --- Leakage ---------------------------------------------------------------
check("no raw emails in output (no '@')", !JSON.stringify(strong).includes("@"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll GEO/AEO content checker checks passed.");
process.exit(failures ? 1 : 0);
