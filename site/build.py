import json, os, sys
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE,'data'))
from global_names import G
from myth_names import K
from books import BOOKS
ind=json.load(open(os.path.join(HERE,'data','south_asia_names.json')))
LANG=dict(ind['langs'])
LANG.update({'ja':'Japanese','ko':'Korean','zh':'Chinese','mn':'Mongolian','vi':'Vietnamese','th':'Thai','tl':'Filipino','id':'Indonesian & Malay',
 'haw':'Hawaiian','mi':'Māori','ar':'Arabic','fa':'Persian','he':'Hebrew','tr':'Turkish','ka':'Georgian','hy':'Armenian','am':'Amharic',
 'sw':'Swahili','yo':'Yoruba','ig':'Igbo','ak':'Akan','zu':'Zulu & Xhosa','sn':'Shona','ga':'Irish','cy':'Welsh','gd':'Scottish Gaelic',
 'no':'Norse & Scandinavian','fi':'Finnish','de':'German','fr':'French','it':'Italian','es':'Spanish','pt':'Portuguese','el':'Greek','la':'Latin',
 'sl':'Slavic','hu':'Hungarian','qu':'Quechua','nah':'Nahuatl','arn':'Mapuche','tupi':'Tupi',
 'grc':'Ancient Greek','non':'Old Norse','ang':'Old English','sga':'Old Irish','sux':'Sumerian','akk':'Akkadian','egy':'Ancient Egyptian',
 'ave':'Avestan','otk':'Old Turkic','ett':'Etruscan','arc':'Aramaic','pi':'Pali','lt':'Lithuanian','ky':'Kyrgyz','bo':'Tibetan',
 'quc':'K’iche’ Maya','myn':'Yucatec Maya','gn':'Guaraní','man':'Mandinka','ha':'Hausa','fon':'Fon'})
LANG['la']='Latin'
ANCIENT={'grc','la','non','ang','sga','sux','akk','egy','ave','otk','ett','pi'}
REG={'sa':'South Asia','ca':'Central Asia & the steppe','ea':'East Asia','sea':'Southeast Asia','wa':'West Asia & North Africa','af':'Africa','eu':'Europe','ams':'The Americas','pac':'The Pacific'}
LREG={}
for c in ind['langs']: LREG[c]=['sa']
for c in 'ja ko zh mn'.split(): LREG[c]=['ea']
for c in 'vi th tl id'.split(): LREG[c]=['sea']
for c in 'haw mi'.split(): LREG[c]=['pac']
for c in 'ar fa he tr ka hy'.split(): LREG[c]=['wa']
for c in 'am sw yo ig ak zu sn'.split(): LREG[c]=['af']
for c in 'ga cy gd no fi de fr it el la sl hu'.split(): LREG[c]=['eu']
for c in 'es pt'.split(): LREG[c]=['eu','ams']
for c in 'qu nah arn tupi quc myn gn'.split(): LREG[c]=['ams']
for c in 'grc non ang sga ett lt'.split(): LREG[c]=['eu']
for c in 'sux akk egy ave arc'.split(): LREG[c]=['wa']
for c in 'otk ky bo'.split(): LREG[c]=['ca']
for c in 'man ha fon'.split(): LREG[c]=['af']
LREG['pi']=['sa']
THEMES={'moon':'moonlight & night','light':'light, sun & dawn','sky':'stars, sky & wind','flowers':'flowers & trees','water':'rivers & the sea',
 'love':'love & tenderness','story':'legends & old stories','wonder':'joy, hope & wonder','peace':'peace & calm','kind':'kindness & grace',
 'rain':'rain, snow & clouds','music':'song & sweetness','wisdom':'wisdom','strength':'strength & courage','divine':'faith & the divine'}
names=[]
for x in ind['names']:
    d={k:x[k] for k in ('n','s','g','l','m','p','t','r','e') }
    if x.get('i'): d['i']=x['i']
    if x.get('src'): d['src']=x['src']
    d['id']=x['n']+'|'+x['l']; d['reg']=LREG[x['l']]; names.append(d)
