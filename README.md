# Dota 2 AI Coach — Offlane 3号位 MVP

专注 Offlane（3号位）的实时决策提醒、关键装备推断、事件时间线记录、赛后文字复盘，以及历史比赛的导入与管理。

> 仅使用 Dota 2 GSI + 本地规则系统。不接入 LLM，不读取内存，不自动操作。
> **唯一允许的外部 API**：OpenDota 公共 API（`https://api.opendota.com/api/matches/:id`），仅用于「导入比赛」功能。

---

## 快速启动

```bash
# 安装依赖
cd server && npm install
cd ../client && npm install
```

**终端 1 — 后端（nodemon 自动热重启）：**
```bash
cd server
npm run dev
```

**终端 2 — 前端（Vite HMR 自动热更新）：**
```bash
cd client
npm run dev
```

**配置 Dota 2 GSI：**
将 `gamestate_integration_coach.cfg` 复制到：
```
C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\
```
重启 Dota 2，进入任意比赛，Dashboard 即可实时显示数据。

---

## 访问地址

| 服务 | 地址 |
|------|------|
| Dashboard | http://localhost:5173 |
| API (状态) | http://localhost:3001/api/state |
| API (提醒) | http://localhost:3001/api/alerts |
| API (事件) | http://localhost:3001/api/events |
| API (赛后复盘) | http://localhost:3001/api/postgame-summary |
| API (对局配置) | http://localhost:3001/api/match/config |
| API (英雄档案) | http://localhost:3001/api/hero-profiles |
| API (历史帧) | http://localhost:3001/api/states/:matchId?from=600&to=660 |
| API (历史记录列表) | http://localhost:3001/api/history/matches?limit=50 |
| API (历史记录详情) | http://localhost:3001/api/history/matches/:matchId |
| API (关键时刻链) | http://localhost:3001/api/history/matches/:matchId/anchor-chain |
| API (Match Digest) | http://localhost:3001/api/history/matches/:matchId/digest |
| API (AI 复盘 Prompt) | http://localhost:3001/api/history/matches/:matchId/review-prompt |
| API (长期统计) | http://localhost:3001/api/history/stats?recent=10 |
| API (比赛预览/10人) | http://localhost:3001/history/import/preview |
| API (比赛导入确认) | http://localhost:3001/history/import/confirm |
| API (OpenDota 原始缓存) | http://localhost:3001/opendota/raw/:matchId |
| GSI 接收端 | http://localhost:3000/ |

---

## 支持英雄池

| 英雄 | Archetype | 关键装备路线 |
|------|-----------|------|
| Centaur Warrunner | teamfight_initiator | Vanguard → Blink → Pipe → Crimson Guard |
| Tidehunter | teamfight_initiator | Vanguard → Blink → Pipe → Crimson Guard |
| Razor | lane_bully_tempo | Hood → Blade Mail → BKB → Assault |
| Viper | lane_bully_tempo | Hood → Aghanim's → Pipe → Rod of Atos |
| Necrophos | lane_bully_tempo | Hood → Kaya & Sange → Eternal Shroud → Aghanim's |
| Abaddon | aura_tank_save | Mekansm → Guardian Greaves → Pipe → Lotus Orb |
| Vengeful Spirit | utility_save_initiator | Force Staff → Glimmer Cape → Aghanim's → BKB |

---

## 实时规则提醒

### 通用规则
| 规则 | 触发条件 |
|------|----------|
| 金币不足 | 游戏开始后金币 < 200 |
| 补刀偏低 | 5–15 分钟补刀 < 分钟数 × 5 |
| 传送卷轴 | 5 分钟后背包和仓库均无 TP |
| 买活提醒 | 买活可用且金币足够 |
| 插眼提醒 | 背包和仓库均无视野道具 |
| 死亡连击 | 短时间死亡次数激增 |
| Roshan 复活 | Roshan 即将复活 |

### Offlane 专用规则
| 规则 | 触发条件 |
|------|----------|
| 关键装备快好了 | 当前金币距下一关键装备 < 600 |
| 强势期未转化 | 关键装备完成 3 分钟内无 K/A 增长 |
| 低收益窗口 | GPM 下滑 15%+ 且无 K/A 增长 |

### Archetype 专项规则
- **teamfight_initiator**：Blink 完成后提醒开团；强势期 3 分钟无 K/A 提醒
- **lane_bully_tempo**：GPM 停滞提醒；核心装完成后提醒压塔控图
- **aura_tank_save**：光环装完成后提醒围绕核心；无团队装时提醒补功能装
- **utility_save_initiator**：功能装完成后提醒先手/保护核心

