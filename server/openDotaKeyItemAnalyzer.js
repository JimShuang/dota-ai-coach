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
 * Analyse key item timings for a single player from OpenDota raw JSON.
 *
 * Returns `{ available: false }` when purchase_log is absent or empty —
 * the caller must NOT write any timing rows in that case.
 *
 * Per-field notes for OpenDota imports:
 *   completed_time           — exact second from purchase_log ✓
 *   deaths_before_completion — 0 (death timing not in basic OpenDota API)
 *   power_spike_used         — null for completed spike items (data unavailable);
 *                              0 for non-spike / incomplete items
 *
 * @param {string} matchId  - synthetic match_id (e.g. "8838859325_od2")
 * @param {object} player   - OpenDota player object from raw match JSON
 * @param {object} profile  - hero profile from offlaneHeroProfiles
 * @returns {{ available: boolean, timings: object[] }}
 */
function analyzeKeyItemTimings(matchId, player, profile) {
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

    return {
      match_id:                 matchId,
      item_name:                item,
      completed,
      completed_time:           completedTime,
      deaths_before_completion: 0,       // death timing unavailable from basic API
      power_spike_used:         powerSpikeUsed,
    };
  });

  return { available: true, timings };
}

module.exports = { analyzeKeyItemTimings, buildPurchaseMap };
