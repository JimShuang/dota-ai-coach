'use strict';

// Links pairs of anchors where one event plausibly caused or followed another.
// Pure function — no I/O, no DB. Takes unified anchor chain entries as input.
//
// Does NOT import any scanner module. Receives anchor objects (output of
// anchorChain.js mappers) as parameters.
//
// Rule A1: death anchor followed by momentum_loss within GAP_THRESHOLD seconds.
//   Hypothesis: the death triggered (or was part of) the team momentum shift.

const GAP_THRESHOLD = 300; // seconds — momentum loss must follow death within 5 minutes

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

// ── Public API ─────────────────────────────────────────────────────────────

module.exports = { isLethalDeath, scoreA1, ruleA1, GAP_THRESHOLD };
