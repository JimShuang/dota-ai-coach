// Run: node server/tests/suggestKeyItem.test.js

const { suggestKeyItem } = require('../suggestKeyItem');

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

console.log('\n── suggestKeyItem tests ──────────────────────────────────────────');

// ── Centaur progression ───────────────────────────────────────────────────
console.log('\nCentaur:');

const r1 = suggestKeyItem('centaur', [], 0, null);
assert(r1?.suggestedKeyItem === 'item_vanguard', 'empty inventory → suggest Vanguard');
assert(r1?.cost === 1825, 'Vanguard cost is 1825');
assert(r1?.reason === '当前进度下一件关键装备', 'reason string is set');

const r2 = suggestKeyItem('centaur', ['item_vanguard'], 600, null);
assert(r2?.suggestedKeyItem === 'item_blink', 'has Vanguard → suggest Blink');

const r3 = suggestKeyItem('centaur', ['item_vanguard', 'item_blink'], 1200, null);
assert(r3?.suggestedKeyItem === 'item_pipe', 'has Vanguard+Blink → suggest Pipe');

const allCentaur = ['item_vanguard', 'item_blink', 'item_pipe', 'item_crimson_guard'];
const r4 = suggestKeyItem('centaur', allCentaur, 3000, null);
assert(r4?.suggestedKeyItem === null, 'all items owned → null suggestion');
assert(r4?.reason === '关键装备路线已完成', 'reason reflects completion');

// ── Tidehunter (same archetype as Centaur) ────────────────────────────────
console.log('\nTidehunter:');

const r5 = suggestKeyItem('tidehunter', [], 0, null);
assert(r5?.suggestedKeyItem === 'item_vanguard', 'Tidehunter empty → Vanguard');

// ── Necrophos ─────────────────────────────────────────────────────────────
console.log('\nNecrophos:');

const r6 = suggestKeyItem('necrophos', ['item_hood_of_defiance'], 900, null);
assert(r6?.suggestedKeyItem === 'item_kaya_and_sange', 'has Hood → suggest Kaya and Sange');

// ── User override ─────────────────────────────────────────────────────────
console.log('\nUser override:');

const r7 = suggestKeyItem('centaur', [], 0, 'item_pipe');
assert(r7?.suggestedKeyItem === 'item_pipe', 'override respected regardless of progression');
assert(r7?.reason === '用户自定义', 'override sets reason to 用户自定义');
assert(r7?.displayName === '洞察烟斗（Pipe of Insight）', 'display name resolved for override');

// Override takes priority even when all items owned
const r8 = suggestKeyItem('centaur', allCentaur, 3000, 'item_blink');
assert(r8?.suggestedKeyItem === 'item_blink', 'override overrides completion state');

// ── Unknown hero ──────────────────────────────────────────────────────────
console.log('\nUnknown hero:');

const r9 = suggestKeyItem('axe', [], 0, null);
assert(r9 === null, 'unsupported hero returns null');

const r10 = suggestKeyItem('', [], 0, null);
assert(r10 === null, 'empty heroKey returns null');

// ── Display names ─────────────────────────────────────────────────────────
console.log('\nDisplay names:');

const r11 = suggestKeyItem('razor', [], 0, null);
assert(r11?.displayName === '抗魔斗篷（Hood of Defiance）', 'Razor first item has correct display name');

const r12 = suggestKeyItem('vengefulspirit', [], 0, null);
assert(r12?.suggestedKeyItem === 'item_force_staff', 'VS first item is Force Staff');
assert(r12?.displayName === '推推棒（Force Staff）', 'VS Force Staff display name correct');

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
