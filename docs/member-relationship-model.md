# Member Relationship Model (Group Chat)

## Goal

Infer closer member relationships in group chat by combining:

1. Explicit interaction signal (`@mentions`)
2. Temporal adjacency signal (members speaking near each other in time)

## Scoring

For each member pair `(A, B)`:

- `mentionCount(A,B)`: undirected mention count (`A->B + B->A`)
- `temporalTurns(A,B)`: count of adjacent message turns between `A` and `B` within time window
- `temporalScore(A,B)`: `sum(exp(-delta / decaySeconds))` over adjacent turns

Normalize each signal across all pairs:

- `mentionNorm = mentionCount / maxMentionCount`
- `temporalNorm = temporalScore / maxTemporalScore`

Final closeness:

`closeness = mentionWeight * mentionNorm + temporalWeight * temporalNorm`

## Default Parameters

- `windowSeconds = 300`
- `decaySeconds = 120`
- `mentionWeight = 0.6`
- `temporalWeight = 0.4`
- `minScore = 0.12`
- `minTemporalTurns = 2`

## Current Implementation

Script: `scripts/generate-member-relationship-graph.cjs`

Run:

```bash
pnpm run analyze:relationship
```

Outputs:

- `data/member-relationship-model.json`: nodes, edges, score components
- `data/member-relationship-graph.mmd`: Mermaid graph

Adjust weights (example: emphasize temporal closeness):

```bash
node scripts/generate-member-relationship-graph.cjs \
  --mention-weight 0.2 \
  --temporal-weight 0.8 \
  --min-score 0.03
```

## App Integration Status

Integrated into app pipeline:

1. Worker query: `electron/main/worker/query/advanced/social.ts` (`getRelationshipGraph`)
2. IPC handler: `electron/main/ipc/chat.ts` (`chat:getRelationshipGraph`)
3. Preload API: `electron/preload/apis/chat.ts` (`chatApi.getRelationshipGraph`)
4. UI: `src/components/view/InteractionView.vue` (new relationship mode + parameter controls)
