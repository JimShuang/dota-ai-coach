'use strict';

// Scans enemy vs. player power-spike timing. Two independent analyses live here:
//
//   scanSpikeWindowDeltas() — per-item: for each generic key item the player
//     bought, how does its timing compare to the SAME item bought by an enemy?
//     Answers "who got this specific item first."
//
//   scanPaceDeficits()      — aggregate: across ALL generic key items (any
//     bucket), how many has the fastest enemy completed vs. how many has the
//     player completed? Answers "am I behind on total item count, regardless
//     of which specific items." The fourth class of anchor points (first:
//     hero_death, second: momentum shifts, third: per-item spike deltas).
//
// Deliberately isolated: no imports from event / death / digest / timeseries / momentum modules.
// Only dependencies: genericPowerSpikeItems.js and dotaHeroNames.js.
//
// Input: the players[] array from an OpenDota raw match response and the selected player slot.
// Precision: second-granularity from purchase_log timestamps.

const { POWER_SPIKE_ITEMS, ALL_SPIKE_ITEMS } = require('./data/genericPowerSpikeItems');
const { getHeroName }        = require('./data/dotaHeroNames');

// ── Threshold constants ────────────────────────────────────────────────────
const SIGNIFICANT_GAP_SECONDS = 120;  // |delta| > this → anchor is flagged as significant

// Pace deficit constants — see scanPaceDeficits() below.
const PACE_GRACE_SECONDS   = 120;  // "completed within the same window" grace period
const PACE_SIGNIFICANT_GAP = 2;    // offlane (pos 3) is naturally ~1 item behind core roles;
                                    // only a 2+ item gap is flagged as significant

// ── Helpers ────────────────────────────────────────────────────────────────

// Radiant slots: 0–4; Dire slots: 128–132.
function isRadiant(playerSlot) { return playerSlot < 128; }

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Produce spike-window delta anchors — one per spike item purchased by the player.
 *
 * Exact-match only: the comparison target for each item the player bought is
 * the enemy's earliest purchase of that SAME item. There is no bucket-level
 * fallback — an item in the same ability bucket but with a different key is
 * never substituted as a comparison target, because that would compare two
 * different items and produce a misleading timing delta. When no enemy
 * bought the same item, the anchor still reports a null-delta "unique power
 * spike" (see below) rather than silently disappearing.
 *
 * Aggregate total-item-count comparisons (regardless of which specific items)
 * are handled separately by scanPaceDeficits().
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

// ── Pace deficit scanner ─────────────────────────────────────────────────────

// Build the deduplicated, time-ordered "key item completion" list for one
// player: first purchase of each item in ALL_SPIKE_ITEMS, sorted by time.
// Rebuys/restocks of the same item (later purchase_log entries with the same
// key) are ignored — only the earliest counts as "completed."
function buildCompletions(log) {
  if (!log || !Array.isArray(log) || log.length === 0) return [];
  const filtered = log
    .filter((e) => ALL_SPIKE_ITEMS.has(e.key) && typeof e.time === 'number')
    .sort((a, b) => a.time - b.time);
  const seen = new Set();
  const result = [];
  for (const entry of filtered) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    result.push({ time: entry.time, item: entry.key });
  }
  return result;
}

// Count of completions at-or-before time t. `completions` must be time-sorted
// ascending (as returned by buildCompletions).
function countAtOrBefore(completions, t) {
  let count = 0;
  for (const c of completions) {
    if (c.time <= t) count++;
    else break;
  }
  return count;
}

/**
 * Produce pace anchors — aggregate key-item-count comparisons, independent of
 * which specific items were bought. Complements scanSpikeWindowDeltas() (which
 * compares matching items one-for-one): this answers "am I behind on total
 * key item count against the fastest enemy," which per-item comparisons can't
 * capture when the player and the leading enemy are building different items.
 *
 * Positional asymmetry: the offlane (pos 3) role naturally completes key
 * items later than enemy cores. A 1-item gap is expected and not flagged as
 * significant; only a gap of PACE_SIGNIFICANT_GAP (2) or more is.
 *
 * Algorithm: walk a single merged, time-ordered timeline of every enemy's
 * completion events and the player's own completion events.
 *   - On an enemy completion (enemy reaches cumulative count N at time T):
 *     compute the player's count M as of T + PACE_GRACE_SECONDS (grace window
 *     — completing the item shortly after doesn't count as "being behind").
 *     If the resulting gap (N − M) is >= 1 and exceeds the largest gap
 *     already emitted in the current deficit episode, emit a pace_deficit
 *     anchor and raise the escalation watermark. This "only emit on a new
 *     high" rule avoids one anchor per enemy purchase.
 *   - On the player's own completion (player reaches count M at time T):
 *     if currently in a deficit episode and M now matches or exceeds the
 *     highest enemy count as of T, emit one pace_recovered anchor and reset
 *     the episode, so a later deficit starts its own escalation from 1.
 *
 * @param {object[]} players              players[] from OpenDota raw match data
 * @param {number}   selectedPlayerSlot   player_slot of the user's hero (0–4 radiant, 128–132 dire)
 * @returns {Array<{
 *   gameTime, type, myCount, enemyCount, gap, enemyHero, triggerItem, significant
 * }>}  Sorted by gameTime ascending.
 */
