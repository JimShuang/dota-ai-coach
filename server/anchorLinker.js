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
//
// Rule A3: death anchor followed by another death within A3_MAX_GAP seconds.
//   Hypothesis: the player died again shortly after respawning — a chain death
//   / over-eager re-engagement. See A3_MAX_GAP comment for the data limitation
//   this approximates around (no true respawn time available for OD imports).
//
// Rule A4: pace_deficit(significant) anchor followed by a death within
//   A4_MAX_GAP seconds, where the deficit was STILL OPEN at the time of the
//   death (not already closed by a pace_recovered). Hypothesis: the player
//   forced a fight while significantly behind on key items and died. Unlike
//   A1-A3, anchorA here is a 'pace' anchor, not a 'death' anchor — pace_deficit
//   is a state (it can be closed by a later pace_recovered), not an instant
//   event, so the rule must check recoveredAt to avoid attributing a death to
//   a deficit that was already resolved by the time the player died.

const GAP_THRESHOLD = 300; // seconds — momentum loss must follow death within 5 minutes
const A2_MAX_GAP    = 240; // seconds — spike_deficit must follow death within 4 minutes

// A3: max gap (seconds) between two deaths to call it a "chain death."
// The literal definition — "died again within 90s of respawning" — needs the
// respawn timestamp. hero_respawn is GSI-only (never reconstructed for OpenDota
// imports, and there's no respawn anchor in the chain at all), and imported
// hero_death snapshots are minimal ({killer, killerDisplayName, deathNumber,
// source}) — no level field, so respawn wait time can't be looked up either.
// So A3 approximates "died again shortly after respawning" using the raw gap
// between the two deaths instead of a computed respawn time. No estimation of
// respawn time is performed (no-guessing principle).
// A3_MAX_GAP ≈ average respawn wait (~60s) + the 90s quick-death window.
// Precision limit: late-game respawn waits can reach ~100s, so a death that is
// genuinely "within 90s of respawn" late-game can produce a raw gap exceeding
// this constant and be missed. Tune here if that proves too tight in practice.
const A3_MAX_GAP   = 150;
const A3_QUICK_GAP = 90; // gap this short or shorter reads as "died almost immediately after respawn"

// A4: pace_deficit is a persistent state, not an instant, so its window is
// generous compared to A1/A2/A3 (all of which chain off a death, an instant).
// Past 5 minutes other factors dominate and attribution gets too speculative
// — tune here if that proves too tight/loose in practice.
const A4_MAX_GAP  = 300; // seconds — max gap from deficit escalation to the death
const A4_NEAR_GAP = 120; // seconds — "the gap just opened up and they died almost immediately"

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

// ── Rule A3 ────────────────────────────────────────────────────────────────

/**
 * Score a death-→-death (chain death) link.
 *
 * Three-tier:  strong | medium | weak
 *   strong — the second death came quickly (≤ A3_QUICK_GAP) AND the first
 *            death was itself lethal (measurable downstream consequence)
 *   medium — either signal alone
 *   weak   — neither
 *
 * Reuses isLethalDeath (the same lethality signal as A1), so OD-import deaths
 * can reach 'strong'/'medium' via chainDeaths/economy signals, not just GSI's
 * critical severity.
 *
 * @param {object} firstDeath  Unified Anchor of kind 'death' (the earlier one)
 * @param {number} gap         Seconds between the two deaths
 * @returns {'strong'|'medium'|'weak'}
 */
function scoreA3(firstDeath, gap) {
  const quick  = gap <= A3_QUICK_GAP;
  const lethal = isLethalDeath(firstDeath);
  if (quick && lethal) return 'strong';
  if (quick || lethal) return 'medium';
  return 'weak';
}

