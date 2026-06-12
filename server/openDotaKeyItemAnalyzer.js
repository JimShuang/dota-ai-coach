'use strict';

// Extracts key item completion timings from an OpenDota player object.
//
// Pure functions — no DB reads, no network.
// Wire-in: importConfirmService.js calls analyzeKeyItemTimings() and persists.

const { opendotaKeyToItemName } = require('./matchImporter');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a map of our item name → earliest purchase time (seconds) from the
 * OpenDota purchase_log array.
 */
function buildPurchaseMap(purchaseLog) {
  const map = new Map();
  for (const entry of (purchaseLog || [])) {
    if (!entry?.key) continue;
    const itemName = opendotaKeyToItemName(entry.key);
    if (!map.has(itemName)) map.set(itemName, entry.time);
  }
  return map;
}

// ── Main analyser ──────────────────────────────────────────────────────────

/**
 * Count deaths that occurred before the player had completed their full key item route.
 *
 * Semantics mirror the GSI-side pre_key_item flag: a death counts when the player
 * still had at least one key item left to purchase at the moment of death.
 *
 * For OpenDota imports this is a lower bound — tower / creep kills that don't appear
 * in any player's kills_log are absent from deathTimes.
 *
 * @param {number[]} deathTimes  - Reconstructed death timestamps (seconds, sorted)
 * @param {Map}      purchaseMap - From buildPurchaseMap(player.purchase_log)
 * @param {object}   profile     - Hero profile with keyItems[]
 * @returns {number}
 */
function countPreKeyItemDeaths(deathTimes, purchaseMap, profile) {
  if (!deathTimes || !deathTimes.length || !profile?.keyItems?.length) return 0;
  let count = 0;
  for (const t of deathTimes) {
    const isPreKeyItem = profile.keyItems.some((item) => {
      const purchasedAt = purchaseMap.get(item);
      return purchasedAt == null || purchasedAt > t;
    });
    if (isPreKeyItem) count++;
  }
  return count;
}

/**
 * Analyse key item timings for a single player from OpenDota raw JSON.
 *
 * Returns `{ available: false }` when purchase_log is absent or empty —
 * the caller must NOT write any timing rows in that case.
 *
 * Per-field notes for OpenDota imports:
 *   completed_time           — exact second from purchase_log ✓
 *   deaths_before_completion — lower bound computed from reconstructed death times when
 *                              provided; 0 when deathTimes is empty (tower/creep kills
 *                              carry no timestamp in the basic OpenDota API)
 *   power_spike_used         — null for completed spike items (data unavailable);
 *                              0 for non-spike / incomplete items
 *
 * @param {string}   matchId    - synthetic match_id (e.g. "8838859325_od2")
 * @param {object}   player     - OpenDota player object from raw match JSON
 * @param {object}   profile    - hero profile from offlaneHeroProfiles
 * @param {number[]} [deathTimes=[]] - Reconstructed death timestamps (seconds)
 * @returns {{ available: boolean, timings: object[] }}
 */
function analyzeKeyItemTimings(matchId, player, profile, deathTimes = []) {
  if (!profile?.keyItems?.length) {
    return { available: true, timings: [] };
  }

  // Missing or empty purchase_log → cannot determine completion; mark unavailable
  if (!Array.isArray(player.purchase_log) || player.purchase_log.length === 0) {
    return { available: false, timings: [] };
  }

  const purchased = buildPurchaseMap(player.purchase_log);

  const timings = profile.keyItems.map((item) => {
    const completedTime = purchased.get(item) ?? null;
    const completed     = completedTime !== null ? 1 : 0;
    const isPowerSpike  = profile.powerSpikeItems?.includes(item) ?? false;

    // power_spike_used:
    //   null  → spike item completed, but whether it was "used" is unknown from the
    //           basic OpenDota API (no kill/assist timeline at item resolution)
    //   0     → item not completed, or not a spike item (no spike to track)
    const powerSpikeUsed = (isPowerSpike && completed) ? null : 0;

    // deaths_before_completion: mirrors computeKeyItemTimings in matchHistory.js —
    //   completed items: deaths with time < completedTime (cumulative from game start)
    //   uncompleted items: all reconstructed deaths
    //   deathTimes empty: 0 (lower bound, not null)
    let deaths_before_completion = 0;
    if (deathTimes.length > 0) {
      deaths_before_completion = completed
        ? deathTimes.filter((t) => t < completedTime).length
        : deathTimes.length;
    }

    return {
      match_id:                 matchId,
      item_name:                item,
      completed,
      completed_time:           completedTime,
      deaths_before_completion,
      power_spike_used:         powerSpikeUsed,
    };
  });

  return { available: true, timings };
}

module.exports = { analyzeKeyItemTimings, buildPurchaseMap, countPreKeyItemDeaths };
