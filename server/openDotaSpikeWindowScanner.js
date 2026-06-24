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

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Produce spike-window delta anchors — one per spike item purchased by the player.
 *
 * For each spike item the player bought, the comparison target is:
 *   1. The enemy's earliest purchase of the SAME item (exact match preferred).
 *   2. Failing that, the enemy's earliest item in the same ability bucket (bucket fallback).
 * Buckets with no enemy completion are silently skipped.
 *
 * @param {object[]} players              players[] from OpenDota raw match data
 * @param {number}   selectedPlayerSlot   player_slot of the user's hero (0–4 radiant, 128–132 dire)
 * @returns {Array<{
 *   bucket, myItem, myTime, enemyHero, enemyItem, enemyTime,
 *   delta, type, significant
 * }>}  One anchor per purchased spike item, sorted by |delta| descending.
 */
function scanSpikeWindowDeltas(players, selectedPlayerSlot) {
  if (!Array.isArray(players) || players.length === 0) return [];

  const myPlayer = players.find((p) => p.player_slot === selectedPlayerSlot);
  if (!myPlayer) return [];

  const log = myPlayer.purchase_log;
  if (!log || !Array.isArray(log) || log.length === 0) return [];

  const myTeamRadiant = isRadiant(selectedPlayerSlot);
  const enemies = players.filter((p) => isRadiant(p.player_slot) !== myTeamRadiant);
  if (enemies.length === 0) return [];

  // Build reverse lookup: item key → bucket name.
  const itemToBucket = {};
  for (const [bucket, items] of Object.entries(POWER_SPIKE_ITEMS)) {
    for (const item of items) itemToBucket[item] = bucket;
  }

  // Pre-compute enemy earliest purchase time per item key (same-item comparison only).
  // enemyByItem[itemKey] = { time, player }
  // anyEnemyHasPurchases: true when the match is parsed (at least one enemy bought something).
  const enemyByItem = {};
  let anyEnemyHasPurchases = false;
  for (const enemy of enemies) {
    const eLog = enemy.purchase_log;
    if (!eLog || !Array.isArray(eLog) || eLog.length === 0) continue;
    anyEnemyHasPurchases = true;
    for (const entry of eLog) {
      if (!itemToBucket[entry.key] || typeof entry.time !== 'number') continue;
      if (!enemyByItem[entry.key] || entry.time < enemyByItem[entry.key].time) {
        enemyByItem[entry.key] = { time: entry.time, player: enemy };
      }
    }
  }

  // Collect my earliest purchase time per spike item key (de-duplicate resell/rebuy).
  const myByItem = {};
  for (const entry of log) {
    const bucket = itemToBucket[entry.key];
    if (!bucket || typeof entry.time !== 'number') continue;
    if (!myByItem[entry.key] || entry.time < myByItem[entry.key]) {
      myByItem[entry.key] = entry.time;
    }
  }

  const anchors = [];

  for (const [myItemKey, myTime] of Object.entries(myByItem)) {
    const bucket = itemToBucket[myItemKey];
    const enemyMatch = enemyByItem[myItemKey];

    if (enemyMatch) {
      // Enemy also bought the same item — compute timing delta.
      const delta = myTime - enemyMatch.time;
      anchors.push({
        bucket,
        myItem:      myItemKey,
        myTime,
        enemyHero:   getHeroName(enemyMatch.player.hero_id),
        enemyItem:   myItemKey,
        enemyTime:   enemyMatch.time,
        delta,
        type:        delta > 0 ? 'spike_deficit' : 'spike_lead',
        significant: Math.abs(delta) > SIGNIFICANT_GAP_SECONDS,
      });
    } else if (anyEnemyHasPurchases) {
      // Match is parsed, but no enemy bought this specific item — unique advantage.
      anchors.push({
        bucket,
        myItem:      myItemKey,
        myTime,
        enemyHero:   null,
        enemyItem:   null,
        enemyTime:   null,
        delta:       null,
        type:        'spike_lead',
        significant: true,
      });
    }
    // else: all enemies have empty purchase_log (unparsed match) → skip
  }

  // Sort by |delta| descending; null delta (unique items) sort last (treated as 0 gap).
  anchors.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

  return anchors;
}

module.exports = {
  scanSpikeWindowDeltas,
  _SIGNIFICANT_GAP_SECONDS: SIGNIFICANT_GAP_SECONDS,
};
