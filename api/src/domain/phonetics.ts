/** Same phonetic rules as the website and the eval kit, so every surface agrees. */
export function pkey(raw: string): string {
  let s = (raw || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/g, 'o').replace(/ð/g, 'd').replace(/þ/g, 't').replace(/ı/g, 'i').replace(/æ/g, 'ae').replace(/[^a-z]/g, '');
  if (!s) return '';
  s = s.replace(/ch/g, 'C').replace(/sh/g, 's').replace(/ph/g, 'f').replace(/th/g, 't').replace(/dh/g, 'd').replace(/bh/g, 'b')
    .replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/jh/g, 'j').replace(/zh/g, 'l').replace(/ck/g, 'k').replace(/q/g, 'k')
    .replace(/x/g, 'ks').replace(/z/g, 'j').replace(/w/g, 'v').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ou/g, 'u').replace(/ai|ay/g, 'e').replace(/y$/, 'i').replace(/ie$/, 'i');
  if (s.length > 3) s = s.replace(/([^aeiouC])e$/, '$1');
  return s.replace(/h$/, '').replace(/(.)\1+/g, '$1');
}

export const syllables = (k: string) => (k.match(/[aeiou]+/g) || ['']).length;

function lev(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

export function soundSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const r = (x: string, y: string) => 1 - lev(x, y) / Math.max(x.length || 1, y.length || 1);
  const cons = r(a.replace(/[aeiou]/g, ''), b.replace(/[aeiou]/g, ''));
  const end = (x: string, y: string) => (x.slice(-2) === y.slice(-2) ? 1 : x.slice(-1) === y.slice(-1) ? 0.6 : 0);
  const e2 = Math.max(end(a, b), end(a.replace(/a$/, ''), b.replace(/a$/, '')));
  const sd = Math.abs(syllables(a) - syllables(b));
  const sy = sd === 0 ? 1 : sd === 1 ? 0.6 : 0;
  return 0.22 * r(a, b) + 0.28 * cons + 0.15 * (a[0] === b[0] ? 1 : 0) + 0.15 * e2 + 0.1 * sy
    + 0.1 * r(a.replace(/[^aeiou]/g, ''), b.replace(/[^aeiou]/g, ''));
}
