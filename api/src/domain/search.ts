import { pkey, soundSimilarity } from './phonetics.ts';
import type { Name, PublicName, Store } from './store.ts';

export type SearchParams = {
  kind?: 'myth' | 'ancient' | 'today'; region?: string; lang?: string[]; theme?: string[]; gender?: 'f' | 'm';
  rarity?: number[]; len?: ('short' | 'medium' | 'long')[]; easy?: boolean; letter?: string; book?: string;
  soundsLike?: string; sort?: 'best' | 'az' | 'rare'; limit?: number; cursor?: string;
};
export type SearchItem = PublicName & { soundScore?: number };
export type SearchResult = { total: number; items: SearchItem[]; nextCursor: string | null };

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Fast path: pure in-memory filtering, no AI, no network. */
export function search(store: Store, p: SearchParams): SearchResult {
  const sk = p.soundsLike ? pkey(p.soundsLike) : '';
  const out: { x: Name; score: number }[] = [];
  for (const x of store.names) {
    if (p.gender && !(x.g === p.gender || x.g === 'u')) continue;
    if (p.region && !x.reg.includes(p.region)) continue;
    if (p.kind && !x.k2.includes(p.kind)) continue;
    if (p.book && x.book !== p.book) continue;
    if (p.lang?.length && !p.lang.includes(x.l)) continue;
    if (p.theme?.length && !x.t.some((t) => p.theme!.includes(t))) continue;
    if (p.rarity?.length && !p.rarity.includes(x.r)) continue;
    if (p.len?.length && !p.len.includes(x.len)) continue;
    if (p.easy && x.e > 1) continue;
    if (p.letter && !fold(x.n).startsWith(p.letter)) continue;
    out.push({ x, score: sk ? soundSimilarity(sk, x.key) : 0 });
  }
  const sort = p.sort ?? 'best';
  // Every ordering has a final tie-break on id, so the same query always returns the same page.
  if (sort === 'az') out.sort((a, b) => a.x.n.localeCompare(b.x.n) || a.x.id.localeCompare(b.x.id));
  else if (sort === 'rare') out.sort((a, b) => b.x.r - a.x.r || a.x.n.localeCompare(b.x.n) || a.x.id.localeCompare(b.x.id));
  else if (sk) out.sort((a, b) => b.score - a.score || a.x.id.localeCompare(b.x.id));
  else out.sort((a, b) => a.x.mix - b.x.mix || a.x.id.localeCompare(b.x.id));
  const limit = p.limit ?? 24;
  const offset = p.cursor ? Number(p.cursor) : 0;
  const page = out.slice(offset, offset + limit);
  return {
    total: out.length,
    items: page.map(({ x, score }) => (sk ? { ...store.toPublic(x), soundScore: Math.round(score * 1000) / 1000 } : store.toPublic(x))),
    nextCursor: offset + limit < out.length ? String(offset + limit) : null,
  };
}
