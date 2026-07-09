// Run: node server/tests/matchDigest.test.js

'use strict';

const { buildMatchDigest, assembleChains, RULE_ENDPOINTS } = require('../matchDigest');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passed++;
  } else {
    console.error(`  FAIL  ${message}`);
    failed++;
  }
}

// ── Test data factories ─────────────────────────────────────────────────────

function makeAnchor(kind, gameTime, extra = {}) {
  return {
    gameTime,
    minute:   Math.floor(gameTime / 60),
    kind,
    type:     extra.type || kind,
    severity: extra.severity || 'info',
    summary:  extra.summary || `${kind}@${gameTime}`,
    detail:   extra.detail || { some: 'detail', for: kind },
  };
}

function makeLink(rule, from, to, confidence = 'medium', evidence = { gap_seconds: to - from }) {
  const RELATION_BY_RULE = {
    A1: 'death_triggered_collapse',
    A2: 'death_delayed_spike',
    A3: 'death_chain',
    A4: 'deficit_forced_death',
  };
  return { from, to, rule, relation: RELATION_BY_RULE[rule], confidence, evidence };
}

// ── RULE_ENDPOINTS shape ─────────────────────────────────────────────────────

console.log('\n── RULE_ENDPOINTS shape ─────────────────────────────────────────────');

assert(RULE_ENDPOINTS.A1.fromKind === 'death' && RULE_ENDPOINTS.A1.toKind === 'momentum', 'A1: death->momentum');
assert(RULE_ENDPOINTS.A2.fromKind === 'death' && RULE_ENDPOINTS.A2.toKind === 'spike', 'A2: death->spike');
assert(RULE_ENDPOINTS.A3.fromKind === 'death' && RULE_ENDPOINTS.A3.toKind === 'death', 'A3: death->death');
assert(RULE_ENDPOINTS.A4.fromKind === 'pace'  && RULE_ENDPOINTS.A4.toKind === 'death', 'A4: pace->death');

// ── Endpoint resolution ──────────────────────────────────────────────────────

console.log('\n── endpoint resolution ───────────────────────────────────────────────');

{
  // A3: both ends are kind='death' at different gameTimes — must resolve to
  // two distinct anchors, not the same one twice.
  const d1 = makeAnchor('death', 100);
  const d2 = makeAnchor('death', 200);
  const link = makeLink('A3', 100, 200, 'strong');
  const { chains } = assembleChains([d1, d2], [link]);
  assert(chains.length === 1, 'A3 death->death: produces one chain');
  assert(chains[0].anchor_count === 2, 'A3 death->death: chain has two distinct anchors');
  assert(chains[0].anchors[0].gameTime === 100 && chains[0].anchors[1].gameTime === 200,
    'A3 death->death: anchors are the two distinct death anchors, ordered by gameTime');
}

{
  // Same gameTime, different kind (pace and death coexist at the same second) —
  // resolution must pick the anchor matching the expected kind, not just gameTime.
  const paceAtT   = makeAnchor('pace', 500, { type: 'pace_deficit', detail: { significant: true, gap: 2 } });
  const deathAtT  = makeAnchor('death', 500);
  const deathLater = makeAnchor('death', 700);
  const link = makeLink('A4', 500, 700, 'medium'); // pace(500) -> death(700)
  const { chains, warnings } = assembleChains([paceAtT, deathAtT, deathLater], [link]);
  assert(warnings.length === 0, 'same-gameTime disambiguation: no warnings');
  assert(chains.length === 1, 'same-gameTime disambiguation: one chain produced');
  const kinds = chains[0].anchors.map((a) => a.kind).sort();
  assert(JSON.stringify(kinds) === JSON.stringify(['death', 'pace']),
    'same-gameTime disambiguation: chain contains the pace anchor and the later death, not deathAtT');
  assert(chains[0].anchors.some((a) => a.gameTime === 500 && a.kind === 'pace'),
    'same-gameTime disambiguation: from-endpoint resolved to the pace anchor at t=500');
}