所有提醒均有 60 秒 cooldown，避免刷屏。

---

## 事件时间线

游戏中自动记录，比赛结束后可查看完整时间线。GSI 实况和 OpenDota 导入共用同一套事件类型，但来源不同的事件覆盖范围不同（见下表「来源」列）。

| 事件 | 触发逻辑 | 来源 |
|------|----------|------|
| `hero_kill` | 击杀出现在 `kills_log` | 仅 OpenDota 导入 |
| `hero_death` | `hero.alive` 由 true → false，含死亡上下文分析 | GSI 实况；OpenDota 导入（severity 固定为 `danger`） |
| `hero_respawn` | `hero.alive` 由 false → true | 仅 GSI 实况 |
| `item_purchased` | `purchase_log` 中每条记录 | 仅 OpenDota 导入 |
| `key_item_completed` | 关键路线中的装备首次出现 | GSI 实况 + OpenDota 导入 |
| `key_item_near_completion` | 距下一关键装备 < 600 金 | 仅 GSI 实况 |
| `power_spike_started` | Power Spike 装备完成 | GSI 实况 + OpenDota 导入 |
| `power_spike_unused` | 强势期 3 分钟内无 K/A 产出 | 仅 GSI 实况 |
| `no_tp_warning` | TP 缺失超过 60 秒（5 分钟后） | 仅 GSI 实况 |
| `low_farm_window` | 每 3 分钟检查，GPM 下滑且无节奏收益 | 仅 GSI 实况 |
| `game_end` | `map.game_state` 进入 POST_GAME 或比赛结束 | GSI 实况 + OpenDota 导入 |

GSI 实况下的 `hero_death` snapshot 包含完整字段（死亡时金币、装备、关键装备差距等）；OpenDota 导入因数据来源限制，snapshot 字段较少（仅 `{ item, source }` 等），前端做了防御性渲染。

每条 GSI 实况事件格式示例：
```json
{
  "gameTime": 600,
  "type": "hero_death",
  "severity": "critical",
  "message": "英雄阵亡（第 2 次）— 关键装备 Blink Dagger 差 340 金，可能严重拖慢节奏",
  "snapshot": {
    "gold": 1910, "net_worth": 6200, "kills": 1, "deaths": 2,
    "gpm": 410, "level": 9, "items": [...], "keyItems": [...],
    "pre_key_item": true, "gold_gap_to_key_item": 340,
    "in_power_spike": false, "has_tp": false
  }
}
```

---

## 赛后复盘

`GET /api/postgame-summary` 返回 rule-based Offlane 专项复盘：

- **Overall Grade**：优秀 / 良好 / 一般 / 需改进
- **Key Item Analysis**：每件关键装备的完成时间
- **Death Analysis**：总死亡 / 关键装备前死亡 / 差钱 <600 时死亡 / 强势期死亡 / 无 TP 死亡
- **Tempo Analysis**：强势期未转化次数 / 低收益窗口 / GPM 下滑次数
- **One Thing To Improve**：只输出本局最重要的一个改进点

OpenDota 导入的比赛同样会计算 `overall_grade` 与 `one_thing_to_improve`（基于 KDA、GPM 和关键装备完成时间），但 `spike_unused_count` / `low_farm_windows` 恒为 0（无法从基础 API 推断）。

---

## 调试 / 模拟 GSI

```powershell
# 发送 mock payload（Centaur 10 分钟）
$body = Get-Content server\tests\mockGSI.json -Raw
Invoke-WebRequest -Uri "http://localhost:3000/" -Method POST `
  -ContentType "application/json" -Body $body