/**
 * Rule A3: a hero_death anchor followed by another hero_death anchor within
 * A3_MAX_GAP seconds — approximates "died again shortly after respawning."
 *
 * Two gates (no third domain check — the gap itself is the evidence; there's
 * no further fact to verify beyond "did another death happen soon after"):
 *   1. anchorA.kind === 'death'
 *   2. anchorB.kind === 'death'
 *   3. gap = anchorB.gameTime − anchorA.gameTime is in (0, A3_MAX_GAP]
 *
 * Multi-death chains: when the dispatcher (linkAllAnchors) applies this rule
 * to every ordered anchor pair, three deaths d1,d2,d3 each ≤A3_MAX_GAP apart
 * can produce d1→d2, d2→d3, and (if d3−d1 ≤ A3_MAX_GAP) d1→d3 as three
 * separate links. This is intentional — it represents "repeated dying during
 * this stretch," not a single discrete event. A future "adjacent deaths only"
 * constraint could suppress the d1→d3 link, but is not implemented here.
 *
 * @param {object} anchorA  Unified Anchor (death, earlier)
 * @param {object} anchorB  Unified Anchor (death, later)
 * @returns {object|null}   Link object, or null if any gate fails
 */
function ruleA3(anchorA, anchorB) {
  // Gate 1
  if (anchorA.kind !== 'death') return null;
  // Gate 2
  if (anchorB.kind !== 'death') return null;
  // Gate 3
  const gap = anchorB.gameTime - anchorA.gameTime;
  if (gap <= 0 || gap > A3_MAX_GAP) return null;

  const score = scoreA3(anchorA, gap);

  return {
    rule:    'A3',
    anchors: [anchorA, anchorB],
    score,
    evidence: {
      gap_seconds:         gap,
      first_death_lethal:  isLethalDeath(anchorA),
      // deathNumber path differs by source: OD imports carry snapshot.deathNumber;
      // GSI deaths carry snapshot.deathsAtDeath (see deathToAnchor in anchorChain.js).
      first_death_number:  anchorA.detail?.snapshot?.deathNumber ?? anchorA.detail?.snapshot?.deathsAtDeath ?? null,
      second_death_number: anchorB.detail?.snapshot?.deathNumber ?? anchorB.detail?.snapshot?.deathsAtDeath ?? null,
    },
  };
}

// ── Rule A4 ────────────────────────────────────────────────────────────────

/**
 * Score a pace_deficit-→-death link.
 *
 * Three-tier: strong | medium | weak
 *   strong — the death came quickly (≤ A4_NEAR_GAP) after the deficit AND
 *            (the deficit was deep (≥3 items) OR the death traded no kill)
 *   medium — any one signal alone (near, deep, or no-trade)
 *   weak   — none of the above
 *
 * @param {{gap: number, deficitGap: number, noTrade: boolean}} params
 * @returns {'strong'|'medium'|'weak'}
 */
function scoreA4({ gap, deficitGap, noTrade }) {
  const near = gap <= A4_NEAR_GAP;
  const deep = deficitGap >= 3; // 3+ items behind is a crushing economic gap
  if (near && (deep || noTrade)) return 'strong';
  if (near || deep || noTrade) return 'medium';
  return 'weak';
}

/**
 * Rule A4: a pace_deficit(significant) anchor followed by a death within
 * A4_MAX_GAP seconds, where the deficit was STILL OPEN at the time of death.
 *
 * Three gates:
 *   1. anchorA.kind === 'pace' && anchorA.type === 'pace_deficit' &&
 *      anchorA.detail.significant === true
 *   2. anchorB.kind === 'death'
 *   3. gap = anchorB.gameTime − anchorA.gameTime is in (0, A4_MAX_GAP]
 *
 * One domain check (the crux of this rule): pace_deficit is a STATE, not an
 * instant — it can be closed by a later pace_recovered anchor before the
 * death happens, in which case attributing the death to "being behind" is
 * false causality (e.g. behind at 16:00, caught up at 19:00, died at 21:00 —
 * the deficit was long resolved). `recoveredAt` (set by scanPaceDeficits) is
 * checked against the death's gameTime: if the deficit closed at or before
 * the death, there's no link.
 *
 * @param {object} anchorA  Unified Anchor (kind='pace', type='pace_deficit')
 * @param {object} anchorB  Unified Anchor (kind='death')
 * @returns {object|null}   Link object, or null if any gate/check fails
 */
