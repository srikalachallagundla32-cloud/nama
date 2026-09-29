import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, stripBoilerplate } from '../scripts/ingest-texts.ts';
import { Corpus } from '../src/texts/corpus.ts';

test('ingestion: strips licence boilerplate, splits by section, keeps passages within size', () => {
  const raw = `Header junk\n*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n\nRUNE I.\n\n${'The maiden sang by the water. '.repeat(80)}\n\nThen Aino walked home.\n\nRUNE II.\n\nKyllikki danced on the green island.\n\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***\nfooter`;
  const body = stripBoilerplate(raw);
  assert.ok(!body.includes('Header junk') && !body.includes('footer'));
  const ps = chunk('test-src', body, '^RUNE [IVXLC]+\\.?');
  assert.ok(ps.every((p) => p.text.length <= 1800));
  assert.ok(ps.some((p) => p.ref.startsWith('RUNE I.')) && ps.some((p) => p.ref === 'RUNE II.'));
  const c = new Corpus([{ id: 'test-src', kind: 'text', title: 'T', year: 1888, textLanguage: 'en', originalLanguage: 'fi', region: 'eu', license: 'public-domain' }], ps, []);
  assert.equal(c.search('Kyllikki island')[0]!.id, ps.find((p) => p.text.includes('Kyllikki'))!.id);
});
