import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { pkey, soundSimilarity, syllables } from './phonetics.ts';

const NameSchema = z.object({
  id: z.string().min(3).max(80),
  n: z.string().min(1).max(60),
  s: z.string().min(1).max(80),
  g: z.enum(['f', 'm', 'u']),
  l: z.string().min(2).max(6),
  m: z.string().min(1).max(160),
  p: z.string().min(1).max(80),
  t: z.array(z.string()).min(1).max(5),
  r: z.number().int().min(1).max(4),
  e: z.number().int().min(1).max(3),
  i: z.string().max(400).optional(),
  src: z.string().max(200).optional(),
  book: z.string().optional(),
  reg: z.array(z.string()).min(1).max(3),
  k2: z.array(z.enum(['myth', 'ancient', 'today'])).min(1),
  verified: z.boolean(),
}).strict();

export const DatasetSchema = z.object({
  LANG: z.record(z.string().min(1).max(40)),
  REGIONS: z.record(z.string().min(1).max(40)),
  THEMES: z.record(z.string().min(1).max(40)),
  BOOKS: z.record(z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()])),
  ANCIENT: z.array(z.string()),
  NAMES: z.array(NameSchema).min(1),
}).strict();

export type RawName = z.infer<typeof NameSchema>;
export type Name = RawName & { key: string; syl: number; len: 'short' | 'medium' | 'long'; mix: number };
export type Dataset = z.infer<typeof DatasetSchema>;

/** What the API returns. Internal fields (phonetic key, verification flag) never leave the server. */
export type PublicName = {
  id: string; name: string; script: string; gender: 'f' | 'm' | 'u'; language: string; languageName: string;
  regions: string[]; meaning: string; pronunciation: string; themes: string[]; rarity: number;
  story?: string; source?: string; book?: { key: string; title: string };
};

export class Store {
  readonly names: Name[];
  readonly byId: Map<string, Name>;
  readonly data: Dataset;
  readonly version: string;
  private similarCache = new Map<string, string[]>();

  constructor(data: Dataset) {
    this.data = data;
    const problems: string[] = [];
    const ids = new Set<string>();
    for (const x of data.NAMES) {
      if (ids.has(x.id)) problems.push(`duplicate id ${x.id}`);
      ids.add(x.id);
      if (!data.LANG[x.l]) problems.push(`${x.id}: unknown language ${x.l}`);
      for (const t of x.t) if (!data.THEMES[t]) problems.push(`${x.id}: unknown theme ${t}`);
      for (const r of x.reg) if (!data.REGIONS[r]) problems.push(`${x.id}: unknown region ${r}`);
      if (x.book && !data.BOOKS[x.book]) problems.push(`${x.id}: unknown book ${x.book}`);
      if (/[<>]/.test(x.n + x.m + (x.i ?? '') + (x.src ?? ''))) problems.push(`${x.id}: markup characters in text`);
    }
    if (problems.length) throw new Error('Dataset failed validation:\n' + problems.slice(0, 20).join('\n'));
    // Only verified names are ever served.
    this.names = data.NAMES.filter((x) => x.verified).map((x) => {
      const key = pkey(x.n);
      const syl = syllables(key);
      return { ...x, key, syl, len: syl <= 2 ? 'short' : syl === 3 ? 'medium' : 'long', mix: hashUnit(x.id + 'mix') } as Name;
    });
    this.byId = new Map(this.names.map((x) => [x.id, x]));
    this.version = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
  }

  static fromFile(path: string): Store {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`Dataset could not be read: ${(e as Error).message}`); }
    const parsed = DatasetSchema.safeParse(raw);
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      throw new Error(`Dataset failed validation at ${i.path.join('.')}: ${i.message}`);
    }
    return new Store(parsed.data);
  }

  toPublic(x: Name): PublicName {
    const out: PublicName = {
      id: x.id, name: x.n, script: x.s, gender: x.g, language: x.l, languageName: this.data.LANG[x.l]!,
      regions: x.reg, meaning: x.m, pronunciation: x.p, themes: x.t, rarity: x.r,
    };
    if (x.i) out.story = x.i;
    if (x.src) out.source = x.src;
    if (x.book) out.book = { key: x.book, title: this.data.BOOKS[x.book]![0] };
    return out;
  }

  /** Computed once per name, then served from memory. */
  similar(id: string, limit = 6): Name[] {
    let ids = this.similarCache.get(id);
    if (!ids) {
      const x = this.byId.get(id);
      if (!x) return [];
      ids = this.names.filter((y) => y.id !== id).map((y) => [y.id, soundSimilarity(x.key, y.key)] as const)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map((a) => a[0]);
      this.similarCache.set(id, ids);
    }
    return ids.slice(0, limit).map((i) => this.byId.get(i)!);
  }

  /** Warm every similar-names list at startup so no request pays for it. */
  warm(): void { for (const x of this.names) this.similar(x.id); }
}

export function hashUnit(s: string): number {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}