```

```bash
# curl 版本
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d @server/tests/mockGSI.json
```

查看特定时间点的原始 GSI payload：
```
GET /api/states/{matchId}?from=600&to=660
```

---

## 历史比赛存储

每局比赛结束（`game_state = POST_GAME`）自动持久化到 SQLite；OpenDota 导入的比赛也写入同一套表。

### 数据库表

| 表 | 内容 |
|----|------|
| `matches` | 每局汇总：英雄、结果、K/D/A、GPM/XPM、评级、改进点、Offlane 专项指标、来源（`gsi` / `opendota_import`）、排除/删除状态 |
| `match_events` | 完整事件时间线，含 snapshot JSON |
| `key_item_timings` | 每件关键装备的完成状态、完成时间、完成前死亡次数、强势期利用情况 |
| `raw_opendota_matches` | OpenDota API 原始响应缓存（按 `match_id` 缓存，供预览/导入复用，避免重复请求） |

### Dashboard 标签页

- **实时对局**：现有实时面板（GameState / Alerts / OfflaneSetup / EventTimeline）
- **历史记录**：比赛预览导入（`MatchImportPreview`）+ 比赛列表（`MatchHistory`，含详情、排除/恢复、删除）
- **长期趋势**：近 N 局均值（死亡 / GPM / XPM / Offlane 专项）、英雄使用频率、最常见改进点

---

## 导入比赛（OpenDota）

通过 Match ID 从 OpenDota 公共 API 导入历史比赛，流程分两步：**预览** → **确认**。

### 流程

1. 在「历史记录」标签页顶部的「比赛预览」面板输入 Match ID，点击「预览」。
2. 后端优先读取 `raw_opendota_matches` 缓存；未命中则自动向 OpenDota 请求并缓存。
3. 预览展示该局全部 10 名玩家（天辉 / 夜魇两列），含 K/D/A、GPM/XPM、补刀/反补、英雄名。
4. 找到自己那一行，点击「选择」→ 后端写入 `matches` 行、关键装备时间线（若 `purchase_log` 可用）、完整事件时间线。
5. 导入成功后该比赛立即出现在历史记录列表中，可查看完整时间线。

### 关键限制：`isParsed`

OpenDota 的回放解析是异步的——刚结束的比赛可能短时间内 `purchase_log` 为空（`parsed_status: 'unparsed'`）。此时预览仍可完成（基础 K/D/A 等数据始终可用），但确认导入后事件时间线只会包含一条 `game_end` 事件（遵循"不猜测"原则，不会凭空生成购买/击杀记录）。

**解决办法**：等待几分钟后，使用强制刷新重新拉取（见下一节），OpenDota 完成解析后 `purchase_log` 即可用，重新走一次预览 → 删除旧记录 → 重新确认导入，即可获得完整时间线。

### 强制刷新本地缓存

```bash
curl -X POST http://localhost:3001/opendota/fetch \
  -H "Content-Type: application/json" \
  -d '{"matchId":"8849623934","force":true}'
