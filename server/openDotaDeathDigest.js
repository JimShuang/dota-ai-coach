'use strict';

// Annotates each hero_death event with battlefield context: other kills, chain deaths,
// objective events within ±5s/+60s of the death, and economy delta from the
// minute-granularity timeseries (when available).
//
// Pure function — no DB reads, no network. Input must be sorted by game_time ASC.
// Wire-in: server/index.js calls this with events + optional economy timeseries.

const { economyDeltaAroundDeath } = require('./openDotaEconomyTimeseries');

const WINDOW_BEFORE = 5;   // seconds before death (capture kill lead-up)
const WINDOW_AFTER  = 60;  // seconds after death  (capture respawn window)

// ── Helpers ────────────────────────────────────────────────────────────────

// Extract the minimal {game_time, message, snapshot} shape for context entries.
function slim(e) {
  return { game_time: e.game_time, message: e.message, snapshot: e.snapshot ?? null };
}

// Compute diedWithBuyback from a hero_death event.
// GSI deaths carry goldBeforeDeathPenalty; we use >= 200 as a minimum-gold proxy
// because the exact buyback cost (200 + 3.6% net_worth) isn't in the snapshot.
// OD-import deaths have no gold data → null.
function computeDiedWithBuyback(e) {
  const snap = e.snapshot;
  if (!snap) return null;
  if (snap.source === 'opendota_import') return null;
  if (snap.goldBeforeDeathPenalty == null) return null;
  return snap.goldBeforeDeathPenalty >= 200;
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Annotate each hero_death event with a context window of nearby events.
 *
 * @param {object[]} events            Full match_events array, sorted game_time ASC.
 * @param {object|null} [timeseries]   Optional output of buildEconomyTimeseries().
 *                                     When provided, context.economy carries delta data.
 *                                     When null/absent, context.economy.available === false.
 * @returns {object[]}                 Only the hero_death entries, each extended with .context.
 */
function buildDeathDigest(events, timeseries = null) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const deaths = events.filter((e) => e.type === 'hero_death');
  if (deaths.length === 0) return [];

  return deaths.map((death) => {
    const windowStart = death.game_time - WINDOW_BEFORE;
    const windowEnd   = death.game_time + WINDOW_AFTER;

    // All events in the window except the death itself
    const inWindow = events.filter(
      (e) => e !== death && e.game_time >= windowStart && e.game_time <= windowEnd
    );

    const chainDeaths = inWindow
      .filter((e) => e.type === 'hero_death')
      .map(slim);

    const killsNearby = inWindow
      .filter((e) => e.type === 'hero_kill')
      .map(slim);

    // Objective severity semantics (CLAUDE.md):
    //   danger  → own structure destroyed          → objectivesLost
    //   success → enemy structure destroyed         → objectivesGained
    //   warning → Roshan kill (either team)         → objectivesLost
    //             (Roshan during respawn window is always a major event)
    const objectiveEvents = inWindow.filter((e) => e.type === 'objective');

    const objectivesLost = objectiveEvents
      .filter((e) => e.severity === 'danger' || e.severity === 'warning')
      .map(slim);

    const objectivesGained = objectiveEvents
      .filter((e) => e.severity === 'success')
      .map(slim);

    const majorObjectiveLost = objectivesLost.some(
      (o) => o.snapshot?.objectiveType === 'barracks' || o.snapshot?.objectiveType === 'roshan'
    );

    return {
      ...death,
      context: {
        windowStart,
        windowEnd,
        chainDeaths,
        killsNearby,
        objectivesLost,
        objectivesGained,
        diedWithBuyback:    computeDiedWithBuyback(death),
        majorObjectiveLost,
        economy:            economyDeltaAroundDeath(timeseries, death.game_time),
      },
    };
  });
}

module.exports = { buildDeathDigest };
