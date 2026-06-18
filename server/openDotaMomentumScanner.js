'use strict';

// Scans an economy timeseries for momentum shift anchors — the second class of
// anchor points in the logical chain (first class: hero_death from openDotaDeathDigest).
//
// Deliberately isolated: no imports from event / death / digest modules.
// Input is the output of buildEconomyTimeseries() from openDotaEconomyTimeseries.js.
//
// Precision limit: minute-granularity data only (same as the economy timeseries).
// A "shift" reported at minute N means the new trend direction begins at that minute.

// ── Threshold constants (tune here only) ──────────────────────────────────
const MIN_SLOPE_CHANGE  = 400;  // gold/min — min |slopeAfter - slopeBefore| to count as a shift
const MIN_TREND_MINUTES = 2;    // slopes on each side of the candidate reversal must all be sustained
const FLAT_BAND         = 100;  // slopes within ±FLAT_BAND gold/min are treated as direction-neutral

// ── Helpers ────────────────────────────────────────────────────────────────

// Directional sign: +1 (positive), -1 (negative), 0 (flat/neutral).
function dirSign(v) {
  if (v >  FLAT_BAND) return  1;
  if (v < -FLAT_BAND) return -1;
  return 0;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Scan a gold timeseries for momentum shift anchors.
 *
 * Algorithm overview:
 *   1. Compute per-minute slope: slope[i] = gold[i+1].adv − gold[i].adv
 *   2. For each candidate reversal point i (the first slope index of the new trend):
 *      a. Collect the MIN_TREND_MINUTES slopes before (before-window) and after (after-window).
 *      b. Compute avgBefore / avgAfter as windowed averages (more stable than single-point slopes).
 *      c. Both averages must have a clear non-neutral direction and be opposite each other.
 *      d. Magnitude filter: |avgAfter − avgBefore| > MIN_SLOPE_CHANGE.
 *      e. Persistence filter: every individual slope in the after-window must match avgAfter's
 *         direction — rejects single-minute spikes that immediately reverse again.
 *         The before-window applies the same consistency check to ensure the prior trend was clear.
 *   3. Emit an anchor with slopeBefore / slopeAfter as the windowed averages.
 *
 * Using windowed averages rather than single-point slopes (the "择一, 注释说明" choice):
 * they naturally smooth minute-to-minute noise and pair cleanly with the per-window
 * persistence check, giving one coherent picture of each trend window.
 *
 * @param {{ available, gold: {minute, adv}[] }} timeseries
 *        Output of buildEconomyTimeseries() — already in player-perspective (positive = our lead).
 * @returns {Array<{minute, type, slopeBefore, slopeAfter, magnitude, advAtShift}>}
 *          Anchors sorted by minute ASC. Empty array when no meaningful shifts are found.
 */
function scanMomentumShifts(timeseries) {
  if (!timeseries || !timeseries.available) return [];

  const gold = timeseries.gold;
  if (!Array.isArray(gold) || gold.length === 0) return [];

  // Need at least 2*MIN_TREND_MINUTES+1 data points to have any valid candidate.
  if (gold.length < MIN_TREND_MINUTES * 2 + 1) return [];

  // slope[i] = adv change from minute i to minute i+1
  const slopes = [];
  for (let i = 0; i < gold.length - 1; i++) {
    slopes.push(gold[i + 1].adv - gold[i].adv);
  }

  const anchors = [];

  // i is the first slope index of the candidate "after" window.
  // before-window: slopes[i-MIN_TREND_MINUTES .. i-1]
  // after-window:  slopes[i .. i+MIN_TREND_MINUTES-1]
  for (let i = MIN_TREND_MINUTES; i <= slopes.length - MIN_TREND_MINUTES; i++) {
    const beforeSlopes = slopes.slice(i - MIN_TREND_MINUTES, i);
    const afterSlopes  = slopes.slice(i, i + MIN_TREND_MINUTES);

    const avgBefore = mean(beforeSlopes);
    const avgAfter  = mean(afterSlopes);

    const signBefore = dirSign(avgBefore);
    const signAfter  = dirSign(avgAfter);

    // Both windows must show a clear, non-neutral direction.
    if (signBefore === 0 || signAfter === 0) continue;

    // Must be a true direction reversal (opposite signs).
    if (signBefore === signAfter) continue;

    // Slope-change magnitude must exceed the noise floor.
    const magnitude = Math.abs(avgAfter - avgBefore);
    if (magnitude <= MIN_SLOPE_CHANGE) continue;

    // Persistence: every slope in before-window must be the same direction as avgBefore.
    if (beforeSlopes.some((s) => dirSign(s) !== signBefore)) continue;

    // Persistence: every slope in after-window must be the same direction as avgAfter.
    // This rejects single-minute spikes that reverse within the window.
    if (afterSlopes.some((s) => dirSign(s) !== signAfter)) continue;

    // type from our perspective (timeseries is already player-perspective):
    //   positive → negative: our advantage is shrinking   → momentum_loss
    //   negative → positive: our disadvantage is shrinking → momentum_gain
    const type = signBefore > 0 ? 'momentum_loss' : 'momentum_gain';

    anchors.push({
      minute:      gold[i].minute,
      type,
      slopeBefore: avgBefore,
      slopeAfter:  avgAfter,
      magnitude,
      advAtShift:  gold[i].adv,
    });
  }

  // anchors are already minute-ascending because i iterates forward.
  return anchors;
}

module.exports = {
  scanMomentumShifts,
  // Export constants so tests can reference them without hard-coding
  _MIN_SLOPE_CHANGE:  MIN_SLOPE_CHANGE,
  _MIN_TREND_MINUTES: MIN_TREND_MINUTES,
  _FLAT_BAND:         FLAT_BAND,
};
