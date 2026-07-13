// Monthly acquisition cohorts for the fictional Northstar Outfitters store.
// Invented, deterministic — no real customers or PII.
//
// Generated from a KNOWN retention process so the projection can be graded: each
// cohort's active-customer share follows a power-law decay in months-since-
// acquisition, scaled by a per-cohort "quality" factor (newer cohorts, acquired
// harder, retain a little worse), plus a roughly constant revenue-per-active and a
// little noise. This is a classic cohort TRIANGLE: the oldest cohort has a full
// history, the newest has only month 0 observed — the projection fills the rest.
// retention.js never sees these params; GROUND_TRUTH is exported only for the test.

const N_COHORTS = 12;         // 12 monthly acquisition cohorts
const A = 0.55;               // retention at month 1 (before quality scaling)
const B = 0.45;               // power-law decay exponent
const REV_PER_ACTIVE = 85;    // € revenue per active customer per month

function lcg(seed) { let s = seed >>> 0; return () => { s = (1103515245 * s + 12345) >>> 0; return s / 4294967296; }; }
const trueRetention = (age) => (age === 0 ? 1 : A * Math.pow(age, -B));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const rand = lcg(2828);
const cohorts = [];
for (let i = 0; i < N_COHORTS; i++) {
  const observedAges = (N_COHORTS - 1) - i;      // oldest cohort (i=0) → 11 later months observed
  const size = 40 + i * 6;                         // acquisition grew over time
  const quality = 1.08 - i * 0.016;               // newer cohorts retain slightly worse
  const observed = [];
  for (let age = 0; age <= observedAges; age++) {
    const base = trueRetention(age) * (age === 0 ? 1 : quality);
    const noise = age === 0 ? 1 : 1 + (rand() - 0.5) * 0.06;
    const activePct = Math.min(1, Math.max(0, base * noise));
    const revPerActive = age === 0 ? 0 : Math.round(REV_PER_ACTIVE * (1 + (rand() - 0.5) * 0.1));
    observed.push({ age, activePct: Math.round(activePct * 1000) / 1000, revPerActive });
  }
  cohorts.push({ id: `c${i}`, label: `${MONTHS[i % 12]} '25`, size, observedMonths: observedAges, observed });
}

export const COHORTS = cohorts;
export const MARGIN = 0.45; // documented contribution-margin assumption

export const GROUND_TRUTH = {
  A, b: B, revPerActive: REV_PER_ACTIVE,
  retention: Array.from({ length: 13 }, (_, age) => Math.round(trueRetention(age) * 1000) / 1000),
};