function ruleA4(anchorA, anchorB) {
  // Gate 1
  if (anchorA.kind !== 'pace' || anchorA.type !== 'pace_deficit') return null;
  if (anchorA.detail.significant !== true) return null;
  // Gate 2
  if (anchorB.kind !== 'death') return null;
  // Gate 3
  const gap = anchorB.gameTime - anchorA.gameTime;
  if (gap <= 0 || gap > A4_MAX_GAP) return null;

  // Domain check — the deficit must still be open at the time of death.
  const recoveredAt = anchorA.detail.recoveredAt;
  if (recoveredAt != null && recoveredAt <= anchorB.gameTime) return null;

  // Domain signal: died without trading a kill nearby — a pure loss, not a fight won.
  const ctx = anchorB.detail && anchorB.detail.context;
  const noTrade = !!(ctx && Array.isArray(ctx.killsNearby) && ctx.killsNearby.length === 0);

  const score = scoreA4({ gap, deficitGap: anchorA.detail.gap, noTrade });

  return {
    rule:    'A4',
    anchors: [anchorA, anchorB],
    score,
    evidence: {
      gap_seconds:  gap,
      deficit_gap:  anchorA.detail.gap,
      enemy_hero:   anchorA.detail.enemyHero,
      no_trade:     noTrade,
      recovered_at: recoveredAt ?? null,
    },
  };
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

// relation string per rule — used to build the endpoint-facing link shape.
const RELATION_BY_RULE = {
  A1: 'death_triggered_collapse',
  A2: 'death_delayed_spike',
  A3: 'death_chain',
  A4: 'deficit_forced_death',
};

const ALL_RULES = [ruleA1, ruleA2, ruleA3, ruleA4];

/**
 * Run every anchor-link rule over every ordered pair of anchors (a before b),
 * collecting all non-null results into the endpoint-facing link shape.
 *
 * A1-A3 require anchorA.kind === 'death'; A4 requires anchorA.kind === 'pace'
 * (type 'pace_deficit') — so the outer loop admits both kinds and lets each
 * rule's own gates reject the pairs it doesn't apply to (e.g. ruleA4 called
 * with a death anchorA returns null via its gate 1, same as ruleA1 called
 * with a pace anchorA returns null via its gate 1 — no cross-rule confusion).
 * The inner loop breaks once the gap exceeds the largest rule window
 * (currently GAP_THRESHOLD and A4_MAX_GAP tie at 300s), since anchors are
 * gameTime-sorted — individual rules apply their own tighter windows internally.
 *
 * @param {object[]} anchors  Unified Anchor array, sorted by gameTime ASC
 *                            (as produced by buildAnchorChain).
 * @returns {object[]}  { from, to, rule, relation, confidence, evidence }[]
 */
function linkAllAnchors(anchors) {
  const maxGap = Math.max(GAP_THRESHOLD, A2_MAX_GAP, A3_MAX_GAP, A4_MAX_GAP);
  const links = [];

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.kind !== 'death' && a.kind !== 'pace') continue;
    for (let j = i + 1; j < anchors.length; j++) {
      const b = anchors[j];
      if (b.gameTime - a.gameTime > maxGap) break;

      for (const rule of ALL_RULES) {
        const result = rule(a, b);
        if (result) {
          links.push({
            from:       a.gameTime,
            to:         b.gameTime,
            rule:       result.rule,
            relation:   RELATION_BY_RULE[result.rule],
            confidence: result.score,
            evidence:   result.evidence,
          });
        }
      }
    }
  }

  return links;
}

// ── Public API ─────────────────────────────────────────────────────────────

module.exports = {
  isLethalDeath, scoreA1, ruleA1, GAP_THRESHOLD,
  scoreA2, ruleA2, A2_MAX_GAP,
  scoreA3, ruleA3, A3_MAX_GAP, A3_QUICK_GAP,
  scoreA4, ruleA4, A4_MAX_GAP, A4_NEAR_GAP,
  linkAllAnchors,
};
