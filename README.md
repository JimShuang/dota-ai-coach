# Dota 2 AI Coach MVP

实时对局分析 + 规则提醒 + 数据 Dashboard。

## 快速启动

### 第一步：安装依赖

```bash
# 安装服务端依赖
cd server
npm install

# 安装客户端依赖
cd ../client
npm install
```

### 第二步：启动服务

打开两个终端窗口：

**终端 1 — 后端：**
```bash
cd server
node index.js
```

**终端 2 — 前端：**
```bash
cd client
npm run dev
```

### 第三步：配置 Dota 2 GSI

将 `gamestate_integration_coach.cfg` 复制到：
```
C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\
```

如果 `gamestate_integration` 目录不存在，手动创建它。

### 第四步：重启 Dota 2

重启 Dota 2，进入任意比赛，Dashboard 即可实时显示数据。

## 访问地址

| 服务 | 地址 |
|------|------|
| Dashboard | http://localhost:5173 |
| API (状态) | http://localhost:3001/api/state |
| API (提醒) | http://localhost:3001/api/alerts |
| API (事件) | http://localhost:3001/api/events |
| API (赛后总结) | http://localhost:3001/api/summary |
| GSI 接收端 | http://localhost:3000/ |

## 内置规则

| 规则 | 触发条件 |
|------|----------|
| 金币不足 | 游戏开始后金币 < 200 |
| 补刀偏低 | 5-15 分钟内补刀 < 分钟数 × 5 |
| 传送卷轴 | 5 分钟后背包和仓库均无 TP |
| 买活提醒 | 买活可用且金币足够 |
| 插眼提醒 | 背包和仓库均无任何视野道具 |
| 死亡连击 | 短时间死亡次数激增 |
| Roshan 复活 | Roshan 即将复活 |

## 事件时间线

游戏过程中自动记录以下关键事件，在 Dashboard 底部实时展示，比赛结束后生成赛后总结：

| 事件类型 | 触发逻辑 |
|----------|----------|
| 英雄阵亡 | `hero.alive` 由 true 变为 false |
| 英雄复活 | `hero.alive` 由 false 变为 true |
| 购入道具 | 当前帧道具列表出现上一帧没有的新道具 |
| TP 缺失 | 5 分钟后，背包和仓库均无 TP 超过 60 秒 |
| GPM 下滑 | 当前 GPM 比 3 分钟前低 20% 且基准 GPM > 300 |
| 比赛结束 | `map.game_state` 进入 POST_GAME |

每条事件记录：`game_time`、`type`、`severity`、`message`、`snapshot`（含金币、净值、GPM、等级等）。

赛后总结包含胜败结果、综合评级（优秀 / 良好 / 一般 / 需改进）、优势与待改进两栏对比分析。

## 项目结构

```
dota-ai-coach/
├── server/
│   ├── index.js        # Express 服务器 (端口 3000/3001)
│   ├── db.js           # SQLite 数据层
│   ├── rules.js        # 实时规则引擎 (触发提醒)
│   └── eventLogger.js  # 事件记录模块 (时间线 + 赛后总结)
├── client/
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── GameState.jsx      # 对局状态面板
│           ├── Alerts.jsx         # 实时提醒列表
│           ├── GoldChart.jsx      # 金币走势图表
│           └── EventTimeline.jsx  # 事件时间线 + 赛后总结
└── gamestate_integration_coach.cfg
```
