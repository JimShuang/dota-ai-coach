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

const ARCHETYPE_LABELS = {
  teamfight_initiator:    { label: '团战开团',   color: '#bc8cff' },
  lane_bully_tempo:       { label: '压制节奏',   color: '#f0883e' },
  aura_tank_save:         { label: '光环肉盾',   color: '#56d364' },
  utility_save_initiator: { label: '功能先手',   color: '#79c0ff' },
};

const PLAYSTYLE_OPTIONS = [
  { value: 'initiator',          label: '开团先手' },
  { value: 'aura_tank',          label: '光环肉盾' },
  { value: 'lane_bully',         label: '压制节奏' },
  { value: 'utility_frontliner', label: '功能支援' },
];

const selectStyle = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: '6px',
  color: '#e6edf3',
  fontSize: '13px',
  padding: '6px 10px',
  cursor: 'pointer',
  outline: 'none',
  width: '100%',
};

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
      <span style={{ fontSize: '12px', color: '#8b949e', width: '90px', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function Badge({ text, color }) {
  return (
    <span
      style={{
        padding: '2px 10px',
        borderRadius: '10px',
        fontSize: '12px',
        fontWeight: '600',
        background: (color || '#8b949e') + '22',
        color: color || '#8b949e',
        border: `1px solid ${(color || '#8b949e')}44`,
      }}
    >
      {text}
    </span>
  );
}

export default function OfflaneSetup({ matchConfig, onConfigSaved }) {
  const [playstyle, setPlaystyle] = useState('');
  const [keyItemOverride, setKeyItemOverride] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync local state when matchConfig loads
  useEffect(() => {
    if (matchConfig) {
      setPlaystyle(matchConfig.playstyle || '');
      setKeyItemOverride(matchConfig.keyItemOverride || '');
    }
  }, [matchConfig?.heroKey]);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/match/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playstyle: playstyle || null,
          keyItemOverride: keyItemOverride || null,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (onConfigSaved) onConfigSaved();
    } finally {
      setSaving(false);
    }
  }

  const profile = matchConfig?.heroProfile;
  const suggested = matchConfig?.suggested;
  const archetype = ARCHETYPE_LABELS[profile?.archetype];
  const keyItemList = profile?.keyItems || [];

  function currentHeroLabel() {
    if (profile) {
      return profile.heroNameZh
        ? `${profile.heroNameZh}（${profile.heroName}）`
        : profile.heroName;
    }
    if (matchConfig?.hero) return heroDisplayName(matchConfig.hero);
    return '等待英雄选择';
  }

  return (
    <div style={card}>
      <div style={sectionTitle}>Offlane 3号位 设置</div>

      {/* Hero + archetype (read-only, from GSI) */}
      <Row label="当前英雄">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '14px', fontWeight: '700', color: '#f0883e' }}>
            {currentHeroLabel()}
          </span>
          {archetype && <Badge text={archetype.label} color={archetype.color} />}
          {!profile && matchConfig?.hero && (
            <Badge text="不在支持列表" color="#8b949e" />
          )}
        </div>
      </Row>

      {/* Suggested key item */}
      <Row label="建议关键装">
        {suggested?.suggestedKeyItem ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '14px',
                fontWeight: '700',
                color: '#e3b341',
                background: '#e3b34122',
                border: '1px solid #e3b34144',
                borderRadius: '6px',
                padding: '4px 12px',
              }}
            >
              {suggested.displayName}
            </span>
            {suggested.cost && (
              <span style={{ fontSize: '12px', color: '#8b949e' }}>{suggested.cost.toLocaleString()} g</span>
            )}
            <span style={{ fontSize: '11px', color: '#8b949e' }}>
              {keyItemOverride ? '（已 override）' : '（自动推断）'}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: '13px', color: '#8b949e' }}>
            {suggested?.reason || '等待英雄数据'}
          </span>
        )}
      </Row>

      {/* Key item override */}
      {keyItemList.length > 0 && (
        <Row label="Override 装备">
          <select
            style={selectStyle}
            value={keyItemOverride}
            onChange={(e) => setKeyItemOverride(e.target.value)}
          >
            <option value="">自动（根据进度推断）</option>
            {keyItemList.map((item) => (
              <option key={item} value={item}>
                {itemDisplayName(item)}
              </option>
            ))}
          </select>
        </Row>
      )}

      {/* Playstyle */}
      <Row label="打法风格">
        <select
          style={selectStyle}
          value={playstyle}
          onChange={(e) => setPlaystyle(e.target.value)}
        >
          <option value="">默认（依照 Archetype）</option>
          {PLAYSTYLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Row>

      {/* Role indicator */}
      <Row label="位置">
        <Badge text="Offlane · 3号位" color="#56d364" />
      </Row>

      {/* Key item progression preview */}
      {keyItemList.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '8px' }}>关键装备路线</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {keyItemList.map((item, idx) => {
              const owned = (matchConfig?.suggested?.suggestedKeyItem === item)
                ? false
                : keyItemList.indexOf(matchConfig?.suggested?.suggestedKeyItem || '') > idx ||
                  matchConfig?.suggested?.suggestedKeyItem === null;
              const isCurrent = matchConfig?.suggested?.suggestedKeyItem === item;
              return (
                <React.Fragment key={item}>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: isCurrent ? '#e3b34122' : owned ? '#56d36422' : '#0d1117',
                      border: `1px solid ${isCurrent ? '#e3b341' : owned ? '#56d364' : '#30363d'}`,
                      color: isCurrent ? '#e3b341' : owned ? '#56d364' : '#8b949e',
                      fontWeight: isCurrent ? '700' : '400',
                    }}
                  >
                    {itemDisplayName(item)}
                  </span>
                  {idx < keyItemList.length - 1 && (
                    <span style={{ color: '#30363d', fontSize: '12px' }}>→</span>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '8px 20px',
          borderRadius: '8px',
          border: 'none',
          background: saved ? '#1a4731' : '#f0883e',
          color: saved ? '#56d364' : '#0d1117',
          fontSize: '13px',
          fontWeight: '700',
          cursor: saving ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s',
        }}
      >
        {saved ? '已保存 ✓' : saving ? '保存中...' : '保存设置'}
      </button>
    </div>
  );
}
