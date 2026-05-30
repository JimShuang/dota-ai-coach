# Dota 2 AI Coach — Offlane 3号位 MVP

专注 Offlane（3号位）的实时决策提醒、关键装备推断、事件时间线记录和赛后文字复盘。

> 仅使用 Dota 2 GSI + 本地规则系统。不接入 LLM，不读取内存，不自动操作。

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
| API (长期统计) | http://localhost:3001/api/history/stats?recent=10 |
| GSI 接收端 | http://localhost:3000/ |

---

## 支持英雄池

| 英雄 | Archetype |
|------|-----------|
| Tidehunter | teamfight_initiator |
| Centaur Warrunner | teamfight_initiator |
| Razor | lane_bully_tempo |
| Viper | lane_bully_tempo |
| Necrophos | lane_bully_tempo |
| Abaddon | aura_tank_save |
| Vengeful Spirit | utility_save_initiator |

---

## 关键装备路线

| 英雄 | 路线 |
|------|------|
| Centaur / Tidehunter | Vanguard → Blink → Pipe → Crimson Guard |
| Razor | Hood → Blade Mail → BKB → Assault |
| Viper | Hood → Aghanim's → Pipe → Rod of Atos |
| Necrophos | Hood → Kaya & Sange → Eternal Shroud → Aghanim's |
| Abaddon | Mekansm → Guardian Greaves → Pipe → Lotus Orb |
| Vengeful Spirit | Force Staff → Glimmer Cape → Aghanim's → BKB |

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

游戏中自动记录，比赛结束后可查看完整时间线：

| 事件 | 触发逻辑 |
|------|----------|
| `hero_death` | `hero.alive` 由 true → false，含死亡上下文分析 |
| `hero_respawn` | `hero.alive` 由 false → true |
| `item_purchased` | 道具列表出现新道具 |
| `key_item_completed` | 关键路线中的装备首次出现在背包 |
| `key_item_near_completion` | 距下一关键装备 < 600 金 |
| `power_spike_started` | Power Spike 装备完成 |
| `power_spike_unused` | 强势期 3 分钟内无 K/A 产出 |
| `no_tp_warning` | TP 缺失超过 60 秒 |
| `low_farm_window` | 每 3 分钟检查，GPM 下滑且无节奏收益 |
| `game_end` | `map.game_state` 进入 POST_GAME |

每条事件格式：
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

每局比赛结束（`game_state = POST_GAME`）自动持久化到 SQLite：

### 数据库表

| 表 | 内容 |
|----|------|
| `matches` | 每局汇总：英雄、结果、K/D/A、GPM/XPM、评级、改进点、Offlane 专项指标 |
| `match_events` | 完整事件时间线（所有 10 种事件类型），含 snapshot JSON |
| `key_item_timings` | 每件关键装备的完成状态、完成时间、完成前死亡次数、强势期利用情况 |

### Dashboard 标签页

- **实时对局**：现有实时面板（GameState / Alerts / OfflaneSetup / GoldChart / EventTimeline）
- **历史记录**：比赛列表 + 点击查看每局详情（统计、死亡分析、装备时间线、完整事件流）
- **长期趋势**：近 N 局均值（死亡 / GPM / XPM / Offlane 专项）、英雄使用频率、最常见改进点

---

## 单元测试

```bash
cd server
node tests/suggestKeyItem.test.js   # 18 个断言，纯函数测试
node tests/matchHistory.test.js     # 44 个断言，computeKeyItemTimings + DB 读写
```

---

## 项目结构

```
dota-ai-coach/
├── server/
│   ├── index.js                    # Express 服务器 (端口 3000/3001)
│   ├── db.js                       # SQLite 数据层（含历史表 + CRUD）
│   ├── rules.js                    # 规则引擎入口 (协调器)
│   ├── eventLogger.js              # 事件记录模块
│   ├── matchConfig.js              # 对局配置（内存状态）
│   ├── matchHistory.js             # 比赛持久化（persistMatch + 装备时间线计算）
│   ├── suggestKeyItem.js           # 关键装备推断（纯函数）
│   ├── coach.db                    # SQLite 数据库（自动创建）
│   ├── data/
│   │   └── offlaneHeroProfiles.js  # 7 英雄档案 + 装备费用
│   ├── rules/
│   │   ├── commonRules.js          # 通用规则（7条）
│   │   ├── offlaneRules.js         # Offlane 专用规则
│   │   └── archetypeRules.js       # Archetype 专项规则
│   └── tests/
│       ├── suggestKeyItem.test.js  # 纯函数单元测试（18 断言）
│       ├── matchHistory.test.js    # 历史存储单元测试（44 断言）
│       └── mockGSI.json            # 模拟 GSI payload
├── client/src/
│   ├── App.jsx                     # 三标签页导航（实时/历史/趋势）
│   └── components/
│       ├── GameState.jsx           # 对局状态面板
│       ├── Alerts.jsx              # 实时提醒列表
│       ├── GoldChart.jsx           # 金币走势图表
│       ├── OfflaneSetup.jsx        # Offlane 设置 + 关键装备推断
│       ├── EventTimeline.jsx       # 事件时间线 + 赛后复盘
│       ├── MatchHistory.jsx        # 历史比赛列表 + 详情页
│       └── LongTermTrends.jsx      # 长期趋势统计
└── gamestate_integration_coach.cfg
```