```

响应中的 `parsed_status` 从 `unparsed` 变为 `ok` 即说明 OpenDota 已完成解析。之后重新走预览/确认流程即可获得完整事件（购买、击杀、死亡）。

### API

| Method | Route | Body | 效果 |
|--------|-------|------|------|
| `POST` | `/opendota/fetch` | `{ matchId, force? }` | 拉取 + 缓存；返回元数据（不含完整 payload） |
| `GET` | `/opendota/raw/:matchId` | — | 返回完整缓存响应 |
| `POST` | `/history/import/preview` | `{ matchId }` | 返回 10 人预览，不写数据库 |
| `POST` | `/history/import/confirm` | `{ matchId, playerSlot }` | 写入 `matches` + 事件 + 关键装备时间线；重复导入返回 409 |

导入比赛的 `match_id` 格式为 `{原始DotaMatchId}_od{playerSlot}`（如 `8849623934_od130`），允许同一场比赛被多个玩家分别导入而不冲突。

---

## 排除 / 删除比赛

两套互不替代的移除机制，按数据是否可恢复区分：

| 机制 | 适用范围 | 效果 |
|------|----------|------|
| **软排除**（`excludeMatch`） | 所有比赛（`gsi` 与 `opendota_import`） | 仅设置 `is_excluded=1`；事件和装备时间线数据永不删除，详情页仍可查看 |
| **硬删除**（`deleteImportedMatch`） | 仅 `opendota_import` | 原子删除 `matches` + `match_events` + `key_item_timings` 三张表的对应行；`raw_opendota_matches` 缓存保留 |

GSI 实况比赛的数据无法重新生成，因此**只能软排除，不能硬删除**。OpenDota 导入比赛的原始数据留在缓存中，硬删除后可以重新导入（例如当时未解析、现在已经解析完成）。

### API

| Method | Route | Body | 效果 |
|--------|-------|------|------|
| `GET` | `/api/history/matches?includeExcluded=true` | — | 返回包含已排除的全部比赛 |
| `POST` | `/api/history/matches/:matchId/exclude` | `{ reason }` | 软排除；`reason` 取值：`bot_test` / `unranked` / `development_test` / `corrupted_data` / `duplicate` / `other` |
| `POST` | `/api/history/matches/:matchId/include` | — | 恢复排除的比赛 |
| `DELETE` | `/api/history/matches/:matchId` | — | 硬删除（仅 `opendota_import`）；GSI 比赛返回 403 `GSI_MATCH_CANNOT_DELETE` |

### UI（`MatchHistory.jsx`）
- 列表/详情页「排除」「恢复」按钮（所有比赛可用）
- 仅 `opendota_import` 比赛显示红色「🗑 删除」按钮（列表行 + 详情页标题区）
- 共享的确认弹窗按 `mode: 'exclude' | 'delete'` 切换文案；删除操作失败时显示底部 toast 提示

---

## 单元测试

```bash
cd server
node tests/suggestKeyItem.test.js              # 18 个断言 — 纯函数测试
node tests/matchHistory.test.js                # 89 个断言 — computeKeyItemTimings、SQLite 读写、排除/恢复、硬删除
node tests/eventLogger.test.js                  # 53 个断言 — 死亡 snapshot、normalizeItems
node tests/matchImporter.test.js                # 39 个断言 — 旧版导入流程纯函数
node tests/openDotaRaw.test.js                  # 47 个断言 — 原始缓存层（mock 网络）
node tests/importPreview.test.js                # 53 个断言 — 10 人预览构建
node tests/importConfirm.test.js                # 104 个断言 — 确认导入全流程（DB + 事件 + 死亡统计）
node tests/openDotaKeyItemAnalyzer.test.js       # 67 个断言 — 关键装备时间线提取
node tests/openDotaEventBuilder.test.js         # 110 个断言 — 事件构建（购买/关键装备/强势期/击杀死亡）
node tests/openDotaKillDeathExtractor.test.js   # 60 个断言 — kills_log 提取击杀/死亡时间线
```

全部 10 个测试文件、**640 个断言**，合并前必须全部通过。

---

## 项目结构

```
dota-ai-coach/
├── server/
│   ├── index.js                       # Express 服务器 (端口 3000 GSI / 3001 API)
│   ├── db.js                          # SQLite 数据层（含历史表 + CRUD + 硬删除）
│   ├── rules.js                       # 规则引擎入口 (协调器，60s cooldown)
│   ├── eventLogger.js                 # 实时事件记录模块（内存状态）
│   ├── matchConfig.js                 # 对局配置（内存状态）
│   ├── matchHistory.js                # 比赛持久化（persistMatch + 装备时间线计算）
│   ├── suggestKeyItem.js              # 关键装备推断（纯函数）
│   ├── matchImporter.js               # 旧版导入流程（OpenDota fetch + 事件重建）
│   ├── openDotaRawService.js          # 原始缓存层：fetch → raw_opendota_matches 表
│   ├── importPreviewService.js        # 纯函数：buildPreview() → 10 人预览结构
│   ├── importConfirmService.js        # confirmImport(matchId, playerSlot) → 写入三张表
│   ├── openDotaKeyItemAnalyzer.js     # 纯函数：analyzeKeyItemTimings()
│   ├── openDotaEventBuilder.js        # 纯函数：buildEventsFromOpenDota() → match_events[]
│   ├── openDotaKillDeathExtractor.js  # 纯函数：extractKillDeath() → 击杀/死亡时间线
│   ├── coach.db                       # SQLite 数据库（自动创建）
│   ├── data/
│   │   ├── offlaneHeroProfiles.js     # 7 英雄档案 + 装备费用
│   │   ├── itemLocalization.js        # 90+ 装备中文名
│   │   └── dotaHeroNames.js           # hero_id → 显示名 / 内部名映射
│   ├── rules/
│   │   ├── commonRules.js             # 通用规则（7条）
│   │   ├── offlaneRules.js            # Offlane 专用规则
│   │   └── archetypeRules.js          # Archetype 专项规则
│   ├── utils/
│   │   ├── gsiNormalizer.js           # normalizeItems() — flat / nested GSI 格式统一
│   │   └── itemProgression.js         # extractItemStateForProgression()（纯函数，预留）
│   └── tests/                         # 10 个测试文件，640 个断言
├── client/src/
│   ├── App.jsx                        # 三标签页导航（实时/历史/趋势）
│   ├── heroItemNames.js               # 客户端中文名映射
│   └── components/
│       ├── GameState.jsx              # 对局状态面板
│       ├── Alerts.jsx                 # 实时提醒列表
│       ├── OfflaneSetup.jsx           # Offlane 设置 + 关键装备推断
│       ├── EventTimeline.jsx          # 实时事件时间线 + 赛后复盘
│       ├── MatchHistory.jsx           # 历史比赛列表 + 详情 + 排除/删除
│       ├── MatchImportPreview.jsx     # 比赛导入预览（10 人卡片）
│       └── LongTermTrends.jsx         # 长期趋势统计
└── gamestate_integration_coach.cfg
```