{
  // Link pointing at a gameTime/kind combination that has no matching anchor.
  const d1 = makeAnchor('death', 100);
  const link = makeLink('A1', 100, 9999, 'weak'); // no momentum anchor at 9999
  const { chains, warnings } = assembleChains([d1], [link]);
  assert(chains.length === 0, 'unresolvable link: no chain produced');
  assert(warnings.length === 1, 'unresolvable link: recorded in warnings');
  assert(/could not resolve/.test(warnings[0]), 'unresolvable link: warning message is descriptive');
}

{
  // Unknown rule code — dropped defensively rather than throwing.
  const d1 = makeAnchor('death', 100);
  const m1 = makeAnchor('momentum', 200, { type: 'momentum_loss' });
  const link = { from: 100, to: 200, rule: 'A99', relation: 'unknown', confidence: 'weak', evidence: {} };
  const { chains, warnings } = assembleChains([d1, m1], [link]);
  assert(chains.length === 0, 'unknown rule: no chain produced');
  assert(warnings.length === 1 && /unknown rule/.test(warnings[0]), 'unknown rule: recorded in warnings');
}

// ── Chain assembly ───────────────────────────────────────────────────────────

console.log('\n── chain assembly ────────────────────────────────────────────────────');

{
  // Single link -> one chain, not multi-hop.
  const d1 = makeAnchor('death', 100);
  const m1 = makeAnchor('momentum', 200, { type: 'momentum_loss' });
  const link = makeLink('A1', 100, 200, 'medium');
  const { chains } = assembleChains([d1, m1], [link]);
  assert(chains.length === 1, 'single link: one chain');
  assert(chains[0].anchor_count === 2 && chains[0].link_count === 1, 'single link: 2 anchors, 1 link');
  assert(chains[0].is_multi_hop === false, 'single link: is_multi_hop=false');
  assert(chains[0].max_confidence === 'medium', 'single link: max_confidence = medium');
  assert(chains[0].span.start === 100 && chains[0].span.end === 200, 'single link: span correct');
}

{
  // Shared-anchor chaining: pace->death(A4) + death->momentum(A1) share the death
  // anchor -> must merge into ONE chain of 3 anchors / 2 links.
  const pace  = makeAnchor('pace', 100, { type: 'pace_deficit', detail: { significant: true, gap: 2 } });
  const death = makeAnchor('death', 300);
  const mom   = makeAnchor('momentum', 400, { type: 'momentum_loss' });
  const linkA4 = makeLink('A4', 100, 300, 'strong');
  const linkA1 = makeLink('A1', 300, 400, 'weak');
  const { chains } = assembleChains([pace, death, mom], [linkA4, linkA1]);
  assert(chains.length === 1, 'shared-anchor chaining: merges into one chain');
  assert(chains[0].anchor_count === 3 && chains[0].link_count === 2,
    'shared-anchor chaining: 3 anchors, 2 links');
  assert(chains[0].is_multi_hop === true, 'shared-anchor chaining: is_multi_hop=true');
  assert(chains[0].span.start === 100 && chains[0].span.end === 400, 'shared-anchor chaining: span correct');
  assert(chains[0].max_confidence === 'strong', 'shared-anchor chaining: max_confidence = strong (from A4)');
}

{
  // Branching: one death anchor is the `from` of both A1 and A2 -> one chain,
  // 3 anchors, 2 links (fan-out, not a linear path).
  const death = makeAnchor('death', 100);
  const mom   = makeAnchor('momentum', 300, { type: 'momentum_loss' });
  const spike = makeAnchor('spike', 250, { type: 'spike_deficit' });
  const linkA1 = makeLink('A1', 100, 300, 'weak');
  const linkA2 = makeLink('A2', 100, 250, 'medium');
  const { chains } = assembleChains([death, mom, spike], [linkA1, linkA2]);
  assert(chains.length === 1, 'branching: one chain from a fan-out death anchor');
  assert(chains[0].anchor_count === 3 && chains[0].link_count === 2, 'branching: 3 anchors, 2 links');
}

