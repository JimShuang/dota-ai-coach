import React, { useState, useEffect } from 'react';
import { heroDisplayName, itemDisplayName } from '../heroItemNames';

const card = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '12px',
  padding: '20px',
};

const sectionTitle = {
  fontSize: '13px',
  fontWeight: '600',
  color: '#8b949e',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  marginBottom: '16px',
};

const GRADE_COLORS = {
  '优秀': '#56d364', '良好': '#79c0ff', '一般': '#e3b341', '需改进': '#f85149',
};

const RESULT_CONFIG = {
  '胜利': { color: '#56d364', bg: '#0d2b0d' },
  '失败': { color: '#f85149', bg: '#3d1a1a' },
};

function formatTime(seconds) {
  if (!seconds) return '';
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(unixSeconds) {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── Causal link metadata ───────────────────────────────────────────────────

// Extend here when new rules (A4…) are added.
// fromBadge/toBadge/cardTitle use formatTime which is defined above this constant.
const RELATION_META = {
  death_triggered_collapse: {
    fromKind:  'death',
    toKind:    'momentum',
    fromBadge: '⚡ 引发经济崩盘',
    toBadge:   (l) => `← 源于 ${formatTime(l.from)} 的死亡`,
    cardTitle: (l) => `${formatTime(l.from)} 阵亡 → ${formatTime(l.to)} 经济崩盘`,
  },
  death_delayed_spike: {
    fromKind:  'death',
    toKind:    'spike',
    fromBadge: '⚡ 耽误关键装',
    toBadge:   (l) => `← 源于 ${formatTime(l.from)} 的死亡`,
    cardTitle: (l) => `${formatTime(l.from)} 阵亡 → ${formatTime(l.to)} ${itemDisplayName('item_' + l.evidence.my_item)} 落后`,
  },
  // Both ends are kind='death'. This is safe with the existing kind-filtered
  // badge logic below because fromLinks/toLinks are keyed by gameTime (link.from
  // vs link.to), not by anchor identity — and gate 3 in ruleA3 guarantees
  // gap > 0, so the two death anchors always have distinct gameTimes.
  death_chain: {
    fromKind:  'death',
    toKind:    'death',
    fromBadge: '⚡ 引发连续送死',
    toBadge:   (l) => `← 复活后又死（间隔 ${l.evidence.gap_seconds}s）`,
    cardTitle: (l) => `${formatTime(l.from)} 阵亡 → ${formatTime(l.to)} 再次阵亡（间隔 ${l.evidence.gap_seconds}s）`,
  },
  // fromKind='pace', toKind='death' — the first relation where the "from" end
  // isn't a death anchor. Safe with the existing kind-filtered fromLinks/toLinks
  // logic since those filters already key off meta.fromKind/meta.toKind per anchor.
  deficit_forced_death: {
    fromKind:  'pace',
    toKind:    'death',
    fromBadge: '⚡ 落后期强行接战',
    toBadge:   (l) => `← 装备落后 ${l.evidence.deficit_gap} 件时阵亡`,
    cardTitle: (l) => `${formatTime(l.from)} 落后 ${l.evidence.deficit_gap} 件 → ${formatTime(l.to)} 阵亡${l.evidence.no_trade ? '（未换到人头）' : ''}`,
  },
};

const CONFIDENCE_STYLE = {
  strong: { color: '#f85149', bg: '#3d1a1a', border: '#f8514966', label: '高置信' },
  medium: { color: '#e3b341', bg: '#2b2200',  border: '#e3b34166', label: '中等'   },
  weak:   { color: '#8b949e', bg: 'transparent', border: '#8b949e55', label: '弱关联' },
};

function CausalBadge({ text, confidence, isActive, onClick }) {
  const cs = CONFIDENCE_STYLE[confidence] || CONFIDENCE_STYLE.weak;
  return (
    <span
      onClick={onClick}
      style={{
        padding: '1px 7px', borderRadius: '10px', fontSize: '10px',
        fontWeight: isActive ? '700' : '600',
        background: cs.bg,
        color: cs.color,
        border: `1px solid ${isActive ? cs.color : cs.border}`,
        outline: isActive ? `2px solid ${cs.color}33` : 'none',
        cursor: 'pointer', flexShrink: 0,
      }}
    >
      {text}
    </span>
  );
}

function Badge({ text, color, bg }) {
  return (
    <span style={{
      padding: '2px 9px', borderRadius: '10px', fontSize: '11px', fontWeight: '600',
      background: bg || (color + '22'), color, border: `1px solid ${color}44`,
    }}>{text}</span>
  );
}

function StatCell({ label, value, color }) {
  return (
    <div style={{ background: '#0d1117', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
      <div style={{ fontSize: '15px', fontWeight: '700', color: color || '#e6edf3' }}>{value ?? '—'}</div>
      <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

// ── Event timeline helpers ─────────────────────────────────────────────────

// Group consecutive consumable item_purchased events into collapsible clusters.
// Non-consumable and non-item_purchased events are passed through as-is.
// Returns a mixed array of event objects and group objects { isGroup, events, key }.
function groupEventsForDisplay(evts) {
  const result = [];
  let group = null;
  for (const e of evts) {
    if (e.type === 'item_purchased' && e.snapshot?.isConsumable) {
      if (!group) {
        group = { isGroup: true, events: [], key: `cg_${result.length}` };
        result.push(group);
      }
      group.events.push(e);
    } else {
      group = null;
      result.push(e);
    }
  }
  return result;
}

// ── Match detail view ──────────────────────────────────────────────────────

// ── Economy chart ──────────────────────────────────────────────────────────

function EconomyChart({ timeseries, events }) {
  if (!timeseries?.available || !timeseries.gold?.length) {
    return (
      <div style={{
        background: '#0d1117', borderRadius: '8px', padding: '14px', marginBottom: '20px',
        textAlign: 'center', fontSize: '12px', color: '#8b949e',
      }}>
        该比赛无解析经济差数据
      </div>
    );
  }

  const data    = timeseries.gold;
  const maxMin  = data[data.length - 1].minute;
  const advVals = data.map((d) => d.adv);
  const peak    = Math.max(Math.max(...advVals), Math.abs(Math.min(...advVals)), 1000);

  const W = 560, H = 110, PL = 38, PR = 8, PT = 12, PB = 22;
  const cW = W - PL - PR;
  const cH = H - PT - PB;

  const xOf = (min) => PL + (maxMin > 0 ? (min / maxMin) * cW : 0);
  const yOf = (adv) => PT + cH / 2 - (adv / peak) * (cH / 2);
  const zerY = yOf(0);

  // Filled area: split path above / below zero line
  const pts = data.map((d) => [xOf(d.minute), yOf(d.adv)]);
  const polyPts = pts.map(([x, y]) => `${x},${y}`).join(' ');

  const deathMins = (events || [])
    .filter((e) => e.type === 'hero_death')
    .map((e) => Math.floor(e.game_time / 60))
    .filter((m) => m <= maxMin);

  const tickMins = [];
  const step = maxMin > 40 ? 10 : 5;
  for (let m = 0; m <= maxMin; m += step) tickMins.push(m);

  return (
    <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px', marginBottom: '20px' }}>
      <div style={{ fontSize: '12px', color: '#8b949e', fontWeight: '600', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        我方经济差走势
        <span style={{ fontSize: '10px', color: '#8b949e55', fontWeight: '400' }}>分钟粒度 · 红线=死亡时间</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {/* Zero line */}
        <line x1={PL} y1={zerY} x2={W - PR} y2={zerY} stroke="#30363d" strokeWidth="1" />
        {/* Thin horizontal grid at ±peak/2 */}
        <line x1={PL} y1={yOf(peak / 2)}  x2={W - PR} y2={yOf(peak / 2)}  stroke="#30363d33" strokeWidth="1" strokeDasharray="4,4" />
        <line x1={PL} y1={yOf(-peak / 2)} x2={W - PR} y2={yOf(-peak / 2)} stroke="#30363d33" strokeWidth="1" strokeDasharray="4,4" />
        {/* Death markers (behind the line) */}
        {deathMins.map((m, i) => (
          <line key={i} x1={xOf(m)} y1={PT} x2={xOf(m)} y2={H - PB} stroke="#f85149" strokeWidth="1" strokeDasharray="3,2" opacity="0.55" />
        ))}
        {/* Economy polyline */}
        <polyline points={polyPts} fill="none" stroke="#e3b341" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Y axis labels */}
        <text x={PL - 4} y={yOf(peak)}  fill="#56d364" fontSize="9" textAnchor="end" dominantBaseline="middle">+{(peak / 1000).toFixed(0)}k</text>
        <text x={PL - 4} y={zerY}       fill="#8b949e" fontSize="9" textAnchor="end" dominantBaseline="middle">0</text>
        <text x={PL - 4} y={yOf(-peak)} fill="#f85149" fontSize="9" textAnchor="end" dominantBaseline="middle">-{(peak / 1000).toFixed(0)}k</text>
        {/* X axis ticks */}
        {tickMins.map((m) => (
          <g key={m}>
            <line x1={xOf(m)} y1={H - PB} x2={xOf(m)} y2={H - PB + 3} stroke="#30363d" strokeWidth="1" />
            <text x={xOf(m)} y={H - PB + 11} fill="#8b949e" fontSize="9" textAnchor="middle">{m}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Match detail view ──────────────────────────────────────────────────────

function MatchDetail({ matchId, onBack, onDelete }) {
  const [detail, setDetail]               = useState(null);
  const [loading, setLoading]             = useState(true);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [deathDigest, setDeathDigest]     = useState(null);
  const [economyTs, setEconomyTs]         = useState(null);
  const [anchorChain, setAnchorChain]         = useState([]);
  const [anchorLinks, setAnchorLinks]         = useState([]);
  const [expandedAnchors, setExpandedAnchors] = useState(new Set());
  const [activeLink, setActiveLink]           = useState(null);
  const [expandedCards, setExpandedCards]     = useState(new Set());

  useEffect(() => {
    fetch(`/api/history/matches/${matchId}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));

    // Load death context + economy timeseries in parallel; failures are silently ignored
    fetch(`/api/history/matches/${matchId}/death-digest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.deaths) setDeathDigest(data.deaths); })
      .catch(() => {});

    fetch(`/api/history/matches/${matchId}/economy-timeseries`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.available) setEconomyTs(data); })
      .catch(() => {});

    fetch(`/api/history/matches/${matchId}/anchor-chain`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.anchors?.length) setAnchorChain(data.anchors);
        if (data?.links?.length)   setAnchorLinks(data.links);
      })
      .catch(() => {});
  }, [matchId]);

  if (loading) return <div style={{ color: '#8b949e', padding: '40px', textAlign: 'center' }}>加载中...</div>;
  if (!detail) return <div style={{ color: '#f85149', padding: '40px', textAlign: 'center' }}>加载失败</div>;

  const { match: m, events, keyItemTimings } = detail;

  // Keyed by event id — populated once death-digest fetch succeeds; empty until then
  const digestById = {};
  if (deathDigest) {
    for (const d of deathDigest) {
      if (d.id != null && d.context) digestById[d.id] = d.context;
    }
  }

  // Build O(1) lookup: gameTime → links where this anchor is from/to endpoint.
  // Used by anchor row render to find badges and highlight state.
  const linksByFrom = {};
  const linksByTo   = {};
  for (const link of anchorLinks) {
    (linksByFrom[link.from] ||= []).push(link);
    (linksByTo[link.to]     ||= []).push(link);
  }
  function linkKey(link) { return `${link.rule}-${link.from}-${link.to}`; }

  // For OpenDota imports: how many deaths couldn't be located in any kills_log
  // (tower/creep/Roshan kills have no timestamp entry). Uses match row as source of truth
  // for total deaths; event count gives reconstructed lower bound.
  const isImport = m.source === 'opendota_import';
  const reconstructedDeaths = isImport
    ? events.filter((e) => e.type === 'hero_death' && e.snapshot?.source === 'opendota_import').length
    : 0;
  const missingDeaths = isImport ? Math.max(0, (m.deaths || 0) - reconstructedDeaths) : 0;

  // Shared renderer for a causal link's evidence fields — driven by field
  // presence, not by which rule produced the link, so new rules (A4…)
  // render automatically without touching this function.
  // Called from the anchor-row inline panel and the 逻辑链 card expansion.
  function renderLinkEvidence(evidence) {
    const rows = [];
    if (evidence.gap_seconds != null) {
      rows.push(<div key="gap">间隔 <span style={{ color: '#e6edf3' }}>{evidence.gap_seconds}</span> 秒</div>);
    }
    if (evidence.chain_deaths > 0) {
      rows.push(<div key="chain">连续死亡 <span style={{ color: '#f85149' }}>{evidence.chain_deaths}</span> 次</div>);
    }
    if (evidence.economy_significant) {
      rows.push(<div key="econsig" style={{ color: '#e3b341' }}>死亡时经济已显著恶化</div>);
    }
    if (evidence.economy_delta != null) {
      rows.push(<div key="econdelta">经济变化 <span style={{ color: evidence.economy_delta < 0 ? '#f85149' : '#56d364' }}>{evidence.economy_delta > 0 ? '+' : ''}{Math.round(evidence.economy_delta)}</span> 金币</div>);
    }
    if (evidence.magnitude != null) {
      rows.push(<div key="magnitude">崩盘幅度 <span style={{ color: '#e3b341' }}>{Math.round(evidence.magnitude)}</span> 金币/分钟</div>);
    }
    if (evidence.had_buyback) {
      rows.push(<div key="buyback" style={{ color: '#e3b341' }}>死亡时可支付回城（buyback 可用）</div>);
    }
    if (evidence.my_item != null) {
      rows.push(
        <div key="myitem">
          延后装备 <span style={{ color: '#79c0ff' }}>{itemDisplayName(`item_${evidence.my_item}`)}</span>
          {evidence.my_item_time != null && <> @ <span style={{ color: '#e6edf3' }}>{formatTime(evidence.my_item_time)}</span></>}
        </div>
      );
    }
    if (evidence.enemy_item != null) {
      rows.push(
        <div key="enemyitem">
          敌方对应装备 <span style={{ color: '#f0883e' }}>{itemDisplayName(`item_${evidence.enemy_item}`)}</span>
          {evidence.enemy_item_time != null && <> @ <span style={{ color: '#e6edf3' }}>{formatTime(evidence.enemy_item_time)}</span></>}
        </div>
      );
    }
    if (evidence.first_death_lethal) {
      rows.push(<div key="firstlethal" style={{ color: '#e3b341' }}>第一次死亡已造成明显损失</div>);
    }
    if (evidence.first_death_number != null || evidence.second_death_number != null) {
      rows.push(
        <div key="deathnumbers">
          第 <span style={{ color: '#f85149' }}>{evidence.first_death_number ?? '?'}</span> 次
          {' → 第 '}
          <span style={{ color: '#f85149' }}>{evidence.second_death_number ?? '?'}</span> 次死亡
        </div>
      );
    }
    if (evidence.deficit_gap != null) {
      rows.push(<div key="deficitgap">落后 <span style={{ color: '#f85149' }}>{evidence.deficit_gap}</span> 件关键装</div>);
    }
    if (evidence.enemy_hero != null) {
      rows.push(<div key="enemyhero">敌方 <span style={{ color: '#f0883e' }}>{evidence.enemy_hero}</span></div>);
    }
    if (evidence.no_trade) {
      rows.push(<div key="notrade" style={{ color: '#f85149' }}>未换到人头（纯送）</div>);
    }
    return rows;
  }

  // Shared renderer for the death battlefield context block.
  // Called from renderEventRow (event timeline) and anchor chain detail expansion.
  function renderDeathContext(ctx) {
    if (!ctx) return null;
    if (!(ctx.chainDeaths?.length > 0 || ctx.killsNearby?.length > 0 || ctx.objectivesLost?.length > 0 || ctx.objectivesGained?.length > 0 || ctx.diedWithBuyback != null || (ctx.economy?.available && ctx.economy.delta != null))) return null;
    return (
      <div style={{
        marginLeft: '46px', marginTop: '4px', padding: '6px 8px',
        background: '#0d1117',
        border: `1px solid ${ctx.majorObjectiveLost ? '#f8514933' : '#30363d44'}`,
        borderRadius: '6px', fontSize: '11px',
        display: 'flex', flexDirection: 'column', gap: '3px',
      }}>
        <div style={{ fontSize: '10px', color: '#8b949e55', marginBottom: '1px' }}>战场上下文</div>
        {ctx.diedWithBuyback != null && (
          <div style={{ color: ctx.diedWithBuyback ? '#e3b341' : '#8b949e' }}>
            {ctx.diedWithBuyback ? '⚠ 死亡时有买活金币' : '死亡时无买活金币'}
          </div>
        )}
        {ctx.chainDeaths?.length > 0 && (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#f85149' }}>连续死亡 ×{ctx.chainDeaths.length}</span>
            {ctx.chainDeaths.map((d) => (
              <span key={d.game_time} style={{ color: '#8b949e88', fontSize: '10px' }}>{formatTime(d.game_time)}</span>
            ))}
          </div>
        )}
        {ctx.killsNearby?.length > 0 && (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#56d364' }}>前后击杀 ×{ctx.killsNearby.length}</span>
            {ctx.killsNearby.map((k) => (
              <span key={k.game_time} style={{ color: '#8b949e88', fontSize: '10px' }}>{formatTime(k.game_time)}</span>
            ))}
          </div>
        )}
        {ctx.objectivesLost?.length > 0 && (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#f85149' }}>期间我方失去：</span>
            {ctx.objectivesLost.map((o) => (
              <span key={o.game_time} style={{ color: '#f8514988', fontSize: '10px' }}>
                {o.snapshot?.objectiveType === 'tower' ? '🏰' : o.snapshot?.objectiveType === 'barracks' ? '⚔️' : '💀'} {formatTime(o.game_time)}
              </span>
            ))}
          </div>
        )}
        {ctx.objectivesGained?.length > 0 && (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#56d364' }}>期间摧毁敌方：</span>
            {ctx.objectivesGained.map((o) => (
              <span key={o.game_time} style={{ color: '#56d36488', fontSize: '10px' }}>
                {o.snapshot?.objectiveType === 'tower' ? '🏰' : o.snapshot?.objectiveType === 'barracks' ? '⚔️' : '💀'} {formatTime(o.game_time)}
              </span>
            ))}
          </div>
        )}
        {ctx.economy?.available && ctx.economy.delta != null && (
          <div style={{
            color:      ctx.economy.delta < 0 ? '#f85149' : '#56d364',
            fontWeight: ctx.economy.significant ? '700' : '400',
          }}>
            {ctx.economy.delta < 0 ? '死亡后1分钟经济差恶化 ' : '死亡后1分钟经济差改善 '}
            {Math.abs(ctx.economy.delta).toLocaleString()}g
            {ctx.economy.significant && (
              <span style={{ fontSize: '10px', color: '#8b949e', fontWeight: '400', marginLeft: '4px' }}>≈ 分钟级</span>
            )}
          </div>
        )}
      </div>
    );
  }

  // Render a single event row — shared by grouped and ungrouped paths.
  // Snapshot fields are optional: only hero_death has full snapshots; OpenDota
  // events carry a minimal { item, source, isConsumable } shape. Missing fields
  // are silently skipped rather than rendered as undefined.
  function renderEventRow(e) {
    const severityColor = {
      critical: '#f85149', danger: '#f85149',
      warning: '#e3b341', success: '#56d364', info: '#79c0ff',
    }[e.severity] || '#8b949e';

    // hero_kill gets a sword glyph; hero_death a skull; objective uses emoji keyed on objectiveType
    const typeLabel = e.type === 'hero_kill'  ? '⚔ kill'
                    : e.type === 'hero_death' ? '☠ death'
                    : e.type === 'objective'  ?
                        ({ tower: '🏰 tower', barracks: '⚔️ barracks', roshan: '💀 roshan' }[e.snapshot?.objectiveType] || 'objective')
                    : e.type.replace(/_/g, ' ');

    const snap = e.type === 'hero_death' ? (e.snapshot || null) : null;
    const objSnap = e.type === 'objective' ? (e.snapshot || null) : null;
    const ctx = e.type === 'hero_death' ? (digestById[e.id] || null) : null;
    // OpenDota import deaths carry only {killer, deathNumber, source} — no gold/items
    const isImportedDeath = snap?.source === 'opendota_import';

    let deathItems = [];
    if (snap && !isImportedDeath) {
      if (Array.isArray(snap.itemsAtDeath) && snap.itemsAtDeath.length > 0) {
        deathItems = snap.itemsAtDeath.filter((n) => n !== 'item_tpscroll');
      } else if (snap.inventoryAtDeath) {
        deathItems = Object.values(snap.inventoryAtDeath).filter((n) => n && n !== 'item_tpscroll');
      }
    }
    return (
      <div key={e.id} style={{ padding: '5px 0', borderBottom: '1px solid #30363d22' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '11px', color: '#8b949e', flexShrink: 0, width: '36px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(e.game_time)}
          </span>
          <span style={{
            fontSize: '10px', fontWeight: '600', color: severityColor,
            background: severityColor + '22', padding: '1px 6px', borderRadius: '4px',
            flexShrink: 0, alignSelf: 'center',
          }}>
            {typeLabel}
          </span>
          <span style={{ fontSize: '12px', color: '#c9d1d9', lineHeight: '1.4' }}>{e.message}</span>
        </div>
        {/* GSI-rich death detail — suppressed for imported deaths which have no gold/item data */}
        {snap && !isImportedDeath && (
          <div style={{ marginLeft: '46px', marginTop: '3px', fontSize: '11px', color: '#8b949e66', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {snap.goldBeforeDeathPenalty != null && (
              <span>死前金币 <span style={{ color: '#e3b341' }}>{snap.goldBeforeDeathPenalty}g</span></span>
            )}
            {deathItems.length > 0 && (
              <span>道具：<span style={{ color: '#8b949e' }}>{deathItems.map(itemDisplayName).join('、')}</span></span>
            )}
            {snap.hadTpAtDeath === false && <span style={{ color: '#e3b341' }}>无TP</span>}
            {snap.wasNearKeyItem && <span style={{ color: '#f85149' }}>差钱 &lt;600</span>}
          </div>
        )}
        {/* Objective detail — each field individually guarded; missing fields silently skipped */}
        {objSnap && (
          <div style={{ marginLeft: '46px', marginTop: '3px', fontSize: '11px', color: '#8b949e66', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {objSnap.team && (
              <span>阵营 <span style={{ color: '#c9d1d9' }}>{objSnap.team === 'radiant' ? '天辉' : '夜魇'}</span></span>
            )}
            {objSnap.lane && (
              <span>路线 <span style={{ color: '#c9d1d9' }}>{{ top: '上路', mid: '中路', bot: '下路' }[objSnap.lane] || objSnap.lane}</span></span>
            )}
            {objSnap.objectiveType === 'tower' && objSnap.tier != null && (
              <span>等级 <span style={{ color: '#c9d1d9' }}>T{objSnap.tier}</span></span>
            )}
            {objSnap.objectiveType === 'barracks' && objSnap.barrackType && (
              <span>类型 <span style={{ color: '#c9d1d9' }}>{objSnap.barrackType === 'melee' ? '近战' : '远程'}</span></span>
            )}
            {objSnap.executedBy && (
              <span>击杀者 <span style={{ color: '#c9d1d9' }}>{objSnap.executedBy}</span></span>
            )}
          </div>
        )}
        {/* Battle context — from /death-digest; silently absent until fetch completes or if fetch fails */}
        {renderDeathContext(ctx)}
      </div>
    );
  }
  const resultCfg = RESULT_CONFIG[m.result] || { color: '#8b949e', bg: '#161b22' };
  const gradeColor = GRADE_COLORS[m.overall_grade] || '#8b949e';

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: '1px solid #30363d', color: '#8b949e',
          borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px',
        }}>← 返回列表</button>
        <span style={{ fontSize: '16px', fontWeight: '700', color: '#f0883e' }}>
          {heroDisplayName(m.hero)}
        </span>
        <Badge text={m.result || '未知'} color={resultCfg.color} bg={resultCfg.bg} />
        {m.overall_grade && <Badge text={m.overall_grade} color={gradeColor} />}
        {m.source === 'opendota_import'
          ? <Badge text="OpenDota 导入" color="#79c0ff" bg="#0d2137" />
          : <Badge text="Live GSI" color="#8b949e" bg="#21262d" />}
        {m.source === 'opendota_import' && (
          <button
            onClick={() => onDelete(m.match_id, `${heroDisplayName(m.hero)} · ${formatDate(m.end_time)}`)}
            style={{ background: '#3d1a1a', border: '1px solid #f85149', borderRadius: '6px', padding: '3px 10px', color: '#f85149', fontSize: '11px', cursor: 'pointer' }}
          >
            🗑 删除
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#8b949e' }}>
          {formatDate(m.end_time)}
          {m.duration ? ` · ${Math.round(m.duration / 60)} 分钟` : ''}
        </span>
      </div>

      {/* Final stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '20px' }}>
        <StatCell label="K/D/A" value={`${m.kills}/${m.deaths}/${m.assists}`} color="#e6edf3" />
        <StatCell label="GPM" value={Math.round(m.gpm)} color="#e3b341" />
        <StatCell label="XPM" value={Math.round(m.xpm)} color="#bc8cff" />
        <StatCell label="补刀" value={m.last_hits} color="#79c0ff" />
        <StatCell label="最终金币" value={(m.final_gold || 0).toLocaleString()} color="#56d364" />
      </div>

      {/* Analysis grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', color: '#f85149', fontWeight: '600', marginBottom: '10px' }}>死亡分析</div>
          {[
            { label: '总死亡',        value: m.deaths,             warn: m.deaths > 5 },
            { label: '关键装备前死亡', value: m.pre_key_item_deaths, warn: m.pre_key_item_deaths > 1 },
          ].map(({ label, value, warn }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: '12px', color: '#8b949e' }}>{label}</span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: warn ? '#f85149' : '#e6edf3' }}>{value ?? 0}</span>
            </div>
          ))}
        </div>
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', color: '#bc8cff', fontWeight: '600', marginBottom: '10px' }}>节奏分析</div>
          {[
            { label: '强势期未转化', value: m.spike_unused_count, warn: m.spike_unused_count > 0 },
            { label: '低收益窗口',   value: m.low_farm_windows,   warn: m.low_farm_windows > 1 },
          ].map(({ label, value, warn }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: '12px', color: '#8b949e' }}>{label}</span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: warn ? '#e3b341' : '#e6edf3' }}>{value ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Key item timings — or unavailable note for unparsed OpenDota imports */}
      {m.source === 'opendota_import' && keyItemTimings.length === 0 ? (
        <div style={{
          background: '#0d1117', borderRadius: '8px', padding: '14px', marginBottom: '20px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ color: '#e3b341' }}>⚠</span>
          <span style={{ fontSize: '12px', color: '#8b949e' }}>
            关键装备数据不可用 — 该比赛未解析（缺少购买记录）
          </span>
        </div>
      ) : keyItemTimings.length > 0 ? (
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px', marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', color: '#e3b341', fontWeight: '600', marginBottom: '10px' }}>关键装备时间线</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['装备', '完成', '完成时间', '完成前死亡', '强势期利用'].map((h) => (
                  <th key={h} style={{ fontSize: '11px', color: '#8b949e', textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #30363d' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keyItemTimings.map((t) => (
                <tr key={t.item_name}>
                  <td style={{ padding: '6px 8px', fontSize: '12px', color: '#e6edf3' }}>
                    {itemDisplayName(t.item_name)}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <Badge text={t.completed ? '✓' : '✗'} color={t.completed ? '#56d364' : '#f85149'} />
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: '12px', color: '#79c0ff' }}>
                    {t.completed_time ? formatTime(t.completed_time) : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: '12px', color: t.deaths_before_completion > 0 ? '#f85149' : '#56d364' }}>
                    {t.deaths_before_completion}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {t.completed
                      ? t.power_spike_used === null
                        ? <span style={{ fontSize: '11px', color: '#8b949e' }}>N/A</span>
                        : <Badge text={t.power_spike_used ? '已转化' : '未转化'} color={t.power_spike_used ? '#56d364' : '#e3b341'} />
                      : <span style={{ color: '#8b949e', fontSize: '11px' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Economy timeseries chart */}
      <EconomyChart timeseries={economyTs} events={events} />

      {/* One thing to improve */}
      {m.one_thing_to_improve && (
        <div style={{
          background: '#1e1535', border: '1px solid #bc8cff44',
          borderRadius: '8px', padding: '14px', marginBottom: '20px',
        }}>
          <div style={{ fontSize: '11px', color: '#bc8cff', fontWeight: '600', marginBottom: '6px' }}>
            本局最重要改进点
          </div>
          <div style={{ fontSize: '13px', color: '#e6edf3', lineHeight: '1.6' }}>
            {m.one_thing_to_improve}
          </div>
        </div>
      )}

      {/* Anchor chain — 关键时刻 (empty → whole block hidden; GSI matches without timeseries silently degrade) */}
      {anchorChain.length > 0 && (
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
          <div style={{ fontSize: '12px', color: '#f0883e', fontWeight: '600', marginBottom: '10px' }}>
            关键时刻
            <span style={{ fontSize: '10px', color: '#8b949e', fontWeight: '400', marginLeft: '8px' }}>
              {anchorChain.length} 个锚点
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {anchorChain.map((anchor, idx) => {
              const isExpanded = expandedAnchors.has(idx);
              const aColor = { critical: '#f85149', danger: '#f85149', warning: '#e3b341', success: '#56d364', info: '#79c0ff' }[anchor.severity] || '#8b949e';
              const icon = anchor.kind === 'death' ? '💀'
                : anchor.kind === 'momentum' ? (anchor.type === 'momentum_gain' ? '📈' : '📉')
                : anchor.kind === 'pace' ? '⚖️'
                : '⏱️';

              // Causal link data for this anchor
              const fromLinks = (linksByFrom[anchor.gameTime] || []).filter((l) => {
                const meta = RELATION_META[l.relation];
                return meta && meta.fromKind === anchor.kind;
              });
              const toLinks = (linksByTo[anchor.gameTime] || []).filter((l) => {
                const meta = RELATION_META[l.relation];
                return meta && meta.toKind === anchor.kind;
              });
              const activeLinkForRow = [...fromLinks, ...toLinks].find(
                (l) => linkKey(l) === activeLink
              ) || null;
              const isHighlighted = activeLinkForRow !== null;

              return (
                <div key={idx} style={{
                  borderRadius: '6px',
                  background: isHighlighted ? '#79c0ff09' : 'transparent',
                  border: `1px solid ${isHighlighted ? '#79c0ff33' : 'transparent'}`,
                }}>
                  <div
                    onClick={() => setExpandedAnchors((prev) => {
                      const next = new Set(prev);
                      if (next.has(idx)) next.delete(idx); else next.add(idx);
                      return next;
                    })}
                    style={{ padding: '5px 4px', borderBottom: '1px solid #30363d22', display: 'flex', gap: '10px', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                  >
                    <span style={{ fontSize: '11px', color: '#8b949e', flexShrink: 0, width: '36px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(anchor.gameTime)}
                    </span>
                    <span style={{ fontSize: '13px', flexShrink: 0 }}>{icon}</span>
                    <span style={{ fontSize: '12px', color: aColor, flex: 1, lineHeight: '1.4' }}>{anchor.summary}</span>
                    {/* Causal badges — from end */}
                    {fromLinks.map((l) => (
                      <CausalBadge
                        key={linkKey(l)}
                        text={RELATION_META[l.relation]?.fromBadge || '⚡ 因果连接'}
                        confidence={l.confidence}
                        isActive={linkKey(l) === activeLink}
                        onClick={(e) => { e.stopPropagation(); setActiveLink((prev) => prev === linkKey(l) ? null : linkKey(l)); }}
                      />
                    ))}
                    {/* Causal badges — to end */}
                    {toLinks.map((l) => (
                      <CausalBadge
                        key={linkKey(l) + '_to'}
                        text={RELATION_META[l.relation]?.toBadge(l) || '← 因果连接'}
                        confidence={l.confidence}
                        isActive={linkKey(l) === activeLink}
                        onClick={(e) => { e.stopPropagation(); setActiveLink((prev) => prev === linkKey(l) ? null : linkKey(l)); }}
                      />
                    ))}
                    <span style={{ fontSize: '11px', color: '#8b949e55', flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>
                  </div>
                  {isExpanded && (
                    <div style={{ marginLeft: '46px', marginBottom: '4px' }}>
                      {anchor.kind === 'death' && renderDeathContext(anchor.detail?.context)}
                      {anchor.kind === 'momentum' && anchor.detail && (
                        <div style={{ marginTop: '4px', padding: '6px 8px', background: '#161b22', borderRadius: '6px', fontSize: '11px', color: '#8b949e', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div>
                            节奏斜率{' '}
                            <span style={{ color: anchor.detail.slopeBefore > 0 ? '#56d364' : '#f85149' }}>{Math.round(anchor.detail.slopeBefore)}</span>
                            {' → '}
                            <span style={{ color: anchor.detail.slopeAfter > 0 ? '#56d364' : '#f85149' }}>{Math.round(anchor.detail.slopeAfter)}</span>
                            {' 金币/分钟'}
                          </div>
                          <div>变化幅度 <span style={{ color: '#e3b341' }}>{Math.round(anchor.detail.magnitude)}</span> 金币/分钟</div>
                          <div>
                            拐点经济差{' '}
                            <span style={{ color: anchor.detail.advAtShift >= 0 ? '#56d364' : '#f85149' }}>
                              {anchor.detail.advAtShift > 0 ? '+' : ''}{anchor.detail.advAtShift?.toLocaleString?.() ?? anchor.detail.advAtShift}g
                            </span>
                          </div>
                        </div>
                      )}
                      {anchor.kind === 'spike' && anchor.detail && (
                        <div style={{ marginTop: '4px', padding: '6px 8px', background: '#161b22', borderRadius: '6px', fontSize: '11px', color: '#8b949e', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div>
                            我方{' '}
                            <span style={{ color: '#79c0ff' }}>{itemDisplayName(`item_${anchor.detail.myItem}`)}</span>
                            {' @ '}
                            <span style={{ color: '#e6edf3' }}>{formatTime(anchor.detail.myTime)}</span>
                          </div>
                          {anchor.detail.enemyHero != null ? (
                            <div>
                              敌方{' '}
                              <span style={{ color: '#f0883e' }}>{anchor.detail.enemyHero}</span>
                              {' 的 '}
                              <span style={{ color: '#79c0ff' }}>{itemDisplayName(`item_${anchor.detail.enemyItem}`)}</span>
                              {' @ '}
                              <span style={{ color: '#e6edf3' }}>{formatTime(anchor.detail.enemyTime)}</span>
                            </div>
                          ) : (
                            <div style={{ color: '#56d364' }}>无敌方同装备，独有强势期</div>
                          )}
                          {anchor.detail.delta !== null && (
                            <div>
                              {anchor.detail.delta > 0 ? '落后 ' : '领先 '}
                              <span style={{ color: anchor.detail.delta > 0 ? '#f85149' : '#56d364', fontWeight: anchor.detail.significant ? '700' : '400' }}>
                                {formatTime(Math.abs(anchor.detail.delta))}
                              </span>
                              {anchor.detail.significant && <span style={{ color: '#e3b341', marginLeft: '4px' }}>（显著）</span>}
                            </div>
                          )}
                        </div>
                      )}
                      {anchor.kind === 'pace' && anchor.detail && (
                        <div style={{ marginTop: '4px', padding: '6px 8px', background: '#161b22', borderRadius: '6px', fontSize: '11px', color: '#8b949e', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div>
                            我方 <span style={{ color: '#79c0ff' }}>{anchor.detail.myCount}</span> 件
                            {' / 敌方 '}
                            <span style={{ color: '#f0883e' }}>{anchor.detail.enemyCount}</span> 件
                            {anchor.detail.enemyHero != null && <>（<span style={{ color: '#f0883e' }}>{anchor.detail.enemyHero}</span>）</>}
                          </div>
                          <div>
                            触发装备 <span style={{ color: '#79c0ff' }}>{itemDisplayName(`item_${anchor.detail.triggerItem}`)}</span>
                            {anchor.detail.significant && <span style={{ color: '#e3b341', marginLeft: '4px' }}>（显著）</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Inline evidence panel — appears when this anchor is the active link endpoint */}
                  {activeLinkForRow && (
                    <div style={{ marginLeft: '46px', marginTop: '2px', marginBottom: '6px', padding: '6px 8px', background: '#161b22', border: '1px solid #79c0ff22', borderRadius: '6px', fontSize: '11px', color: '#8b949e', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{ fontSize: '10px', color: '#79c0ff', marginBottom: '1px' }}>因果证据</div>
                      {renderLinkEvidence(activeLinkForRow.evidence)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Logic chain cards — 逻辑链 (hidden when no links; GSI matches degrade silently) */}
      {anchorLinks.length > 0 && (
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px', marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', color: '#bc8cff', fontWeight: '600', marginBottom: '10px' }}>
            逻辑链
            <span style={{ fontSize: '10px', color: '#8b949e', fontWeight: '400', marginLeft: '8px' }}>
              {anchorLinks.length} 条因果连接
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[...anchorLinks].sort((a, b) => a.from - b.from).map((link) => {
              const key  = linkKey(link);
              const meta = RELATION_META[link.relation];
              const title = meta
                ? meta.cardTitle(link)
                : `${formatTime(link.from)} → ${formatTime(link.to)}（${link.relation}）`;
              const cs         = CONFIDENCE_STYLE[link.confidence] || CONFIDENCE_STYLE.weak;
              const isActive   = activeLink === key;
              const isCardExp  = expandedCards.has(key);
              return (
                <div
                  key={key}
                  onClick={() => setActiveLink((prev) => prev === key ? null : key)}
                  style={{
                    background: isActive ? '#1a1535' : '#161b22',
                    border: `1px solid ${isActive ? cs.border : '#30363d44'}`,
                    borderRadius: '6px', padding: '8px 10px', cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: isActive ? cs.color : '#c9d1d9', flex: 1, fontWeight: '600' }}>
                      {title}
                    </span>
                    <span style={{ fontSize: '10px', color: cs.color, background: cs.bg, padding: '1px 7px', borderRadius: '8px', border: `1px solid ${cs.border}`, flexShrink: 0 }}>
                      {cs.label}
                    </span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedCards((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        });
                      }}
                      style={{ fontSize: '11px', color: '#8b949e55', cursor: 'pointer', flexShrink: 0, padding: '0 4px' }}
                    >
                      {isCardExp ? '▾' : '▸'}
                    </span>
                  </div>
                  {isCardExp && (
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #30363d33', fontSize: '11px', color: '#8b949e', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {renderLinkEvidence(link.evidence)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Event list */}
      {events.length > 0 && (
        <div style={{ background: '#0d1117', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '12px', color: '#8b949e', fontWeight: '600', marginBottom: '10px' }}>
            事件时间线 ({events.length} 条)
          </div>
          {isImport && missingDeaths > 0 && (
            <div style={{
              background: '#0d2137', border: '1px solid #79c0ff33',
              borderRadius: '6px', padding: '8px 12px', marginBottom: '10px',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <span style={{ color: '#79c0ff', fontSize: '13px', flexShrink: 0 }}>ℹ</span>
              <span style={{ fontSize: '12px', color: '#8b949e' }}>
                已定位 {reconstructedDeaths}/{m.deaths} 次死亡，其余 {missingDeaths} 次来自防御塔/野怪/Roshan，无法从日志确定时间
              </span>
            </div>
          )}
          <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {groupEventsForDisplay(events).map((item) => {
              // Collapsed consumable group
              if (item.isGroup) {
                const isExpanded = expandedGroups.has(item.key);
                const first = item.events[0];
                const last  = item.events[item.events.length - 1];
                return (
                  <div key={item.key}>
                    <div
                      onClick={() => setExpandedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.key)) next.delete(item.key); else next.add(item.key);
                        return next;
                      })}
                      style={{ padding: '5px 0', borderBottom: '1px solid #30363d22', display: 'flex', gap: '10px', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                    >
                      <span style={{ fontSize: '11px', color: '#8b949e', flexShrink: 0, width: '36px', textAlign: 'right' }}>
                        {formatTime(first.game_time)}
                      </span>
                      <span style={{ fontSize: '11px', color: '#8b949e88' }}>
                        {isExpanded ? '▾' : '▸'} 消耗品购买 × {item.events.length} 条
                        {item.events.length > 1 && ` (${formatTime(first.game_time)}–${formatTime(last.game_time)})`}
                      </span>
                    </div>
                    {isExpanded && item.events.map((e) => renderEventRow(e))}
                  </div>
                );
              }
              // Regular event row
              return renderEventRow(item);
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const EXCLUDE_REASONS = [
  { value: 'bot_test',         label: '机器人测试' },
  { value: 'unranked',         label: '非排位赛' },
  { value: 'development_test', label: '开发测试' },
  { value: 'corrupted_data',   label: '数据损坏' },
  { value: 'duplicate',        label: '重复记录' },
  { value: 'other',            label: '其他' },
];

// ── Match list ─────────────────────────────────────────────────────────────

export default function MatchHistory() {
  const [matches, setMatches]             = useState([]);
  const [loading, setLoading]             = useState(true);
  const [selectedId, setSelectedId]       = useState(null);
  const [showExcluded, setShowExcluded]   = useState(false);
  const [actionDialog, setActionDialog]   = useState(null); // { mode: 'exclude' | 'delete', matchId, label }
  const [excludeReason, setExcludeReason] = useState('bot_test');
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast]                 = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function loadMatches(incExcluded) {
    setLoading(true);
    const qs = `limit=50${incExcluded ? '&includeExcluded=true' : ''}`;
    fetch(`/api/history/matches?${qs}`)
      .then((r) => r.json())
      .then(setMatches)
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadMatches(showExcluded); }, [showExcluded]);

  function handleExcludeConfirm() {
    setActionLoading(true);
    fetch(`/api/history/matches/${actionDialog.matchId}/exclude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: excludeReason }),
    })
      .then(() => { setActionDialog(null); loadMatches(showExcluded); })
      .catch(() => setToast({ message: '排除失败' }))
      .finally(() => setActionLoading(false));
  }

  function handleDeleteConfirm() {
    setActionLoading(true);
    const { matchId } = actionDialog;
    fetch(`/api/history/matches/${matchId}`, { method: 'DELETE' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.message || '删除失败');
        }
        setActionDialog(null);
        if (selectedId === matchId) setSelectedId(null);
        loadMatches(showExcluded);
      })
      .catch((err) => setToast({ message: err.message }))
      .finally(() => setActionLoading(false));
  }

  function handleActionConfirm() {
    if (!actionDialog) return;
    return actionDialog.mode === 'delete' ? handleDeleteConfirm() : handleExcludeConfirm();
  }

  function handleInclude(matchId, e) {
    e.stopPropagation();
    fetch(`/api/history/matches/${matchId}/include`, { method: 'POST' })
      .then(() => loadMatches(showExcluded))
      .catch(() => {});
  }

  if (selectedId) {
    return (
      <div style={card}>
        <MatchDetail
          matchId={selectedId}
          onBack={() => setSelectedId(null)}
          onDelete={(matchId, label) => setActionDialog({ mode: 'delete', matchId, label })}
        />
      </div>
    );
  }

  return (
    <div style={card}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ ...sectionTitle, marginBottom: 0 }}>
          历史比赛记录
          {matches.length > 0 && <span style={{ color: '#f0883e', marginLeft: '8px' }}>({matches.length} 局)</span>}
        </div>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={showExcluded}
            onChange={(e) => setShowExcluded(e.target.checked)}
            style={{ accentColor: '#f0883e' }}
          />
          <span style={{ fontSize: '12px', color: '#8b949e' }}>显示已排除</span>
        </label>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px 0' }}>加载中...</div>
      ) : matches.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px 0' }}>
          暂无历史记录
          <br />
          <span style={{ fontSize: '12px' }}>比赛结束后自动保存，或使用上方「比赛预览」导入历史比赛</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {matches.map((m) => {
            const isExcluded = m.is_excluded === 1;
            const resultCfg = RESULT_CONFIG[m.result] || { color: '#8b949e', bg: '#161b22' };
            const gradeColor = GRADE_COLORS[m.overall_grade] || '#8b949e';
            return (
              <div
                key={m.id}
                onClick={() => !isExcluded && setSelectedId(m.match_id)}
                style={{
                  background: '#0d1117', border: `1px solid ${isExcluded ? '#30363d55' : '#30363d'}`,
                  borderRadius: '8px', padding: '12px 16px',
                  cursor: isExcluded ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: '12px',
                  opacity: isExcluded ? 0.55 : 1,
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => { if (!isExcluded) e.currentTarget.style.borderColor = '#f0883e'; }}
                onMouseLeave={(e) => { if (!isExcluded) e.currentTarget.style.borderColor = '#30363d'; }}
              >
                <div style={{ width: '4px', alignSelf: 'stretch', borderRadius: '2px', background: resultCfg.color, flexShrink: 0 }} />

                <div style={{ minWidth: '120px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#f0883e' }}>
                    {heroDisplayName(m.hero)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                    {m.archetype?.replace(/_/g, ' ') || 'offlane'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <Badge text={m.result || '—'} color={resultCfg.color} bg={resultCfg.bg} />
                  {m.overall_grade && <Badge text={m.overall_grade} color={gradeColor} />}
                  {m.source === 'opendota_import' && <Badge text="OpenDota 导入" color="#79c0ff" bg="#0d2137" />}
                  {isExcluded && <Badge text="已排除" color="#8b949e" bg="#30363d" />}
                </div>

                <div style={{ fontSize: '13px', color: '#e6edf3', minWidth: '80px' }}>
                  {m.kills}/{m.deaths}/{m.assists}
                </div>

                <div style={{ fontSize: '12px', color: '#e3b341', minWidth: '80px' }}>
                  {Math.round(m.gpm)} GPM
                </div>

                <div style={{ flex: 1, fontSize: '11px', color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.one_thing_to_improve || ''}
                </div>

                <div style={{ fontSize: '11px', color: '#8b949e', flexShrink: 0 }}>
                  {formatDate(m.end_time)}
                </div>

                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  {isExcluded ? (
                    <button
                      onClick={(e) => handleInclude(m.match_id, e)}
                      style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '5px', padding: '3px 10px', color: '#8b949e', fontSize: '11px', cursor: 'pointer' }}
                    >
                      恢复
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExcludeReason('bot_test');
                        setActionDialog({ mode: 'exclude', matchId: m.match_id, label: `${heroDisplayName(m.hero)} · ${formatDate(m.end_time)}` });
                      }}
                      style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '5px', padding: '3px 10px', color: '#8b949e', fontSize: '11px', cursor: 'pointer' }}
                    >
                      排除
                    </button>
                  )}
                  {m.source === 'opendota_import' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionDialog({ mode: 'delete', matchId: m.match_id, label: `${heroDisplayName(m.hero)} · ${formatDate(m.end_time)}` });
                      }}
                      style={{ background: '#3d1a1a', border: '1px solid #f85149', borderRadius: '5px', padding: '3px 10px', color: '#f85149', fontSize: '11px', cursor: 'pointer' }}
                    >
                      🗑 删除
                    </button>
                  )}
                </div>

                {!isExcluded && <span style={{ color: '#30363d', fontSize: '16px' }}>›</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Exclude / delete confirmation dialog */}
      {actionDialog && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setActionDialog(null)}
        >
          <div
            style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '12px', padding: '24px', minWidth: '320px', maxWidth: '400px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#e6edf3', marginBottom: '6px' }}>
              {actionDialog.mode === 'delete' ? '彻底删除此比赛？' : '排除比赛记录'}
            </div>
            <div style={{ fontSize: '12px', color: '#8b949e', marginBottom: actionDialog.mode === 'delete' ? '4px' : '18px' }}>
              {actionDialog.label}
            </div>
            {actionDialog.mode === 'delete' ? (
              <div style={{ fontSize: '12px', color: '#f85149', marginBottom: '18px', lineHeight: '1.6' }}>
                此操作不可撤销。将删除该比赛的所有记录。OpenDota 缓存保留，可重新导入。
              </div>
            ) : (
              <div style={{ marginBottom: '18px' }}>
                <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '6px' }}>排除原因</label>
                <select
                  value={excludeReason}
                  onChange={(e) => setExcludeReason(e.target.value)}
                  style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', padding: '8px 10px', color: '#e6edf3', fontSize: '13px', cursor: 'pointer' }}
                >
                  {EXCLUDE_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setActionDialog(null)}
                style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '6px', padding: '7px 16px', color: '#8b949e', fontSize: '12px', cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={handleActionConfirm}
                disabled={actionLoading}
                style={{ background: '#3d1a1a', border: '1px solid #f85149', borderRadius: '6px', padding: '7px 16px', color: '#f85149', fontSize: '12px', cursor: 'pointer', fontWeight: '600', opacity: actionLoading ? 0.6 : 1 }}
              >
                {actionLoading
                  ? (actionDialog.mode === 'delete' ? '删除中...' : '排除中...')
                  : (actionDialog.mode === 'delete' ? '确认删除' : '确认排除')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error toast */}
      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{
            position: 'fixed', bottom: '20px', right: '20px', zIndex: 1100,
            background: '#3d1a1a', border: '1px solid #f85149', borderRadius: '8px',
            padding: '10px 16px', color: '#f85149', fontSize: '12px', cursor: 'pointer',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
