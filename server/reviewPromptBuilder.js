'use strict';

// Pure prompt-text builder for AI post-game review -- Route A (see CLAUDE.md
// "AI Review (Route A)"). No I/O, no LLM call of any kind: this module only
// assembles a plain string meant to be copy-pasted by the user into an
// external AI. The real-time GSI pipeline never touches this module and
// stays pure rule-based -- that boundary is a hard line, not a stage on the
// way to something else.
//
// Split into independent section constants so each can be tested/tuned on
// its own without touching buildReviewPrompt()'s assembly logic.

const ROLE_SECTION = `# 角色与任务

你是一名 Dota 2 AI 复盘教练。下面提供的是一场比赛的结构化摘要（"比赛复盘 digest"）——
这份数据由本地规则引擎（GSI 实时监测或 OpenDota 导入 + 因果链推断）产出并核实，
不是你自己观察或猜测出来的信息。你的任务是基于这份数据，写一篇中文的赛后复盘叙事。`;

const FIELD_GUIDE_SECTION = `# 字段说明

- \`meta\`：这场比赛的骨架信息——英雄、胜负结果、KDA、GPM/XPM、总体评级（grade）。
- \`causal_chains\`：规则引擎核实过的因果链数组。每条链里，\`anchors\` 是链上的关键时刻，
  \`links\` 是把这些时刻连起来的因果关系。**\`is_multi_hop: true\` 的链是这场比赛的故事主线**
  ——代表多个事件层层递进（例如：装备节奏落后 -> 强行开团 -> 阵亡 -> 经济崩盘），应优先展开叙述。
  \`is_multi_hop: false\` 的链只是单条孤立的因果关系，重要性次之。
- 锚点（anchor）有四种 \`kind\`：
  - \`death\`：阵亡时刻。
  - \`momentum\`：经济差趋势的拐点（由涨转跌，或由跌转涨）。
  - \`spike\`：单件关键装备的完成时间与敌方对比。
  - \`pace\`：关键装备累计数量的节奏差（我方 vs 敌方最快的一方）。
- \`link.relation\` 有四种含义：
  - \`death_triggered_collapse\`：一次阵亡引发了紧随其后的经济崩盘。
  - \`death_delayed_spike\`：一次代价高昂的阵亡拖慢了关键装备，导致落后敌方强势期。
  - \`death_chain\`：复活后不久又战死，连续送人头。
  - \`deficit_forced_death\`：装备节奏明显落后时强行接战，因而阵亡。
- \`link.confidence\` 分三档，**必须严格遵守对应的语气**：
  - \`strong\`：证据充分，可以用"导致""引发"等断言性措辞。
  - \`medium\`：证据部分支持，只能说"很可能推动了""可能促成了"。
  - \`weak\`：证据薄弱，只能说"可能相关"，**不得**使用因果断言。
- \`standalone_anchors\`：没有连成因果链、但仍值得一提的孤立时刻。
- \`stats\`：死亡分析（\`deaths_summary\`）与关键装备时间线（\`key_item_timings\`）等统计事实，
  可用于佐证叙事中的具体数字。
- \`link.evidence\`：每条因果链接自带的证据字段（如 gap_seconds、economy_delta、deficit_gap 等），
  引用具体数字时应从这里取材，不要自己编造。`;

const OUTPUT_REQUIREMENTS_SECTION = `# 输出要求

请按以下结构输出：

1. **整体节奏**（2-3 句）：这局比赛的大致走向。
2. **关键因果链解读**：对 \`causal_chains\` 中的每条链写一段。**优先展开 \`is_multi_hop: true\` 的链**，
   按各链 \`span\` 的时间顺序讲述；引用锚点时标注 mm:ss 时间。
3. **值得注意的孤立时刻**：从 \`standalone_anchors\` 中挑选至多 3 个来讲，不必全部提及。
4. **最重要的一个改进点**：只给一个，且必须是 digest 中有证据支撑的问题——不要泛泛而谈。

# 防幻觉硬约束（必须严格遵守）

- **只能引用 digest 中实际存在的锚点、链接与统计数字**——不得编造任何 digest 里没有的比赛细节
  （没有发生过的团战、没有购买过的装备、没有记录的地图事件，都不能出现在复盘里）。
- 每一个具体论断都必须能追溯到某个锚点（带 gameTime）或某条 link 的 evidence 字段，
  不能凭空下结论。
- 严格按 confidence 分级使用语气（strong/medium/weak，见上文字段说明），不得升级措辞。
- digest 没有覆盖到的方面（例如对线细节、视野/眼位、具体的团战走位）要明确说"数据未覆盖"，
  不要推测或编造。
- 如果这场比赛的锚点或因果链很少（数据不足），如实说明"这场比赛可分析的关键时刻较少"，
  不要为了凑篇幅硬编故事。`;

/**
 * Assemble a complete, paste-ready AI review prompt from a match digest
 * (buildMatchDigest() output -- see server/matchDigest.js and
 * server/schemas/matchDigest.schema.json).
 *
 * @param {object} digest
 * @returns {string} the full prompt text
 */
function buildReviewPrompt(digest) {
  const digestJson = JSON.stringify(digest, null, 2);
  const digestSection = `# 比赛复盘数据（JSON）\n\n\`\`\`json\n${digestJson}\n\`\`\``;

  return [ROLE_SECTION, FIELD_GUIDE_SECTION, digestSection, OUTPUT_REQUIREMENTS_SECTION].join('\n\n---\n\n');
}

module.exports = {
  buildReviewPrompt,
  ROLE_SECTION,
  FIELD_GUIDE_SECTION,
  OUTPUT_REQUIREMENTS_SECTION,
};
