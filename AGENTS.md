# Beast Battler — agent guide

Browser card battler (TypeScript + Vite + Three.js). **`PRD.md` is the source
of truth** for rules, card data, art direction, and scope. Don't deviate from
its numbers without a ticket and a human decision.

# Tracker — your work queue

The deployed tracker at **https://orbittrack.adamroch.com** is the source of
truth for agent work on this project. **This repo's project key is `CARD`** —
always scope requests with `?project=CARD`. Interact through the REST API
(`curl` or `fetch`), all JSON in/JSON out:

```bash
curl -H "Authorization: Bearer $ORBITTRACK_AGENT_TOKEN" \
  "https://orbittrack.adamroch.com/api/issues/frontier?project=CARD"
```

Every request needs the account-scoped bearer token `ORBITTRACK_AGENT_TOKEN`
(ask the human if it's not in your environment). Identifiers look like
`CARD-1`, `CARD-2`, …

## Standard workflow

1. **Check the frontier** — `GET /api/issues/frontier?project=CARD` (todo + unblocked).
2. **Claim one** — `POST /api/issues/CARD-1/claim` (atomic todo → in_progress).
3. **Do the work** — implement, test, verify.
4. **Mark done** — `PATCH /api/issues/CARD-1` with `{"status":"done"}`.
5. **Blocked on a decision?** Post a question instead of stalling:
   `POST /api/issues/CARD-1/questions` with `{"question":"..."}`, then poll
   the issue until the question flips to answered.
6. **Found new work?** Create a ticket (`POST /api/issues?project=CARD`) rather
   than fixing it inline.

Dependencies: `POST /api/issues/:id/blockers` with `{blockerId}` records
"A blocks B" (DAG enforced; `done` satisfies an edge, `canceled` does not).

Statuses: `todo` (grabbable) → `in_progress` (claimed) → `done`;
`backlog` = not committed, `canceled` = abandoned.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.

# Deployment

Production runs on **Railway** (project `beast-battler`, CLI-linked from this repo).
Redeploy with `railway up --detach` — nixpacks runs `npm ci` + `npm run build`, then
`npm start` serves `dist/` via the zero-dependency `server.mjs` (keep it that way; the
planned online-lobby WebSocket backend will attach to the same HTTP server).
Live at https://beastbattler.adamroch.com (fallback domain:
`beast-battler-production.up.railway.app`). DNS is in Cloudflare.