for (n,s,g,l,m,p,t,r,e,i,book) in K:
    d=dict(n=n,s=s,g=g,l=l,m=m,p=p,t=t,r=r,e=e,id=n+'|'+l,reg=LREG[l])
    if i: d['i']=i
    if book: d['book']=book
    names.append(d)
for (n,s,g,l,m,p,t,r,e,i,src) in G:
    d=dict(n=n,s=s,g=g,l=l,m=m,p=p,t=t,r=r,e=e,id=n+'|'+l,reg=LREG[l])
    if i: d['i']=i
    if src: d['src']=src
    names.append(d)
# books for existing entries
BOOKMAP={'Usha':'rigveda','Ahana':'rigveda','Aditi':'rigveda','Ila':'rigveda','Rudra':'rigveda','Lopamudra':'rigveda','Ghosha':'rigveda','Urvashi':'rigveda',
 'Maitreyi':'upanishads','Gargi':'upanishads','Nachiketa':'upanishads','Satyakam':'upanishads','Savitri':'mahabharata','Damayanti':'mahabharata','Arjun':'mahabharata',
 'Shravan':'ramayana','Sarayu':'ramayana','Priyamvada':'kalidasa','Anasuya':'kalidasa','Shakuntala':'kalidasa','Malavika':'kalidasa','Megh':'kalidasa','Kurinji':'sangam',
 'Ilango':'silappadikaram','Heer':'heer','Layla':'nizami','Shirin':'nizami','Noa':'bible','Naomi':'bible','Aino':'kalevala','Ilmari':'kalevala','Rhiannon':'mabinogion',
 'Dylan':'mabinogion','Niamh':'irish','Oisín':'irish','Fionn':'irish','Bríd':'irish','Freya':'edda','Idun':'edda','Saga':'edda','Makeda':'kebra','Beatrice':'dante',
 'Thalia':'theogony','Selene':'theogony','Iris':'theogony','Penelope':'homer','Leander':'ovid','Temujin':None,'Inti':'inca','Killa':'inca','Tala':None,'Iara':None}
for d in names:
    if 'book' not in d and BOOKMAP.get(d['n']): d['book']=BOOKMAP[d['n']]
    if d.get('book'): assert d['book'] in BOOKS, d['book']
    kinds=[]
    if d.get('book'): kinds.append('myth')
    if d['l'] in ANCIENT: kinds.append('ancient')
    if d['l'] not in ANCIENT: kinds.append('today')
    d['k2']=kinds
# gender: only strongly gendered names keep f/m
for d in names:
    if d['n'] in ('Ritu','Yue','Marama','Río'): d['g']='u'
assert len({d['id'] for d in names})==len(names)
for d in names:
    for t in d['t']: assert t in THEMES,(d['n'],t)
    assert d['l'] in LANG,d['l']
# display names: use the proper spelling (diacritics, apostrophes); ids stay stable
import unicodedata as _u
def _fold(t): return ''.join(c for c in _u.normalize('NFD',t) if not _u.combining(c)).lower().replace(' ','').replace("'",'').replace('\u2019','').replace('\u02bc','')
for d in names:
    s_=d['s']
    if d['l'] not in ('la','nah','pi','ang','yo') and s_!=d['n'] and all(ord(c)<0x250 or c in '\u02bc\u2019' for c in s_) and _fold(s_)==_fold(d['n']):
        d['n']=s_
for disp,old in {'Chang\u2019e':'Change','N\u00fcwa':'Nuwa','Zhin\u00fc':'Zhinu','Tāne':'Tane','Māui':'Maui'}.items():
    for d in names:
        if d['n']==old: d['n']=disp
data=json.dumps({'LANG':LANG,'REGIONS':REG,'THEMES':THEMES,'NAMES':names,'BOOKS':{k:list(v) for k,v in BOOKS.items()},'ANCIENT':sorted(ANCIENT)},ensure_ascii=False,separators=(',',':'))
html=open(os.path.join(HERE,'template.html')).read().replace('__DATA__',data)
open(os.path.join(HERE,'dist','nama.html'),'w').write(html)
print(len(names),'names', len(LANG),'languages', round(len(html.encode())/1024),'KB')
import collections; print(collections.Counter(r for d in names for r in d['reg']))
