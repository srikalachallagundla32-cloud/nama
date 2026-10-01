import json, os, sys, random
HERE = os.path.dirname(os.path.abspath(__file__))

# Read from api/data/names.json (the source of truth — 2000+ curated names)
names_data = json.load(open(os.path.join(HERE, '..', 'api', 'data', 'names.json')))
LANG   = names_data['LANG']
THEMES = names_data['THEMES']
BOOKS  = {k: list(v) for k, v in names_data['BOOKS'].items()}
all_names = names_data['NAMES']

REGIONS = {
    'sa': 'South Asia', 'ca': 'Central Asia & the steppe', 'ea': 'East Asia',
    'sea': 'Southeast Asia', 'wa': 'West Asia & North Africa', 'af': 'Africa',
    'eu': 'Europe', 'ams': 'The Americas', 'pac': 'The Pacific',
}
ANCIENT = sorted({'grc','la','non','ang','sga','sux','akk','egy','ave','otk','ett','pi'})

# Compute BOOK_COUNTS (used in the shelf) and LANG_REGION (used in buildLangs)
BOOK_COUNTS = {}
LANG_REGION = {}
for n in all_names:
    if n.get('book'):
        BOOK_COUNTS[n['book']] = BOOK_COUNTS.get(n['book'], 0) + 1
    lang = n.get('l', '')
    for r in n.get('reg', []):
        if lang not in LANG_REGION:
            LANG_REGION[lang] = []
        if r not in LANG_REGION[lang]:
            LANG_REGION[lang].append(r)

# NAMES_SEED: ~60 names (with stories) spread across regions — powers quick-search palette,
# name-of-the-day, harmony-lab suggestions, and the first paint before the API responds.
random.seed(42)
seed_by_region = {}
for n in all_names:
    if not n.get('i'):
        continue
    for r in n.get('reg', []):
        seed_by_region.setdefault(r, []).append(n)

seen_ids = set()
NAMES_SEED = []
for r in ['sa', 'eu', 'ea', 'wa', 'af', 'sea', 'ams', 'pac', 'ca']:
    pool = seed_by_region.get(r, [])
    random.shuffle(pool)
    added = 0
    for n in pool:
        if n['id'] not in seen_ids and added < 7:
            seen_ids.add(n['id'])
            NAMES_SEED.append(n)
            added += 1

data = json.dumps({
    'LANG': LANG,
    'REGIONS': REGIONS,
    'THEMES': THEMES,
    'BOOKS': BOOKS,
    'BOOK_COUNTS': BOOK_COUNTS,
    'LANG_REGION': LANG_REGION,
    'NAMES_SEED': NAMES_SEED,
    'ANCIENT': ANCIENT,
}, ensure_ascii=False, separators=(',', ':'))

api_base = os.environ.get('API_BASE', 'http://127.0.0.1:8080')
html = open(os.path.join(HERE, 'template.html')).read().replace('__DATA__', data).replace('__API_BASE__', api_base)
os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
open(os.path.join(HERE, 'dist', 'nama.html'), 'w').write(html)
print(len(all_names), 'names in API,', len(NAMES_SEED), 'in seed,', len(LANG), 'languages,', round(len(html.encode())/1024), 'KB')
import collections
print('Seed by region:', collections.Counter(r for n in NAMES_SEED for r in n.get('reg', [])))
