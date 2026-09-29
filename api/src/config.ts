import { z } from 'zod';

const isLocal = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u);

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  IP_HASH_SALT: z.string().min(16, 'must be at least 16 characters'),
  ANTHROPIC_API_KEY: z.string().trim().optional().transform((v) => (v ? v : undefined)),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-haiku-4-5-20251001'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  PRICE_IN_PER_MTOK: z.string().optional().transform((v) => (v ? Number(v) : undefined)),
  PRICE_OUT_PER_MTOK: z.string().optional().transform((v) => (v ? Number(v) : undefined)),
  TRACE_FILE: z.string().default('traces.jsonl'),
  REPORTS_FILE: z.string().default('reports.jsonl'),
});

export type Config = z.infer<typeof Env> & { allowedOrigins: Set<string> };

/** Fails fast: the server refuses to start on any invalid or unsafe setting. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Env.safeParse(env);
  if (!r.success) {
    throw new Error('Invalid configuration: ' + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const origins = r.data.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of origins) {
    let u: URL;
    try { u = new URL(o); } catch { throw new Error(`Invalid configuration: ALLOWED_ORIGINS contains a non-URL: ${o}`); }
    if (u.origin !== o) throw new Error(`Invalid configuration: ALLOWED_ORIGINS entries must be bare origins like https://site.com (got ${o})`);
    if (r.data.NODE_ENV === 'production' && u.protocol !== 'https:' && !isLocal(o)) {
      throw new Error(`Invalid configuration: ALLOWED_ORIGINS must use https in production (got ${o})`);
    }
  }
  if (r.data.NODE_ENV === 'production' && /change-me/i.test(r.data.IP_HASH_SALT)) {
    throw new Error('Invalid configuration: IP_HASH_SALT still has the example value');
  }
  return { ...r.data, allowedOrigins: new Set(origins) };
}
