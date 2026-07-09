'use strict';

// Digest assembly layer: takes the unified anchor chain + causal links (output of
// anchorChain.js / anchorLinker.js) and a match's meta/key-item-timings rows, and
// assembles them into a single structured object meant to be the eventual input to
// an AI post-game review. This module does NOT call any LLM and does NOT generate
// narrative text — it only assembles structured data. No I/O, no DB access; every
// input is passed in by the caller.
//
// Why this layer exists: A1-A4 links only carry two gameTime numbers ({from, to}),
// not anchor identity, and a single anchor can be the endpoint of multiple links
// (e.g. a death anchor is simultaneously A4's `to` and A1/A2/A3's `from`) — so the
// links form a branching graph, not a list of independent pairs. RULE_ENDPOINTS
// resolves {from, to} back to concrete anchors (kind + gameTime), and
// assembleChains groups connected links into "causal chains" via union-find over
// shared anchors (a connected component), not a linear path.

// Rule -> {fromKind, toKind} — mirrors anchorLinker.js's rule gates. This is the
// backend twin of the frontend's RELATION_META (MatchHistory.jsx): when a new rule
// (A5+) is added, both RULE_ENDPOINTS here and RELATION_META there must be updated.
const RULE_ENDPOINTS = {
  A1: { fromKind: 'death', toKind: 'momentum' },
  A2: { fromKind: 'death', toKind: 'spike' },
  A3: { fromKind: 'death', toKind: 'death' },
  A4: { fromKind: 'pace',  toKind: 'death' },
};

// Bump only on a breaking change to the digest shape (removed field, changed
// type, changed enum) and update server/schemas/matchDigest.schema.json in the
// same change. A pure additive field still requires a schema edit (the schema
// is additionalProperties:false throughout) but does not require a version bump.
const DIGEST_SCHEMA_VERSION = 1;

const CONFIDENCE_RANK = { strong: 3, medium: 2, weak: 1 };

function nodeKey(anchor) {
  return `${anchor.kind}@${anchor.gameTime}`;
}

// Anchors inside a digest drop `detail` (token economy) — causal evidence already
// lives on link.evidence; a caller that needs full detail can query /anchor-chain.
function slimAnchor(anchor) {
  const { gameTime, minute, kind, type, severity, summary } = anchor;
  return { gameTime, minute, kind, type, severity, summary };
}

// Resolve a link's {from, to} gameTimes back to concrete anchors using the rule's
// expected {fromKind, toKind}. Matching on gameTime+kind (not gameTime alone) so a
// same-second anchor of a different kind (e.g. pace and death in the same second)
// is never mistaken for the wrong endpoint.
function resolveEndpoints(link, anchors) {
  const endpoints = RULE_ENDPOINTS[link.rule];
  if (!endpoints) return null;
  const fromAnchor = anchors.find((a) => a.gameTime === link.from && a.kind === endpoints.fromKind);
  const toAnchor   = anchors.find((a) => a.gameTime === link.to   && a.kind === endpoints.toKind);
  if (!fromAnchor || !toAnchor) return null;
  return { fromAnchor, toAnchor };
}

