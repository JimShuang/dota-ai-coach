'use strict';

// Links pairs of anchors where one event plausibly caused or followed another.
// Pure function — no I/O, no DB. Takes unified anchor chain entries as input.
//
// Does NOT import any scanner module. Receives anchor objects (output of
// anchorChain.js mappers) as parameters.
//
// Rule A1: death anchor followed by momentum_loss within GAP_THRESHOLD seconds.
//   Hypothesis: the death triggered (or was part of) the team momentum shift.
//
// Rule A2: death anchor followed by spike_deficit within A2_MAX_GAP seconds.
//   Hypothesis: the death was costly enough to delay a key item, causing the
//   player to fall behind the matching enemy's power spike.

const GAP_THRESHOLD = 300; // seconds — momentum loss must follow death within 5 minutes
const A2_MAX_GAP    = 240; // seconds — spike_deficit must follow death within 4 minutes

// ── Lethality helper ───────────────────────────────────────────────────────

/**
 * Is this death anchor "lethal" — does it carry measurable downstream consequences
 * detectable from OpenDota import data?
 *
 * Three OR signals:
 *   chainDeaths      — other deaths occurred in the ±5s/+60s context window,
 *                      indicating a teamwipe cascade (from death digest context)
 *   economyCollapse  — economy advantage deteriorated significantly in the minute
 *                      around the death (from death digest economy delta)
 *   critical         — GSI severity flag; OD imports are always 'danger', so this
 *                      is always false for imports — kept for GSI compatibility only
 *
 * @param {object} deathAnchor  Unified Anchor of kind 'death'
 * @returns {boolean}
 */
function isLethalDeath(deathAnchor) {
  const ctx = deathAnchor.detail && deathAnchor.detail.context;
  if (!ctx) return false;
  const chainedDeaths   = Array.isArray(ctx.chainDeaths) && ctx.chainDeaths.length > 0;
  const economyCollapse = !!(ctx.economy && ctx.economy.available && ctx.economy.significant);
  const critical        = deathAnchor.severity === 'critical'; // GSI compat; OD imports: always false
  return chainedDeaths || economyCollapse || critical;
}

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Score a death-→-momentum-loss link.
 *
 * Three-tier:  strong | medium | weak
 *   strong — death is both temporally close (≤ 45 s) AND lethal (has measurable consequence)
 *   medium — either close OR lethal (one signal present)
 *   weak   — neither
 *
 * The 'strong' tier is now reachable for OpenDota imports (via chainDeaths /
 * economy signals), unlike the old critical-only approach where OD imports
 * could never exceed 'medium'.
 *
 * @param {object} deathAnchor  Unified Anchor of kind 'death'
 * @param {number} gap          Seconds between death and the following momentum shift
 * @returns {'strong'|'medium'|'weak'}
 */
function scoreA1(deathAnchor, gap) {
  const near   = gap <= 45;
  const lethal = isLethalDeath(deathAnchor);
  if (near && lethal) return 'strong';
  if (near || lethal) return 'medium';
  return 'weak';
}

// ── Rule A1 ────────────────────────────────────────────────────────────────

/**
 * Rule A1: a hero_death anchor followed by a momentum_loss anchor within
 * GAP_THRESHOLD seconds.
 *
 * Three gates (none change with scoreA1 refactor):
 *   1. anchorA.kind === 'death'
 *   2. anchorB.kind === 'momentum' && anchorB.type === 'momentum_loss'
 *   3. gap = anchorB.gameTime − anchorA.gameTime is in [0, GAP_THRESHOLD]
 *
 * @param {object} anchorA  Unified Anchor (death)
 * @param {object} anchorB  Unified Anchor (momentum)
 * @returns {object|null}   Link object, or null if any gate fails
 */
function ruleA1(anchorA, anchorB) {
  // Gate 1
  if (anchorA.kind !== 'death') return null;
  // Gate 2
  if (anchorB.kind !== 'momentum' || anchorB.type !== 'momentum_loss') return null;
  // Gate 3
  const gap = anchorB.gameTime - anchorA.gameTime;
  if (gap < 0 || gap > GAP_THRESHOLD) return null;

  const score = scoreA1(anchorA, gap);
  const ctx   = anchorA.detail && anchorA.detail.context;

  return {
    rule:    'A1',
    anchors: [anchorA, anchorB],
    score,
    evidence: {
      gap_seconds:         gap,
      death_severity:      anchorA.severity,
      chain_deaths:        (ctx && Array.isArray(ctx.chainDeaths) ? ctx.chainDeaths.length : 0),
      economy_significant: !!(ctx && ctx.economy && ctx.economy.available && ctx.economy.significant),
      lethal:              isLethalDeath(anchorA),
      slope_after:         anchorB.detail.slopeAfter,
      magnitude:           anchorB.detail.magnitude,
    },
  };
}

