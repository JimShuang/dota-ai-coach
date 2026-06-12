'use strict';

// Extracts kill and death timeline for one player from OpenDota raw match data.
//
// Pure functions — no DB reads, no network.
//
// OpenDota data model facts:
//   player.kills_log: [{ time, key }]   key = victim's npc_dota_hero_xxx name
//   There is no per-player death log.
//   Deaths are reconstructed by scanning every other player's kills_log for
//   entries where key === selected player's internal hero name.
//   Tower / creep / Roshan kills don't appear in any kills_log, so
//   reconstructed deaths ≤ player.deaths — the gap is an inherent data limit.

const { HERO_NAMES, HERO_INTERNAL_NAMES, getHeroName } = require('./data/dotaHeroNames');

// ── Reverse lookup: internal name → display name ───────────────────────────
// Derived at load time from the single source of truth in dotaHeroNames.js.

const INTERNAL_TO_HERO_ID = Object.fromEntries(
  Object.entries(HERO_INTERNAL_NAMES).map(([id, name]) => [name, Number(id)])
);

/**
 * Map an npc_dota_hero_xxx string to a player-facing display name.
 * Profile heroes → 中文（English）format. Others → English. Unknown → strip prefix.
 */
function heroDisplayNameFromInternal(internalName) {
  if (!internalName || typeof internalName !== 'string') return '未知英雄';
  const heroId = INTERNAL_TO_HERO_ID[internalName];
  if (heroId != null) return HERO_NAMES[heroId] || `Hero #${heroId}`;
  // Fallback: strip npc_dota_hero_ and title-case
  const stripped = internalName.replace(/^npc_dota_hero_/, '').replace(/_/g, ' ').trim();
  return stripped ? stripped.replace(/\b\w/g, (c) => c.toUpperCase()) : '未知英雄';
}

// ── Main extractor ─────────────────────────────────────────────────────────

/**
 * Extract kill and death timeline for the player at selectedPlayerSlot.
 *
 * @param {object[]} players           - Raw OpenDota players array
 * @param {number}   selectedPlayerSlot - player_slot value of the target player
 * @returns {{
 *   kills:  { time: number, victim: string }[],
 *   deaths: { time: number, killer: string }[],
 *   deathStats: { reconstructed: number, total: number, missing: number }
 * }}
 */
function extractKillDeath(players, selectedPlayerSlot) {
  const empty = {
    kills:      [],
    deaths:     [],
    deathStats: { reconstructed: 0, total: 0, missing: 0 },
  };

  if (!Array.isArray(players) || players.length === 0) return empty;

  const selected = players.find((p) => p.player_slot === selectedPlayerSlot);
  if (!selected) return empty;

  const totalDeaths = selected.deaths || 0;

  // ── Kills: selected player's own kills_log ─────────────────────────────
  const kills = [];
  if (Array.isArray(selected.kills_log)) {
    for (const entry of selected.kills_log) {
      if (entry?.key == null) continue;
      kills.push({
        time:   entry.time,
        victim: heroDisplayNameFromInternal(entry.key),
      });
    }
  }
  kills.sort((a, b) => a.time - b.time);

  // ── Deaths: scan every other player's kills_log for this hero ─────────
  const selectedInternalName = HERO_INTERNAL_NAMES[selected.hero_id] ?? null;
  const deaths = [];

  if (selectedInternalName) {
    for (const other of players) {
      if (other.player_slot === selectedPlayerSlot) continue;
      if (!Array.isArray(other.kills_log)) continue;
      for (const entry of other.kills_log) {
        if (entry?.key === selectedInternalName) {
          deaths.push({
            time:   entry.time,
            killer: getHeroName(other.hero_id),
          });
        }
      }
    }
  }
  deaths.sort((a, b) => a.time - b.time);

  const reconstructed = deaths.length;
  const missing       = Math.max(0, totalDeaths - reconstructed);

  return { kills, deaths, deathStats: { reconstructed, total: totalDeaths, missing } };
}

module.exports = { extractKillDeath, heroDisplayNameFromInternal };
