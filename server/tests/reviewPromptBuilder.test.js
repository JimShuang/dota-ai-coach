// Run: node server/tests/reviewPromptBuilder.test.js

'use strict';

const {
  buildReviewPrompt,
  ROLE_SECTION,
  FIELD_GUIDE_SECTION,
  OUTPUT_REQUIREMENTS_SECTION,
} = require('../reviewPromptBuilder');
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

function makeLink(rule, from, to, confidence = 'medium', evidence = { gap_seconds: to - from }) {
  return { from, to, rule, relation: RELATION_BY_RULE[rule], confidence, evidence };
}

function buildSampleDigest() {
  const pace  = makeAnchor('pace', 100, { type: 'pace_deficit', detail: { significant: true, gap: 3 } });
  const death = makeAnchor('death', 300);
  const mom   = makeAnchor('momentum', 400, { type: 'momentum_loss' });
  const standaloneSpike = makeAnchor('spike', 50, { type: 'spike_lead' });

  const linkA4 = makeLink('A4', 100, 300, 'strong');
  const linkA1 = makeLink('A1', 300, 400, 'weak');

  return buildMatchDigest({
    matchMeta: {
      hero: 'centaur', result: '胜利', duration: 2400,
      kills: 5, deaths: 3, assists: 12, gpm: 480, xpm: 520,
      overall_grade: '良好', pre_key_item_deaths: 1,
    },
    anchors: [pace, death, mom, standaloneSpike],
    links: [linkA4, linkA1],
    keyItemTimings: [{ id: 1, match_id: 'm1', item_name: 'item_vanguard', completed: 1, completed_time: 600, deaths_before_completion: 0, power_spike_used: 1, created_at: '2026-01-01' }],
  });
}

// ── 1. Four-section signature content ───────────────────────────────────────

console.log('\n── four-section structure present in the assembled prompt ───────────');

{
  const digest = buildSampleDigest();
  const prompt = buildReviewPrompt(digest);

  assert(typeof prompt === 'string' && prompt.length > 0, 'buildReviewPrompt returns a non-empty string');

  // ① role & task
  assert(prompt.includes('Dota 2 AI 复盘教练'), 'role section: identifies the AI as a Dota 2 review coach');
  assert(prompt.includes('结构化'), 'role section: describes the input as structured data');
  assert(prompt.includes('中文'), 'role section: mandates a Chinese narrative');

  // ② field guide keywords
  assert(prompt.includes('causal_chains'), 'field guide: mentions causal_chains');
  assert(prompt.includes('standalone_anchors'), 'field guide: mentions standalone_anchors');
  assert(prompt.includes('is_multi_hop'), 'field guide: mentions is_multi_hop');
  assert(prompt.includes('death_triggered_collapse') && prompt.includes('death_delayed_spike')
    && prompt.includes('death_chain') && prompt.includes('deficit_forced_death'),
    'field guide: explains all four relation types');
  assert(prompt.includes('导致') && prompt.includes('很可能推动了') && prompt.includes('可能相关'),
    'field guide: confidence tone ladder present (strong/medium/weak wording)');
  assert(prompt.includes('link.evidence'), 'field guide: explains link.evidence');

  // ③ JSON body
  assert(/```json\n[\s\S]+?\n```/.test(prompt), 'digest JSON is embedded in a fenced code block');

  // ④ output requirements + anti-hallucination
  assert(prompt.includes('只能引用 digest 中实际存在的锚点'), 'anti-hallucination: "only cite what exists in digest" rule present');
  assert(prompt.includes('不得编造'), 'anti-hallucination: "must not fabricate" rule present');
  assert(prompt.includes('数据未覆盖'), 'anti-hallucination: "data not covered" disclosure rule present');
  assert(prompt.includes('如实说明'), 'anti-hallucination: "report honestly when data is sparse" rule present');
  assert(prompt.includes('优先展开'), 'output requirements: multi-hop chains should be prioritized');
  assert(prompt.includes('最重要的一个改进点'), 'output requirements: exactly one improvement point required');
}

// ── 2. Embedded JSON round-trips to the exact input digest ─────────────────

console.log('\n── embedded JSON round-trips to the input digest ────────────────────');

{
  const digest = buildSampleDigest();
  const prompt = buildReviewPrompt(digest);

  const match = prompt.match(/```json\n([\s\S]+?)\n```/);
  assert(match !== null, 'JSON code block is extractable via regex');

  const parsed = JSON.parse(match[1]);
  assert(JSON.stringify(parsed) === JSON.stringify(digest), 'parsed JSON is deep-equal to the original digest');
}

// ── 3. Section constants export the hard constraints (regression pin) ──────

console.log('\n── exported section constants carry the safety-critical wording ─────');

{
  assert(FIELD_GUIDE_SECTION.includes('strong') && FIELD_GUIDE_SECTION.includes('medium') && FIELD_GUIDE_SECTION.includes('weak'),
    'FIELD_GUIDE_SECTION names all three confidence tiers');
  assert(OUTPUT_REQUIREMENTS_SECTION.includes('防幻觉'), 'OUTPUT_REQUIREMENTS_SECTION carries the anti-hallucination heading');
  assert(OUTPUT_REQUIREMENTS_SECTION.includes('不得编造'), 'OUTPUT_REQUIREMENTS_SECTION carries the fabrication ban verbatim');
  assert(ROLE_SECTION.includes('Dota 2'), 'ROLE_SECTION identifies the Dota 2 context');
}

// ── 4. Empty causal_chains digest still produces a valid prompt ────────────

console.log('\n── empty causal_chains digest produces a normal prompt ───────────────');

{
  const digest = buildMatchDigest({ matchMeta: {}, anchors: [], links: [], keyItemTimings: [] });
  assert(digest.causal_chains.length === 0, 'sanity: fixture digest genuinely has no causal chains');

  let prompt;
  let threw = false;
  try {
    prompt = buildReviewPrompt(digest);
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'buildReviewPrompt does not throw on a digest with no causal chains');
  assert(typeof prompt === 'string' && prompt.length > 0, 'still produces a non-empty prompt');
  assert(prompt.includes('causal_chains'), 'field guide section still present even with no chains');

  const match = prompt.match(/```json\n([\s\S]+?)\n```/);
  const parsed = JSON.parse(match[1]);
  assert(JSON.stringify(parsed) === JSON.stringify(digest), 'embedded JSON still round-trips for the empty digest');
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