// Union-find: group links into connected components (chains) by shared anchor
// nodes. A cycle can never occur (every link has from < to), but union-find
// tolerates one fine without needing a special case.
function assembleChains(anchors, links) {
  const warnings   = [];
  const parent     = new Map(); // nodeKey -> nodeKey
  const nodeAnchor = new Map(); // nodeKey -> anchor (unslimmed)
  const linkByRoot = new Map(); // will be filled after union pass

  function find(x) {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    // path compression
    while (parent.get(x) !== root) {
      const next = parent.get(x);
      parent.set(x, root);
      x = next;
    }
    return root;
  }
  function union(x, y) {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  }
  function ensureNode(anchor) {
    const key = nodeKey(anchor);
    if (!parent.has(key)) {
      parent.set(key, key);
      nodeAnchor.set(key, anchor);
    }
    return key;
  }

  const resolvedLinks = []; // { link, fromKey }
  for (const link of links) {
    const endpoints = RULE_ENDPOINTS[link.rule];
    if (!endpoints) {
      warnings.push(`unknown rule "${link.rule}" for link ${link.from}->${link.to}; dropped`);
      continue;
    }
    const resolved = resolveEndpoints(link, anchors);
    if (!resolved) {
      warnings.push(`could not resolve anchors for rule=${link.rule} link ${link.from}->${link.to}; dropped`);
      continue;
    }
    const fromKey = ensureNode(resolved.fromAnchor);
    const toKey   = ensureNode(resolved.toAnchor);
    union(fromKey, toKey);
    resolvedLinks.push({ link, fromKey });
  }

  for (const { link, fromKey } of resolvedLinks) {
    const root = find(fromKey);
    if (!linkByRoot.has(root)) linkByRoot.set(root, []);
    linkByRoot.get(root).push(link);
  }

  const nodesByRoot = new Map(); // root -> Set(nodeKey)
  for (const key of parent.keys()) {
    const root = find(key);
    if (!nodesByRoot.has(root)) nodesByRoot.set(root, new Set());
    nodesByRoot.get(root).add(key);
  }

  const chains = [];
  const linkedKeys = new Set();
  for (const [root, nodeKeys] of nodesByRoot.entries()) {
    for (const key of nodeKeys) linkedKeys.add(key);

    const anchorsInChain = [...nodeKeys]
      .map((k) => nodeAnchor.get(k))
      .sort((a, b) => a.gameTime - b.gameTime);
    const groupLinks = linkByRoot.get(root) || [];
    const gameTimes  = anchorsInChain.map((a) => a.gameTime);

    let maxConfidence = null;
    for (const l of groupLinks) {
      if (maxConfidence === null || CONFIDENCE_RANK[l.confidence] > CONFIDENCE_RANK[maxConfidence]) {
        maxConfidence = l.confidence;
      }
    }

    chains.push({
      span:          { start: Math.min(...gameTimes), end: Math.max(...gameTimes) },
      anchors:       anchorsInChain.map(slimAnchor),
      links:         groupLinks,
      anchor_count:  anchorsInChain.length,
      link_count:    groupLinks.length,
      max_confidence: maxConfidence,
      is_multi_hop:  groupLinks.length >= 2,
    });
  }

  chains.sort((a, b) => a.span.start - b.span.start);
  chains.forEach((c, i) => { c.id = `chain_${i + 1}`; });
  // Reorder so `id` reads first in the object (cosmetic — doesn't affect access).
  const ordered = chains.map((c) => ({
    id: c.id, span: c.span, anchors: c.anchors, links: c.links,
    anchor_count: c.anchor_count, link_count: c.link_count,
    max_confidence: c.max_confidence, is_multi_hop: c.is_multi_hop,
  }));

  return { chains: ordered, warnings, linkedKeys };
}

/**
 * Assemble a full match digest from pre-computed anchors/links and match meta.
 *
 * @param {object} params
 * @param {object} [params.matchMeta]       Raw `matches` table row (or {}).
 * @param {object[]} [params.anchors]       Unified Anchor array (buildAnchorChain output).
 * @param {object[]} [params.links]         Link array (linkAllAnchors output).
 * @param {object[]} [params.keyItemTimings] Raw `key_item_timings` rows, passed through verbatim.
 * @returns {object} digest — see CLAUDE.md "Match Digest" section for shape.
 */
function buildMatchDigest({ matchMeta = {}, anchors = [], links = [], keyItemTimings = [] } = {}) {
  const { chains, warnings, linkedKeys } = assembleChains(anchors, links);

  const standaloneAnchors = anchors
    .filter((a) => !linkedKeys.has(nodeKey(a)))
    .slice()
    .sort((a, b) => a.gameTime - b.gameTime)
    .map(slimAnchor);

  return {
    schema_version: DIGEST_SCHEMA_VERSION,
    meta: {
      hero:     matchMeta.hero ?? null,
      result:   matchMeta.result ?? null,
      duration: matchMeta.duration ?? null,
      kda: {
        kills:   matchMeta.kills ?? null,
        deaths:  matchMeta.deaths ?? null,
        assists: matchMeta.assists ?? null,
      },
      gpm:   matchMeta.gpm ?? null,
      xpm:   matchMeta.xpm ?? null,
      grade: matchMeta.overall_grade ?? null,
    },
    causal_chains: chains,
    standalone_anchors: standaloneAnchors,
    stats: {
      deaths_summary: {
        total:          matchMeta.deaths ?? null,
        pre_key_item:   matchMeta.pre_key_item_deaths ?? null,
        // No aggregate column exists in `matches` for these two — only the
        // per-death snapshot field `wasInPowerSpikeWindow` and the `no_tp_warning`
        // event type exist; neither is rolled up into a match-level count.
        in_power_spike: null,
        no_tp:          null,
      },
      key_item_timings: keyItemTimings,
    },
    warnings,
  };
}

module.exports = {
  buildMatchDigest,
  assembleChains,
  RULE_ENDPOINTS,
  DIGEST_SCHEMA_VERSION,
};