{
  // Two disjoint link groups -> two chains, sorted by span.start ascending, ids in order.
  const dEarly = makeAnchor('death', 50);
  const mEarly = makeAnchor('momentum', 150, { type: 'momentum_loss' });
  const dLate  = makeAnchor('death', 5000);
  const mLate  = makeAnchor('momentum', 5100, { type: 'momentum_loss' });
  const linkEarly = makeLink('A1', 50, 150, 'weak');
  const linkLate  = makeLink('A1', 5000, 5100, 'weak');
  // Pass in reverse order to confirm sorting, not input order, determines ids.
  const { chains } = assembleChains([dLate, mLate, dEarly, mEarly], [linkLate, linkEarly]);
  assert(chains.length === 2, 'disjoint groups: two chains');
  assert(chains[0].span.start === 50 && chains[1].span.start === 5000,
    'disjoint groups: sorted by span.start ascending');
  assert(chains[0].id === 'chain_1' && chains[1].id === 'chain_2', 'disjoint groups: ids assigned in span order');
}

{
  // max_confidence: strong + weak in the same chain -> strong wins.
  const pace  = makeAnchor('pace', 100, { type: 'pace_deficit', detail: { significant: true, gap: 3 } });
  const death = makeAnchor('death', 200);
  const death2 = makeAnchor('death', 260);
  const linkA4 = makeLink('A4', 100, 200, 'weak');
  const linkA3 = makeLink('A3', 200, 260, 'strong');
  const { chains } = assembleChains([pace, death, death2], [linkA4, linkA3]);
  assert(chains.length === 1, 'mixed confidence: one chain');
  assert(chains[0].max_confidence === 'strong', 'mixed confidence: strong beats weak');
}

// ── Standalone anchors & slimming ────────────────────────────────────────────

console.log('\n── standalone anchors & slimming ─────────────────────────────────────');

{
  const linked1   = makeAnchor('death', 100);
  const linked2   = makeAnchor('momentum', 200, { type: 'momentum_loss' });
  const unlinked1 = makeAnchor('spike', 50, { type: 'spike_lead' });
  const unlinked2 = makeAnchor('pace', 999, { type: 'pace_recovered' });
  const link = makeLink('A1', 100, 200, 'medium');

  const digest = buildMatchDigest({
    matchMeta: {},
    anchors: [linked1, linked2, unlinked1, unlinked2],
    links: [link],
    keyItemTimings: [],
  });

  assert(digest.standalone_anchors.length === 2, 'standalone: only the two unlinked anchors appear');
  assert(digest.standalone_anchors[0].gameTime === 50 && digest.standalone_anchors[1].gameTime === 999,
    'standalone: sorted by gameTime ascending');
  assert(!digest.standalone_anchors.some((a) => a.gameTime === 100 || a.gameTime === 200),
    'standalone: linked anchors do not also appear in standalone');

  assert(digest.standalone_anchors.every((a) => !('detail' in a)),
    'slimming: standalone anchors have no detail field');
  assert(digest.causal_chains[0].anchors.every((a) => !('detail' in a)),
    'slimming: chain anchors have no detail field');
  assert(digest.causal_chains[0].links[0].evidence !== undefined,
    'slimming: link.evidence is preserved verbatim on chain links');
  assert(digest.causal_chains[0].links[0].evidence.gap_seconds === 100,
    'slimming: link.evidence content unchanged');
}

// ── Overall boundary conditions ──────────────────────────────────────────────

console.log('\n── boundary conditions ───────────────────────────────────────────────');