function scanPaceDeficits(players, selectedPlayerSlot) {
  if (!Array.isArray(players) || players.length === 0) return [];

  const myPlayer = players.find((p) => p.player_slot === selectedPlayerSlot);
  if (!myPlayer) return [];

  // purchase_log must at least be present (an array, possibly empty) — a
  // missing/null log means the replay isn't parsed and we can't compute
  // anything. An empty array (0 completions) is a legitimate game state and
  // is handled normally below.
  if (!Array.isArray(myPlayer.purchase_log)) return [];

  const myTeamRadiant = isRadiant(selectedPlayerSlot);
  const enemies = players.filter((p) => isRadiant(p.player_slot) !== myTeamRadiant);
  if (enemies.length === 0) return [];

  const myCompletions = buildCompletions(myPlayer.purchase_log);
  const enemyData = enemies.map((e) => ({
    hero:        getHeroName(e.hero_id),
    completions: buildCompletions(e.purchase_log),
  }));

  // Flatten every enemy's completion events into one array, each tagged with
  // that enemy's own running count at that moment.
  const enemyEvents = [];
  for (const ed of enemyData) {
    ed.completions.forEach((c, i) => {
      enemyEvents.push({ time: c.time, item: c.item, hero: ed.hero, count: i + 1 });
    });
  }
  if (enemyEvents.length === 0) return []; // no enemy ever completed a key item

  // Merge enemy completion events with the player's own, sorted ascending.
  const timeline = [
    ...enemyEvents.map((ev) => ({ kind: 'enemy', ...ev })),
    ...myCompletions.map((c, i) => ({ kind: 'me', time: c.time, item: c.item, count: i + 1 })),
  ].sort((a, b) => a.time - b.time);

  function enemyMaxAt(t) {
    let max = 0;
    let hero = null;
    for (const ed of enemyData) {
      const c = countAtOrBefore(ed.completions, t);
      if (c > max) { max = c; hero = ed.hero; }
    }
    return { max, hero };
  }

  const anchors = [];
  let maxGap = 0;
  let behind = false;

  for (const ev of timeline) {
    if (ev.kind === 'enemy') {
      const M   = countAtOrBefore(myCompletions, ev.time + PACE_GRACE_SECONDS);
      const gap = ev.count - M;
      if (gap >= 1 && gap > maxGap) {
        anchors.push({
          gameTime:    ev.time,
          type:        'pace_deficit',
          myCount:     M,
          enemyCount:  ev.count,
          gap,
          enemyHero:   ev.hero,
          triggerItem: ev.item,
          significant: gap >= PACE_SIGNIFICANT_GAP,
        });
        maxGap = gap;
        behind = true;
      }
    } else if (behind) {
      const { max: enemyMax, hero: enemyHero } = enemyMaxAt(ev.time);
      if (ev.count >= enemyMax) {
        anchors.push({
          gameTime:    ev.time,
          type:        'pace_recovered',
          myCount:     ev.count,
          enemyCount:  enemyMax,
          gap:         enemyMax - ev.count,
          enemyHero,
          triggerItem: ev.item,
          significant: false,
        });
        behind = false;
        maxGap = 0;
      }
    }
  }

  return anchors;
}

module.exports = {
  scanSpikeWindowDeltas,
  scanPaceDeficits,
  _SIGNIFICANT_GAP_SECONDS: SIGNIFICANT_GAP_SECONDS,
  _PACE_GRACE_SECONDS:      PACE_GRACE_SECONDS,
  _PACE_SIGNIFICANT_GAP:    PACE_SIGNIFICANT_GAP,
};
