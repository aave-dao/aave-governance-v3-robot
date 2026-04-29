# Aave Governance V3 Robot — Interface

Next.js app that mirrors the Tenderly Web3 Actions on Vercel crons and exposes an operator UI
for browsing proposals + manually advancing eligible stages.

## Architecture

```
interface/
├── app/
│   ├── api/
│   │   ├── cron/                    Vercel cron endpoints (25 routes, all every minute except health)
│   │   │   ├── governance-scan      runGovernanceScan(ethereum)
│   │   │   ├── voting-all           runVotingScan over all VOTING_CHAINS
│   │   │   ├── listener-poll        Polls VotingActivated logs since last cursor block
│   │   │   ├── cache-refresh        inspectProposal for the latest 20 proposals → DB
│   │   │   ├── health-daily         collectHealth + Slack/Telegram notify (daily)
│   │   │   └── exec-scan/<chain>/   runExecutionScan per chain (20 chains)
│   │   ├── proposals/               GET list + GET [id]
│   │   └── execute/                 POST → tx, GET [id] → status
│   ├── proposal/[id]/page.tsx       Detail page with timeline + payloads + action buttons
│   └── page.tsx                     Latest 20 proposals
├── lib/                              Server-only: env, dispatcher, refresh, listener, cron-handler
├── db/                               Drizzle schema + SQL migrations + seed
└── components/                       React UI
```

All state-changing logic comes from `../tenderly/src/core/actions` and `../tenderly/src/orchestration`.
The interface is a thin adapter — no re-implementation of check/execute logic.

## Local dev

```bash
cd interface
bun install
cp .env.example .env.local
# Fill in PRIVATE_KEY, ALCHEMY_API_KEY, DATABASE_URL, CRON_SECRET=devsecret

bun run db:migrate                  # applies db/migrations/*.sql
bun run db:seed                     # seeds the listener cursor at (latest L1 block - 100)
bun run dev                         # http://localhost:3000
```

Test crons via curl:

```bash
curl -H 'Authorization: Bearer devsecret' http://localhost:3000/api/cron/governance-scan
curl -H 'Authorization: Bearer devsecret' http://localhost:3000/api/cron/cache-refresh
curl -H 'Authorization: Bearer devsecret' http://localhost:3000/api/cron/exec-scan/polygon
```

Test execute (no auth — server re-runs check() before signing):

```bash
curl -X POST http://localhost:3000/api/execute \
  -H 'content-type: application/json' \
  -d '{"action":"activateVoting","id":"123","chainId":1}'
```

## Vercel deploy

1. Vercel project: **Root Directory** = repo root (`/`), **Build Command** = `cd interface && bun install && bun run build`, **Output Directory** = `interface/.next`.
2. Set env vars in Vercel dashboard (production + preview):
   - `PRIVATE_KEY`, `ALCHEMY_API_KEY`, `DATABASE_URL`, `CRON_SECRET`, `SLACK_WEBHOOK_URL` (optional), `TELEGRAM_*` (optional).
3. Apply migration once against the production DB: `DATABASE_URL=… bun run db:migrate`.
4. Seed the listener cursor: `DATABASE_URL=… bun run db:seed`.
5. The Vercel Cron Jobs tab will show 25 entries; they fire on the next minute boundary.

## Environment variables

| Name | Required | Purpose |
|------|----------|---------|
| `PRIVATE_KEY` | yes | Signer EOA, server-only |
| `ALCHEMY_API_KEY` | yes¹ | Alchemy key for all chains |
| `RPC_<NETWORK>` | optional¹ | Per-chain override (RPC_MAINNET, RPC_POLYGON, …) |
| `DATABASE_URL` | yes | Supabase Postgres pooler URL |
| `CRON_SECRET` | yes | Vercel sends `Authorization: Bearer ${CRON_SECRET}` |
| `SLACK_WEBHOOK_URL` | optional | Slack notifications |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | optional | Telegram bot |
| `TELEGRAM_WEBHOOK_URL` | optional | Telegram opaque relay |
| `LOG_LEVEL` | optional | `trace`/`debug`/`info`/`warn`/`error` (default `info`) |

¹ Set either `ALCHEMY_API_KEY` or at least one `RPC_<NETWORK>`; the toolbox falls back to the public RPC otherwise.

## How the cache works

The `cache-refresh` cron runs `inspectProposal` (from `../tenderly/src/orchestration/proposalInspector.ts`)
on the latest 20 L1 proposals every minute. The inspector already reads:

- L1 governance state + voting config
- VotingMachine state + voteConfig on the right voting chain
- Per-payload state on every execution chain
- IPFS metadata (best-effort)

…and produces an `eligibility` blob (per-action `{eligible, reason?, etaAt?}`) that the UI reads
verbatim. The UI never re-runs `check()` for rendering — it just reads the cached blob and toggles
buttons accordingly. `POST /api/execute` server-side re-runs `check()` before sending the tx.

## Auth

There is no authentication on `/api/execute` (per spec). Anyone with the URL can spend gas via the
configured signer. Cron endpoints are protected by `CRON_SECRET`. If abuse becomes a concern, gate
`/api/execute` behind Vercel Edge middleware with a shared secret.
