'use strict';

// Pure helpers: economy advantage timeseries from raw OpenDota match data,
// and per-death economy delta from minute-granularity curves.
//
// PRECISION LIMIT: radiant_gold_adv / radiant_xp_adv are MINUTE-granularity arrays.
// A death at e.g. t=754s lands at minute 12; "the next minute point" is minute 13.
// "Death-after-1-minute delta" is therefore gold[minute+1] - gold[minute] — one
// data point of gap. No interpolation. This is a fixed data-source limitation.

// Threshold constants (tune here, not in call sites)
const ABS_THRESHOLD  = 1000;   // gold — absolute delta that triggers "significant"
const REL_THRESHOLD  = 0.20;   // 20% relative change of advBefore
const BASELINE_MIN   = 500;    // below this |advBefore|, only the absolute threshold applies

/**
 * Build economy advantage timeseries from raw OpenDota match data.
 * The result is always from the *selected player's* perspective: positive = their team leads.
 *
 * player_slot < 128  → radiant;  radiant_gold_adv is already from radiant's perspective → keep sign
 * player_slot >= 128 → dire;     negate so "our lead is positive"
 *
 * @param {object} raw              Parsed OpenDota match JSON
 * @param {number} selectedPlayerSlot  0-4 = radiant, 128-132 = dire
 * @returns {{ available, perspective, gold, xp }}
 */
function buildEconomyTimeseries(raw, selectedPlayerSlot) {
  if (!raw || !Array.isArray(raw.radiant_gold_adv)) {
    return { available: false, perspective: null, gold: [], xp: [] };
  }

  const isRadiant  = selectedPlayerSlot < 128;
  const perspective = isRadiant ? 'radiant' : 'dire';
  const sign        = isRadiant ? 1 : -1;

  const gold = raw.radiant_gold_adv.map((adv, minute) => ({ minute, adv: adv * sign }));
  const xp   = Array.isArray(raw.radiant_xp_adv)
    ? raw.radiant_xp_adv.map((adv, minute) => ({ minute, adv: adv * sign }))
    : [];

  return { available: true, perspective, gold, xp };
}

/**
 * Compute economy delta around a single death (minute granularity).
 *
 * @param {{ available, gold }|null} timeseries  Output of buildEconomyTimeseries (or null)
 * @param {number} deathGameTime                 game_time in seconds
 * @returns {{ available, minuteAtDeath, advBefore, advAfter, delta, significant }}
 */
function economyDeltaAroundDeath(timeseries, deathGameTime) {
  const notAvail = {
    available:     false,
    minuteAtDeath: null,
    advBefore:     null,
    advAfter:      null,
    delta:         null,
    significant:   false,
  };

  if (!timeseries || !timeseries.available) return notAvail;
  if (!Array.isArray(timeseries.gold) || timeseries.gold.length === 0) return notAvail;
  if (typeof deathGameTime !== 'number') return notAvail;

  const minuteAtDeath = Math.floor(deathGameTime / 60);
  const gold = timeseries.gold;

  if (minuteAtDeath < 0 || minuteAtDeath >= gold.length) {
    return { ...notAvail, available: false, minuteAtDeath };
  }

  const advBefore = gold[minuteAtDeath].adv;
  const afterIdx  = minuteAtDeath + 1;

  if (afterIdx >= gold.length) {
    // Last minute — no next point, can't compute delta
    return { available: true, minuteAtDeath, advBefore, advAfter: null, delta: null, significant: false };
  }

  const advAfter = gold[afterIdx].adv;
  const delta    = advAfter - advBefore;

  // significant: absolute OR relative; skip relative when baseline is tiny (avoid 0-crossing noise)
  const absSig = Math.abs(delta) > ABS_THRESHOLD;
  const relSig = Math.abs(advBefore) >= BASELINE_MIN
    && Math.abs(delta) > Math.abs(advBefore) * REL_THRESHOLD;
  const significant = absSig || relSig;

  return { available: true, minuteAtDeath, advBefore, advAfter, delta, significant };
}

module.exports = {
  buildEconomyTimeseries,
  economyDeltaAroundDeath,
  // Export constants so tests can verify thresholds without hard-coding them
  _ABS_THRESHOLD: ABS_THRESHOLD,
  _REL_THRESHOLD: REL_THRESHOLD,
  _BASELINE_MIN:  BASELINE_MIN,
};