// ── Rule A2 ────────────────────────────────────────────────────────────────

/**
 * Score a death-→-spike_deficit link.
 *
 * Four-tier:  strong | medium | weak
 *   strong — a buyback-affordable death that precedes a significant deficit,
 *            or a costly death (economy-significant or buyback) close (≤120s)
 *            to the deficit
 *   medium — either the spike deficit itself is significant, or the death's
 *            economy impact was significant, but not both/close enough for strong
 *   weak   — neither signal present
 *
 * `hadBuyback` is only ever true for GSI deaths (OpenDota imports carry no gold
 * data, so `diedWithBuyback` is always null/false there). `econSignificant` is
 * therefore the only path to 'strong'/'medium' for imported matches.
 *
 * @param {{gap:number, hadBuyback:boolean, econSignificant:boolean, spikeSignificant:boolean}} params
 * @returns {'strong'|'medium'|'weak'}
 */
function scoreA2({ gap, hadBuyback, econSignificant, spikeSignificant }) {
  if (hadBuyback && spikeSignificant) return 'strong';
  if ((econSignificant || hadBuyback) && gap <= 120) return 'strong';
  if (spikeSignificant || econSignificant) return 'medium';
  return 'weak';
}

/**
 * Rule A2: a hero_death anchor followed by a spike_deficit anchor within
 * A2_MAX_GAP seconds, where the death carried a measurable economic cost and
 * the deficit item actually completed after the death.
 *
 * Three gates:
 *   1. anchorA.kind === 'death'
 *   2. anchorB.kind === 'spike' && anchorB.type === 'spike_deficit'
 *   3. gap = anchorB.gameTime − anchorA.gameTime is in (0, A2_MAX_GAP]
 *
 * Two domain checks (beyond the gates):
 *   ① costlyEnough  — death had buyback available (GSI) or a significant
 *                      economy deterioration (either source) — a proxy for
 *                      "this death actually cost something", since the exact
 *                      gold lost to the death penalty isn't in the snapshot.
 *   ② myTime check  — the deficit item's completion time must be strictly
 *                      after the death; otherwise the item was already done
 *                      and this death can't have delayed it.
 *
 * @param {object} anchorA  Unified Anchor (death)
 * @param {object} anchorB  Unified Anchor (spike, type spike_deficit)
 * @returns {object|null}   Link object, or null if any gate/check fails
 */
function ruleA2(anchorA, anchorB) {
  // Gate 1
  if (anchorA.kind !== 'death') return null;
  // Gate 2
  if (anchorB.kind !== 'spike' || anchorB.type !== 'spike_deficit') return null;
  // Gate 3
  const gap = anchorB.gameTime - anchorA.gameTime;
  if (gap <= 0 || gap > A2_MAX_GAP) return null;

  const ctx  = anchorA.detail && anchorA.detail.context;
  const econ = ctx && ctx.economy;
  const hadBuyback      = !!(ctx && ctx.diedWithBuyback === true);
  const econSignificant = !!(econ && econ.available && econ.significant);

  // Domain check ① — death must carry a measurable economic cost
  const costlyEnough = hadBuyback || econSignificant;
  if (!costlyEnough) return null;

  // Domain check ② — the item must have completed strictly after the death
  const myTime = anchorB.detail.myTime;
  if (myTime == null) return null;
  if (myTime <= anchorA.gameTime) return null;

  const spikeSignificant = anchorB.detail.significant === true;
  const score = scoreA2({ gap, hadBuyback, econSignificant, spikeSignificant });

  return {
    rule:    'A2',
    anchors: [anchorA, anchorB],
    score,
    evidence: {
      gap_seconds:         gap,
      economy_delta:       econ && econ.delta != null ? econ.delta : null,
      economy_significant: econSignificant,
      had_buyback:         hadBuyback,
      my_item:             anchorB.detail.myItem,
      my_item_time:        myTime,
      enemy_item:          anchorB.detail.enemyItem,
      enemy_item_time:     anchorB.detail.enemyTime,
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

module.exports = {
  isLethalDeath, scoreA1, ruleA1, GAP_THRESHOLD,
  scoreA2, ruleA2, A2_MAX_GAP,
};