{
  const anchors = [makeAnchor('death', 10), makeAnchor('momentum', 20, { type: 'momentum_loss' })];
  const digest = buildMatchDigest({ matchMeta: { hero: 'razor', deaths: 3 }, anchors, links: [], keyItemTimings: [] });
  assert(digest.causal_chains.length === 0, 'links empty: causal_chains is []');
  assert(digest.standalone_anchors.length === 2, 'links empty: all anchors go to standalone');
}

{
  const links = [makeLink('A1', 10, 20, 'weak')];
  const digest = buildMatchDigest({ matchMeta: {}, anchors: [], links, keyItemTimings: [] });
  assert(digest.causal_chains.length === 0, 'anchors empty: causal_chains is [] (nothing to resolve)');
  assert(digest.standalone_anchors.length === 0, 'anchors empty: standalone_anchors is []');
  assert(digest.warnings.length === 1, 'anchors empty: unresolvable link recorded as a warning');
  assert(digest.meta.hero === null, 'anchors empty: meta still computed (hero null)');
}

{
  // meta / stats passthrough with a fully populated matchMeta.
  const matchMeta = {
    hero: 'centaur', result: 'win', duration: 2400,
    kills: 5, deaths: 3, assists: 12, gpm: 480, xpm: 520,
    overall_grade: 'B+', pre_key_item_deaths: 1,
  };
  const keyItemTimings = [{ item_name: 'item_vanguard', completed: 1, completed_time: 600, deaths_before_completion: 0 }];
  const digest = buildMatchDigest({ matchMeta, anchors: [], links: [], keyItemTimings });

  assert(digest.meta.hero === 'centaur', 'meta passthrough: hero');
  assert(digest.meta.result === 'win', 'meta passthrough: result');
  assert(digest.meta.duration === 2400, 'meta passthrough: duration');
  assert(JSON.stringify(digest.meta.kda) === JSON.stringify({ kills: 5, deaths: 3, assists: 12 }),
    'meta passthrough: kda object');
  assert(digest.meta.gpm === 480 && digest.meta.xpm === 520, 'meta passthrough: gpm/xpm');
  assert(digest.meta.grade === 'B+', 'meta passthrough: grade = overall_grade');

  assert(digest.stats.deaths_summary.total === 3, 'stats passthrough: deaths_summary.total = matchMeta.deaths');
  assert(digest.stats.deaths_summary.pre_key_item === 1, 'stats passthrough: pre_key_item = matchMeta.pre_key_item_deaths');
  assert(digest.stats.deaths_summary.in_power_spike === null, 'stats passthrough: in_power_spike is null (no source column)');
  assert(digest.stats.deaths_summary.no_tp === null, 'stats passthrough: no_tp is null (no source column)');
  assert(digest.stats.key_item_timings === keyItemTimings, 'stats passthrough: key_item_timings passed through verbatim');
}

{
  // Missing matchMeta fields -> null, not undefined or throw.
  const digest = buildMatchDigest({ matchMeta: {}, anchors: [], links: [], keyItemTimings: [] });
  assert(digest.meta.hero === null && digest.meta.result === null && digest.meta.duration === null,
    'missing meta fields: hero/result/duration all null');
  assert(digest.meta.kda.kills === null && digest.meta.kda.deaths === null && digest.meta.kda.assists === null,
    'missing meta fields: kda fields all null');
  assert(digest.meta.gpm === null && digest.meta.xpm === null && digest.meta.grade === null,
    'missing meta fields: gpm/xpm/grade all null');
  assert(digest.stats.deaths_summary.total === null && digest.stats.deaths_summary.pre_key_item === null,
    'missing meta fields: deaths_summary falls back to null');
}

{
  // buildMatchDigest called with no arguments at all.
  const digest = buildMatchDigest();
  assert(digest.causal_chains.length === 0 && digest.standalone_anchors.length === 0,
    'no-args call: empty chains and standalone');
  assert(digest.meta.hero === null, 'no-args call: meta defaults to nulls');
  assert(Array.isArray(digest.warnings), 'no-args call: warnings is an array');
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
