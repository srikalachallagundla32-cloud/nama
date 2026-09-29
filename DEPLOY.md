# nāma — Deployment goal & plan

## Standing goal (owner: Srikala)
Once the product is built out, **ship nāma as a real, self-hosted website on its own
domain — NOT the claude.ai artifact.** The artifact is only a shareable preview: its
sandbox (Content Security Policy) blocks it from calling our API, so the AI ask/generate
features can never run there. The real site must be deployed on hosting we control.

Also: **use an Anthropic API key** so `/api/ask` and `/api/generate` run in AI mode
(not just keyword "search-only" mode). The key lives in the host's secret store / local
`api/.env` (git-ignored) — never in git, never in the client.

## Target architecture
```
[ visitor ] → your-domain.com (static site, CDN)
                 │  fast path: filters, sound-alike — runs in the browser (names.json)
                 └─ smart path: fetch → api.your-domain.com  (Fastify API)
                                          ├─ /api/ask       (RAG, model picks from real names)
                                          ├─ /api/generate  (names from ingested book passages)
                                          └─ MCP (optional, Streamable HTTP behind auth)
```

## Steps (when we get here — this is plan #5)
1. **Static site** → Vercel or Netlify (free tier). Point a custom domain at it (~$12/yr).
   Build `site/` to a real output; set the site's CSP to allow `api.your-domain.com`.
2. **API** (`api/`) → Render / Fly.io / Railway (Node 22). Set env **secrets** on the host:
   `NODE_ENV=production`, `IP_HASH_SALT` (long random), `ANTHROPIC_API_KEY`,
   `ALLOWED_ORIGINS=https://your-domain.com` (CORS allow-list), HTTPS on.
3. **Connect** the site to the API via `api/web/apiClient.ts` (set the API base URL).
   Fast path stays client-side; only ask/generate cross the network.
4. **Data**: keep vectors in memory to start; move to Postgres + pgvector
   (Neon/Supabase free tier) only when we outgrow memory.
5. **Ops**: Redis for shared rate-limit/cache once there's more than one API instance.

## Rough cost to start
Domain ~$12/yr · site hosting $0 · API hosting $0–7/mo · model usage pennies/query (Haiku).

## Do NOT forget
- Real secrets go in the host's secret store, never in git. `api/.env` stays git-ignored.
- CORS allow-list = the real domain only. CSP on our host must permit the API origin.
- The artifact link stays as a demo; it will never be the production site.
