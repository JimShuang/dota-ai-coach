// Run: node server/tests/matchDigestSchema.test.js
//
// Validates buildMatchDigest() output against server/schemas/matchDigest.schema.json
// using ajv (devDependency only -- never required by runtime code; the schema
// contract is enforced by this test suite, not by the endpoint at request time).

'use strict';

const path = require('path');
const Ajv2020 = require('ajv/dist/2020').default;
const { buildMatchDigest } = require('../matchDigest');

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

const ajv = new Ajv2020({ strict: true, allErrors: true });
const schema = require(path.resolve(__dirname, '../schemas/matchDigest.schema.json'));
const validate = ajv.compile(schema); // throws here if the schema itself is malformed

function errorsText() {
  return (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
}

// ── Test data factories (mirrors matchDigest.test.js) ───────────────────────

function makeAnchor(kind, gameTime, extra = {}) {
  return {
    gameTime,
    minute:   Math.floor(gameTime / 60),
    kind,
    type:     extra.type || (kind === 'death' ? 'hero_death' : kind),
    severity: extra.severity || (kind === 'death' ? 'danger' : 'info'),
    summary:  extra.summary || `${kind}@${gameTime}`,
    detail:   extra.detail || { some: 'detail', for: kind },
  };
}

const RELATION_BY_RULE = {
  A1: 'death_triggered_collapse',
  A2: 'death_delayed_spike',
  A3: 'death_chain',
  A4: 'deficit_forced_death',
};

function makeLink(rule, from, to, confidence, evidence) {
  return { from, to, rule, relation: RELATION_BY_RULE[rule], confidence, evidence };
}

function evidenceA1() {
  return { gap_seconds: 30, death_severity: 'danger', chain_deaths: 1, economy_significant: true, lethal: true, slope_after: -500, magnitude: 800 };
}
function evidenceA2({ nullish = false } = {}) {
  return {
    gap_seconds: 90,
    economy_delta: nullish ? null : -1200,
    economy_significant: true,
    had_buyback: true,
    my_item: 'item_black_king_bar',
    my_item_time: 1200,
    enemy_item: nullish ? null : 'item_black_king_bar',
    enemy_item_time: nullish ? null : 1000,
  };
}
function evidenceA3({ nullish = false } = {}) {
  return {
    gap_seconds: 60,
    first_death_lethal: true,
    first_death_number: nullish ? null : 2,
    second_death_number: nullish ? null : 3,
  };
}
function evidenceA4({ nullish = false } = {}) {
  return {
    gap_seconds: 100,
    deficit_gap: 3,
    enemy_hero: 'Pudge',
    no_trade: true,
    recovered_at: nullish ? null : 900,
  };
}

const fullKeyItemTiming = {
  id: 1, match_id: 'm1', item_name: 'item_vanguard', completed: 1,
  completed_time: 600, deaths_before_completion: 2, power_spike_used: 1,
  created_at: '2026-01-01 00:00:00',
};

const fullMatchMeta = {
  hero: 'npc_dota_hero_centaur', result: '胜利', duration: 2400,
  kills: 5, deaths: 3, assists: 12, gpm: 450, xpm: 520,
  overall_grade: '良好', pre_key_item_deaths: 1,
};

// ── 1. Full-shape digest validates ──────────────────────────────────────────

console.log('\n── full-shape digest validates against schema ───────────────────────');

{
  // Build one anchor set that exercises all four rules plus a multi-hop chain
  // plus standalone anchors plus a negative-gameTime anchor.
  const pace   = makeAnchor('pace', -30, { type: 'pace_deficit', detail: { significant: true, gap: 3 } }); // negative gameTime
  const d1     = makeAnchor('death', 100);
  const mom    = makeAnchor('momentum', 200, { type: 'momentum_loss' });
  const spike  = makeAnchor('spike', 250, { type: 'spike_deficit' });
  const d2     = makeAnchor('death', 300);
  const standaloneSpike = makeAnchor('spike', 50, { type: 'spike_lead' });
  const standalonePace  = makeAnchor('pace', 999, { type: 'pace_recovered' });

  const linkA4 = makeLink('A4', -30, 100, 'strong', evidenceA4());
  const linkA1 = makeLink('A1', 100, 200, 'medium', evidenceA1());
  const linkA2 = makeLink('A2', 100, 250, 'weak',   evidenceA2({ nullish: true }));
  const linkA3 = makeLink('A3', 100, 300, 'medium', evidenceA3());

  const digest = buildMatchDigest({
    matchMeta: fullMatchMeta,
    anchors: [pace, d1, mom, spike, d2, standaloneSpike, standalonePace],
    links: [linkA4, linkA1, linkA2, linkA3],
    keyItemTimings: [fullKeyItemTiming],
  });

  const ok = validate(digest);
  assert(ok, `full-shape digest passes schema validation${ok ? '' : ' -- ' + errorsText()}`);
  assert(digest.schema_version === 1, 'schema_version is 1');
  assert(digest.causal_chains.length === 1 && digest.causal_chains[0].is_multi_hop === true,
    'sanity: the four links merged into one multi-hop chain (fixture check, not schema)');
  assert(digest.standalone_anchors.length === 2, 'sanity: two standalone anchors remain (fixture check, not schema)');
}

// ── 2. Empty match validates ─────────────────────────────────────────────────

console.log('\n── empty match (no anchors, no links) validates ─────────────────────');

{
  const digest = buildMatchDigest({ matchMeta: {}, anchors: [], links: [], keyItemTimings: [] });
  const ok = validate(digest);
  assert(ok, `empty-match digest passes schema validation${ok ? '' : ' -- ' + errorsText()}`);
}

{
  // no-args call also produces a schema-valid (all-null/empty) digest
  const digest = buildMatchDigest();
  const ok = validate(digest);
  assert(ok, `no-args digest passes schema validation${ok ? '' : ' -- ' + errorsText()}`);
}

// ── 3. Negative fixtures -- schema must actually reject bad shapes ──────────

console.log('\n── negative fixtures: schema rejects malformed digests ──────────────');

function baseValidDigest() {
  const d1  = makeAnchor('death', 100);
  const mom = makeAnchor('momentum', 200, { type: 'momentum_loss' });
  const link = makeLink('A1', 100, 200, 'medium', evidenceA1());
  return buildMatchDigest({
    matchMeta: fullMatchMeta,
    anchors: [d1, mom],
    links: [link],
    keyItemTimings: [fullKeyItemTiming],
  });
}

{
  const digest = baseValidDigest();
  assert(validate(digest), 'control: baseValidDigest() itself is schema-valid before mutation');
}

{
  // Extra top-level property -- additionalProperties:false must catch it.
  const digest = baseValidDigest();
  digest.extra_field = 'should not be here';
  assert(!validate(digest), 'rejects: unexpected extra top-level property');
}

{
  // Illegal confidence value on a link.
  const digest = baseValidDigest();
  digest.causal_chains[0].links[0].confidence = 'super-strong';
  assert(!validate(digest), 'rejects: illegal confidence enum value');
}

{
  // A1 link carrying A2-shaped evidence -- the discriminated union must catch this.
  const digest = baseValidDigest();
  digest.causal_chains[0].links[0].evidence = evidenceA2();
  assert(!validate(digest), 'rejects: rule=A1 link with A2-shaped evidence');
}

{
  // A1 link whose relation doesn't match its rule.
  const digest = baseValidDigest();
  digest.causal_chains[0].links[0].relation = 'death_chain';
  assert(!validate(digest), 'rejects: rule=A1 link with relation=death_chain (A3 relation)');
}

{
  // Chain missing `anchors` entirely.
  const digest = baseValidDigest();
  delete digest.causal_chains[0].anchors;
  assert(!validate(digest), 'rejects: chain missing required `anchors` field');
}

{
  // Chain with only 1 anchor (a real chain always has >= 2, from having >= 1 link).
  const digest = baseValidDigest();
  digest.causal_chains[0].anchors = [digest.causal_chains[0].anchors[0]];
  assert(!validate(digest), 'rejects: chain with only 1 anchor (minItems 2 on anchors)');
}

{
  // Chain with an empty links array (violates minItems 1).
  const digest = baseValidDigest();
  digest.causal_chains[0].links = [];
  assert(!validate(digest), 'rejects: chain with 0 links (minItems 1 on links)');
}

{
  // Bad chain id pattern.
  const digest = baseValidDigest();
  digest.causal_chains[0].id = 'not-a-chain-id';
  assert(!validate(digest), 'rejects: chain id not matching ^chain_[0-9]+$');
}

{
  // meta.result outside the known enum.
  const digest = baseValidDigest();
  digest.meta.result = 'draw';
  assert(!validate(digest), 'rejects: meta.result outside the known enum');
}

{
  // meta.grade outside the known enum.
  const digest = baseValidDigest();
  digest.meta.grade = 'S+';
  assert(!validate(digest), 'rejects: meta.grade outside the known enum');
}

{
  // slim anchor must not carry `detail`.
  const digest = baseValidDigest();
  digest.causal_chains[0].anchors[0].detail = { leaked: true };
  assert(!validate(digest), 'rejects: slim anchor carrying a leaked `detail` field');
}

{
  // schema_version wrong value.
  const digest = baseValidDigest();
  digest.schema_version = 2;
  assert(!validate(digest), 'rejects: schema_version != 1 (const check)');
}

{
  // key_item_timings element missing a required field.
  const digest = baseValidDigest();
  digest.stats.key_item_timings = [{ ...fullKeyItemTiming }];
  delete digest.stats.key_item_timings[0].power_spike_used;
  assert(!validate(digest), 'rejects: key_item_timings row missing power_spike_used');
}

{
  // deaths_summary with an extra unexpected key.
  const digest = baseValidDigest();
  digest.stats.deaths_summary.extra = 1;
  assert(!validate(digest), 'rejects: deaths_summary with unexpected extra key');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
