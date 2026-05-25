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
| GSI 接收端 | http://localhost:3000/ |

## 内置规则

| 规则 | 触发条件 |
|------|----------|
| 金币不足 | 游戏开始后金币 < 200 |
| 补刀偏低 | 5-15 分钟内补刀 < 分钟数 × 5 |
| 传送卷轴 | 5 分钟后背包无 TP |
| 买活提醒 | 买活可用且金币足够 |
| 插眼提醒 | 背包无任何视野道具 |
| 死亡连击 | 短时间死亡次数激增 |
| Roshan 复活 | Roshan 即将复活 |

## 项目结构

```
dota-ai-coach/
├── server/
│   ├── index.js    # Express 服务器 (端口 3000/3001)
│   ├── db.js       # SQLite 数据层
│   └── rules.js    # 规则引擎
├── client/
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── GameState.jsx  # 对局状态面板
│           ├── Alerts.jsx     # 实时提醒列表
│           └── GoldChart.jsx  # 金币走势图表
└── gamestate_integration_coach.cfg
```
