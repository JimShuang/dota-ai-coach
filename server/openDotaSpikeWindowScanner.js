'use strict';

// Scans enemy vs. player power-spike timing to produce "spike window delta" anchors —
// the third class of anchor points (first: hero_death, second: momentum shifts).
//
// Deliberately isolated: no imports from event / death / digest / timeseries / momentum modules.
// Only dependencies: genericPowerSpikeItems.js and dotaHeroNames.js.
//
// Input: the players[] array from an OpenDota raw match response and the selected player slot.
// Output: one anchor per ability bucket (at most 6), sorted by |delta| descending.
//
// Precision: second-granularity from purchase_log timestamps.

const { POWER_SPIKE_ITEMS }  = require('./data/genericPowerSpikeItems');
const { getHeroName }        = require('./data/dotaHeroNames');

// ── Threshold constant ─────────────────────────────────────────────────────
const SIGNIFICANT_GAP_SECONDS = 120;  // |delta| > this → anchor is flagged as significant

// ── Helpers ────────────────────────────────────────────────────────────────

// Radiant slots: 0–4; Dire slots: 128–132.
function isRadiant(playerSlot) { return playerSlot < 128; }

// For a single player, return the earliest purchase_log time for any item in a bucket.
// Returns null when the player has no purchase_log or bought nothing in that bucket.
function earliestBucketTime(player, bucketItems) {
  const log = player.purchase_log;
  if (!log || !Array.isArray(log) || log.length === 0) return null;
  let earliest = Infinity;
  for (const entry of log) {
    if (bucketItems.includes(entry.key) && typeof entry.time === 'number') {
      if (entry.time < earliest) earliest = entry.time;
    }
  }
  return earliest === Infinity ? null : earliest;
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Produce spike-window delta anchors for each ability bucket.
 *
 * @param {object[]} players       players[] array from OpenDota raw match data
 * @param {number}   selectedPlayerSlot  player_slot of the user's hero (0–4 radiant, 128–132 dire)
 * @returns {Array<{
 *   bucket, myItem, myTime, enemyHero, enemyItem, enemyTime,
 *   delta, type, significant
 * }>}  At most one anchor per bucket, sorted by |delta| descending.
 */
function scanSpikeWindowDeltas(players, selectedPlayerSlot) {
  if (!Array.isArray(players) || players.length === 0) return [];

  // Find selected player.
  const myPlayer = players.find((p) => p.player_slot === selectedPlayerSlot);
  if (!myPlayer) return [];

  const myTeamRadiant = isRadiant(selectedPlayerSlot);

  // Enemy players: opposite faction.
  const enemies = players.filter((p) => isRadiant(p.player_slot) !== myTeamRadiant);
  if (enemies.length === 0) return [];

  const anchors = [];

  for (const [bucket, bucketItems] of Object.entries(POWER_SPIKE_ITEMS)) {
    const myTime = earliestBucketTime(myPlayer, bucketItems);
    if (myTime === null) continue;  // my side has nothing in this bucket

    // Find the earliest enemy completion and their hero display name.
    let enemyTime = Infinity;
    let enemyPlayer = null;
    let enemyItem = null;

    for (const enemy of enemies) {
      const log = enemy.purchase_log;
      if (!log || !Array.isArray(log)) continue;
      for (const entry of log) {
        if (bucketItems.includes(entry.key) && typeof entry.time === 'number') {
          if (entry.time < enemyTime) {
            enemyTime = entry.time;
            enemyPlayer = enemy;
            enemyItem = entry.key;
          }
        }
      }
    }

    if (enemyPlayer === null) continue;  // no enemy completed this bucket

    // Determine which item I completed first in this bucket.
    let myItem = null;
    let myEarliestTime = Infinity;
    for (const entry of (myPlayer.purchase_log || [])) {
      if (bucketItems.includes(entry.key) && typeof entry.time === 'number') {
        if (entry.time < myEarliestTime) {
          myEarliestTime = entry.time;
          myItem = entry.key;
        }
      }
    }

    const delta = myTime - enemyTime;  // positive = I'm later = deficit; negative = I'm earlier = lead
    const type  = delta > 0 ? 'spike_deficit' : 'spike_lead';

    anchors.push({
      bucket,
      myItem,
      myTime,
      enemyHero: getHeroName(enemyPlayer.hero_id),
      enemyItem,
      enemyTime,
      delta,
      type,
      significant: Math.abs(delta) > SIGNIFICANT_GAP_SECONDS,
    });
  }

  // Sort by |delta| descending: largest timing gap first.
  anchors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return anchors;
}

module.exports = {
  scanSpikeWindowDeltas,
  _SIGNIFICANT_GAP_SECONDS: SIGNIFICANT_GAP_SECONDS,
};
