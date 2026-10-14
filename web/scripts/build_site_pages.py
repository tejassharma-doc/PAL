#!/usr/bin/env python3
"""
Builds the public marketing pages of palcare.life from web/site-src/:

  public/landing.html  — the landing page (served at "/" to visitors who are not signed in)
  public/pricing.html  — Individual / Family plans              (served at /pricing)
  public/terms.html    — Terms & Conditions                     (served at /terms)
  public/privacy.html  — Privacy Policy                         (served at /privacy)

Routing lives in next.config.js (rewrites). Re-run after editing any source:

  python3 scripts/build_site_pages.py

Sources:
  site-src/landing-original.html   the landing page exactly as designed
  site-src/terms-fragment.html     Terms & Conditions (converted from the .docx with pandoc)
  site-src/privacy-fragment.html   Privacy Policy     (converted from the .docx with pandoc)

All subpages reuse the landing page's own stylesheet, emblem artwork, nav and
footer, so every page looks like part of the same site.
"""
import html
import re
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'site-src'
OUT = ROOT / 'public'

# ── Plans (edit here) ───────────────────────────────────────────────────────
PRICE_PERIOD = 'month'  # billing period shown next to the price
PLANS = [
    {'name': 'Individual', 'price': 41, 'people': 'For 1 person', 'tag': None},
    {'name': 'Family', 'price': 99, 'people': 'For up to 3 people', 'tag': 'Best for families'},
]
FEATURES = [
    ('Ask PAL anything', 'Type or speak in your own Indian language — clear answers with references.'),
    ('Your record, only with your consent', 'PAL reads your health record only after you allow it for that conversation.'),
    ('All your medical records in one place', 'Lab tests, prescriptions, visit notes and documents, organised for you.'),
    ('Upload lab reports', 'PAL reads the values; you check them before anything is saved.'),
    ('Visits & your doctor’s care plan', 'Upcoming appointments and the plan your doctor wrote — shown exactly as written.'),
    ('Medicine reminders', 'On-time reminders you can mark as taken or snooze.'),
    ('Conversation history', 'Revisit, continue or delete past conversations.'),
    ('Safety first', 'Emergency words trigger an instant safety prompt with help numbers.'),
    ('Private by design', 'Every record access is logged. Your data is never sold or used for ads.'),
]

# ── Helpers ─────────────────────────────────────────────────────────────────
landing = (SRC / 'landing-original.html').read_text(encoding='utf-8')

SESSION_SCRIPT = """<script>
/* Signed-in visitors go straight to the app. The pal_session cookie lets the
   server send "/" to the app instead of this page (see next.config.js). */
(function(){try{
  if(localStorage.getItem('pal_token')){
    if(document.cookie.indexOf('pal_session=1')<0){document.cookie='pal_session=1; Path=/; Max-Age=2592000; SameSite=Lax';}
    if(location.pathname==='/'||location.pathname==='/landing.html'){location.replace('/');}
  }
}catch(e){}})();
</script>"""


def section(pattern: str, text: str) -> str:
    m = re.search(pattern, text, re.S)
    assert m, pattern
    return m.group(0)


STYLE = section(r'<style>.*?</style>', landing)
EMBLEM_DEFS = section(r'<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>.*?</defs></svg>', landing)
ICON_DEFS = section(r'<svg style="display:none" aria-hidden="true">.*?</svg>\s*(?=\n\s*<nav>)', landing)
FONT_LINKS = section(r'<link rel="preconnect" href="https://fonts.googleapis.com">.*?display=swap" rel="stylesheet">', landing) \
    if 'display=swap" rel="stylesheet">' in landing else section(r'<link rel="preconnect" href="https://fonts.googleapis.com">.*?<style>', landing)[:-7]
FAVICON = section(r'<link rel="icon"[^>]*>', landing)

# Fonts are self-hosted from public/site-fonts (SIL OFL, licences alongside).
# The site sends Cross-Origin-Embedder-Policy: require-corp, which makes
# third-party font CDNs fragile; same-origin files always load.
FACES = [
    ('Newsreader', 300, 'normal', 'Newsreader-Light'), ('Newsreader', 300, 'italic', 'Newsreader-LightItalic'),
    ('Newsreader', 400, 'normal', 'Newsreader-Regular'), ('Newsreader', 400, 'italic', 'Newsreader-Italic'),
    ('Newsreader', 500, 'normal', 'Newsreader-Medium'),
    ('Space Grotesk', 400, 'normal', 'SpaceGrotesk-Regular'), ('Space Grotesk', 500, 'normal', 'SpaceGrotesk-Medium'),
    ('Space Grotesk', 600, 'normal', 'SpaceGrotesk-SemiBold'), ('Space Grotesk', 700, 'normal', 'SpaceGrotesk-Bold'),
    ('Space Mono', 400, 'normal', 'SpaceMono-Regular'), ('Space Mono', 700, 'normal', 'SpaceMono-Bold'),
]
FONT_LINKS = '\n'.join(
    f'<link rel="preload" href="/site-fonts/{f}.ttf" as="font" type="font/ttf" crossorigin>'
    for f in ('SpaceGrotesk-Regular', 'SpaceGrotesk-SemiBold', 'Newsreader-Light', 'SpaceMono-Regular'))
FONT_CSS = ''.join(
    f"@font-face{{font-family:'{fam}';font-style:{st};font-weight:{w};font-display:swap;src:url('/site-fonts/{f}.ttf') format('truetype')}}\n"
    for fam, w, st, f in FACES)

EXTRA_CSS = """
""" + FONT_CSS + """
/* ---------- footer links (added) ---------- */
.foot-links{max-width:1240px;margin:18px auto 0;padding:0 var(--gutter);display:flex;flex-wrap:wrap;gap:10px 26px;
  font-size:.9rem;position:relative;z-index:2}
.foot-links a{color:var(--mist);opacity:.85;border-bottom:1px solid transparent;transition:opacity .2s,border-color .2s}
.foot-links a:hover,.foot-links a[aria-current="page"]{opacity:1;border-color:var(--jade);color:var(--paper)}
.nav-links a[aria-current="page"]{opacity:1;color:var(--paper)}
"""


def nav(current: str, on_landing: bool) -> str:
    home = '#top' if on_landing else '/'
    links = (
        ['<a href="#see">See it work</a>', '<a href="#elements">The 5 Elements</a>',
         '<a href="#decides">How it decides</a>', '<a href="#privacy">Your data</a>',
         '<a href="#science">The science</a>']
        if on_landing else ['<a href="/">Home</a>']
    )
    links.append(f'<a href="/pricing"{" aria-current=\"page\"" if current == "pricing" else ""}>Pricing</a>')
    return f"""<nav>
  <div class="wrap nav-in">
    <a class="brand" href="{home}" aria-label="PAL — doctor-anchored care">
      <svg class="emb" viewBox="0 0 1000 371.1"><use href="#pal-art"/></svg>
      <span class="bt"><span class="bn">PAL</span><span class="bs">doctor-anchored care</span></span>
    </a>
    <div class="nav-links" id="navLinks">
      {chr(10).join('      ' + l for l in links).strip()}
    </div>
    <div class="nav-right">
      <a class="nav-cta" href="/login">Log in <span style="opacity:.6">→</span></a>
      <button class="nav-toggle" id="navToggle" aria-label="Menu"><svg><use href="#i-menu"/></svg></button>
    </div>
  </div>
</nav>"""


def foot_links(current: str) -> str:
    items = [('pricing', '/pricing', 'Pricing'), ('terms', '/terms', 'Terms &amp; Conditions'),
             ('privacy', '/privacy', 'Privacy Policy'), ('login', '/login', 'Log in')]
    return '<nav class="foot-links" aria-label="Legal and account">' + ''.join(
        f'<a href="{h}"{" aria-current=\"page\"" if k == current else ""}>{t}</a>' for k, h, t in items) + '</nav>'


FOOTER_DISC = section(r'<p class="disc">.*?</p>', landing)


def footer(current: str) -> str:
    return f"""<footer>
  <div class="wrap foot-in">
    <span class="foot-brand"><svg class="emb" viewBox="0 0 1000 371.1" aria-hidden="true"><use href="#pal-art"/></svg> PAL — doctor-anchored care</span>
    <span>© 2026 LocumPro Health Private Limited</span>
    <span>patient-first · doctor-guided · consent-gated</span>
  </div>
  {foot_links(current)}
  <p class="disc">PAL provides health information and guidance and is not a substitute for professional medical advice, diagnosis, or treatment. In an emergency, contact local emergency services.</p>
</footer>"""


NAV_SCRIPT = """<script>
const nt = document.getElementById('navToggle'), nl = document.getElementById('navLinks');
nt.addEventListener('click', ()=>nl.classList.toggle('open'));
nl.addEventListener('click', e=>{ if(e.target.tagName==='A') nl.classList.remove('open'); });
</script>"""


def page(title: str, description: str, current: str, body: str, css: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{title}</title>
<meta name="description" content="{html.escape(description)}" />
<meta name="theme-color" content="#13343b" />
{FAVICON}
{FONT_LINKS}
{STYLE.replace('</style>', EXTRA_CSS + css + '</style>')}
</head>
<body>
{EMBLEM_DEFS}
{ICON_DEFS}
{nav(current, False)}
{body}
{footer(current)}
{NAV_SCRIPT}
</body>
</html>
"""


ROSETTE = '<svg class="med" viewBox="366 40 266 290" aria-hidden="true"><use href="#pal-art"/></svg>'

HERO_CSS = """
.sub-hero{position:relative;overflow:hidden;padding:76px 0 56px;border-bottom:1px solid var(--line-dark)}
.sub-hero .lotus-wm{top:-30px;right:-260px;width:820px;opacity:.07;color:var(--jade)}
.sub-hero h1{font-family:var(--serif);font-weight:300;font-size:clamp(2.3rem,4.4vw,3.5rem);line-height:1.05;
  letter-spacing:-.02em;margin-bottom:16px;max-width:20ch}
.sub-hero h1 em{font-style:italic;color:var(--jade)}
.sub-hero .lead{font-size:1.08rem}
.meta-line{font-family:var(--mono);font-size:.78rem;letter-spacing:.06em;color:var(--mist);opacity:.75;margin-top:18px}
"""


def hero(eyebrow: str, h1: str, lead: str, meta: str = '') -> str:
    return f"""<header class="sub-hero">
  <svg class="lotus-wm emb" viewBox="0 0 1000 371.1" aria-hidden="true"><use href="#pal-art"/></svg>
  <div class="wrap">
    <div class="eyebrow">{ROSETTE} {eyebrow}</div>
    <h1>{h1}</h1>
    <p class="lead">{lead}</p>
    {f'<p class="meta-line">{meta}</p>' if meta else ''}
  </div>
</header>"""


# ── Legal pages ─────────────────────────────────────────────────────────────
LEGAL_CSS = """
.legal{padding:56px 0 30px}
.legal-grid{display:grid;gap:36px;align-items:start}
@media(min-width:1000px){.legal-grid{grid-template-columns:260px minmax(0,1fr);gap:48px}}
.toc{border:1px solid var(--line-dark);border-radius:16px;padding:18px 18px 12px;background:rgba(255,255,255,.02)}
@media(min-width:1000px){.toc{position:sticky;top:96px;max-height:calc(100vh - 120px);overflow:auto}}
.toc-h{font-family:var(--mono);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--jade);margin-bottom:10px;cursor:pointer;list-style:none}
.toc-h::-webkit-details-marker{display:none}
.toc-h::after{content:' ▾'}
.toc:not([open]) .toc-h{margin-bottom:6px}
.toc:not([open]) .toc-h::after{content:' ▸'}
@media(min-width:1000px){.toc-h{pointer-events:none}.toc-h::after{content:''}}
.toc ol{list-style:none;display:flex;flex-direction:column;gap:2px}
.toc a{display:block;font-size:.88rem;color:var(--mist);opacity:.8;padding:6px 8px;border-radius:8px;line-height:1.35}
.toc a:hover{opacity:1;background:rgba(55,181,155,.1);color:var(--paper)}
@media(max-width:999px){.toc ol{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}}
.doc{background:var(--paper);color:var(--ink);border-radius:22px;padding:clamp(24px,4vw,52px);
  box-shadow:0 30px 70px -30px rgba(0,0,0,.55);font-size:1.02rem;line-height:1.72}
.doc > *:first-child{margin-top:0}
.doc h2{font-family:var(--serif);font-weight:400;font-size:clamp(1.45rem,2.4vw,1.8rem);line-height:1.2;
  letter-spacing:-.01em;margin:44px 0 14px;padding-top:18px;border-top:1px solid var(--line);scroll-margin-top:96px}
.doc h2:first-of-type{border-top:none;padding-top:0}
.doc h3{font-size:1.08rem;font-weight:700;margin:26px 0 8px;color:var(--ink);scroll-margin-top:96px}
.doc p{margin:0 0 14px}
.doc strong{font-weight:700}
.doc em{font-style:italic}
.doc a{color:var(--jade-deep);text-decoration:underline;text-underline-offset:3px}
.doc ul{margin:0 0 16px 0;padding-left:22px}
.doc li{margin:0 0 9px;padding-left:4px}
.doc li::marker{color:var(--jade-deep)}
.doc .callout{background:rgba(216,162,74,.12);border:1px solid rgba(165,115,42,.35);border-left:4px solid var(--gold);
  border-radius:12px;padding:18px 20px;margin:20px 0}
.doc .callout p:last-child{margin-bottom:0}
.doc .table-wrap{overflow-x:auto;margin:16px 0 22px;border:1px solid var(--line);border-radius:12px;background:#fff}
.doc table{border-collapse:collapse;width:100%;font-size:.97rem}
.doc th,.doc td{text-align:left;vertical-align:top;padding:12px 16px;border-bottom:1px solid var(--line)}
.doc tr:last-child td{border-bottom:none}
.doc th{background:rgba(31,125,107,.08);font-weight:700;white-space:nowrap}
.doc td:first-child{font-weight:600;white-space:nowrap}
@media(max-width:600px){.doc td:first-child,.doc th{white-space:normal}}
.doc .closing{font-size:.92rem;color:#3d4c51;border-top:1px solid var(--line);padding-top:18px;margin-top:30px}
.doc .contact{list-style:none;padding:16px 18px;background:rgba(31,125,107,.07);border-radius:12px}
.doc .contact li{margin:0 0 4px;padding:0}
.doc .contact li:first-child{font-weight:700;font-size:1.05rem;margin-bottom:6px}
.back-top{display:inline-block;margin-top:26px;font-family:var(--mono);font-size:.8rem;color:var(--jade)}
"""


def slug(t: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')


def build_legal(fragment_file: str, kind: str):
    soup = BeautifulSoup((SRC / fragment_file).read_text(encoding='utf-8'), 'html.parser')
    paras = soup.find_all('p', recursive=False)
    title = paras[0].get_text(strip=True)
    updated = paras[1].get_text(strip=True)
    paras[0].decompose()
    paras[1].decompose()

    # Unwrap <strong> inside headings; h1 → h2 (the page hero carries the h1).
    for h in soup.find_all(['h1', 'h2', 'h3']):
        text = h.get_text(' ', strip=True)
        new = soup.new_tag('h2' if h.name == 'h1' else 'h3')
        new.string = text
        new['id'] = slug(text)
        h.replace_with(new)
    # Some section headings came through as bold paragraphs ("**1. Introduction**").
    for p in soup.find_all('p', recursive=False):
        kids = [c for c in p.contents if not (isinstance(c, str) and not c.strip())]
        if len(kids) == 1 and getattr(kids[0], 'name', None) == 'strong':
            text = p.get_text(' ', strip=True)
            if re.match(r'^\d+\.\s', text):
                new = soup.new_tag('h2')
                new.string = text
                new['id'] = slug(text)
                p.replace_with(new)

    # List items whose only content is a quoted paragraph (the contact blocks) → plain items.
    for li in soup.find_all('li'):
        bq = li.find('blockquote', recursive=False)
        if bq and len([c for c in li.contents if getattr(c, 'name', None) or str(c).strip()]) == 1:
            for p in bq.find_all('p'):
                p.unwrap()
            bq.unwrap()

    # "• item" paragraphs inside blockquotes → real bullet lists.
    for bq in soup.find_all('blockquote'):
        ul = soup.new_tag('ul')
        for p in bq.find_all('p'):
            li = soup.new_tag('li')
            for c in list(p.contents):
                li.append(c)
            if li.contents and isinstance(li.contents[0], str):
                li.contents[0].replace_with(re.sub(r'^\s*•\s*', '', li.contents[0]))
            ul.append(li)
        bq.replace_with(ul)

    # Tables: one-cell boxes → callouts; empty ones removed; others wrapped for scrolling.
    for t in soup.find_all('table'):
        cells = t.find_all(['td', 'th'])
        texts = [c.get_text(strip=True) for c in cells]
        if not any(texts):
            t.decompose()
            continue
        cols = max(len(r.find_all(['td', 'th'])) for r in t.find_all('tr'))
        if cols == 1:
            box = soup.new_tag('div', attrs={'class': 'callout'})
            for c in cells:
                if not c.get_text(strip=True):
                    continue
                inner = c.find_all('p')
                if inner:
                    for p in inner:
                        box.append(p)
                else:
                    p = soup.new_tag('p')
                    for x in list(c.contents):
                        p.append(x)
                    box.append(p)
            t.replace_with(box)
        else:
            # pandoc marks every row as a header row: first row = header, the rest = body.
            rows = t.find_all('tr')
            for el in list(t.find_all(['thead', 'tbody'])):
                el.unwrap()
            thead, tbody = soup.new_tag('thead'), soup.new_tag('tbody')
            for i, r in enumerate(rows):
                r.attrs.pop('class', None)
                for c in r.find_all(['th', 'td']):
                    c.name = 'th' if i == 0 else 'td'
                    if i == 0:
                        for st in c.find_all('strong'):
                            st.unwrap()
                (thead if i == 0 else tbody).append(r.extract())
            t.append(thead)
            t.append(tbody)
            for col in t.find_all('colgroup'):
                col.decompose()
            for el in t.find_all(True):
                el.attrs.pop('style', None)
            wrap = soup.new_tag('div', attrs={'class': 'table-wrap'})
            t.wrap(wrap)

    # Contact/grievance lists: the <ul> right after the Grievance heading.
    for ul in soup.find_all('ul'):
        first = ul.find('li')
        if first and 'LocumPro Health Private Limited' == first.get_text(strip=True):
            ul['class'] = 'contact'
    # E-mail addresses → mailto links (where not already links).
    for node in soup.find_all(string=re.compile(r'inir@medmode\.org')):
        if node.parent.name == 'a':
            continue
        parts = re.split(r'(inir@medmode\.org)', node)
        frag = []
        for part in parts:
            if part == 'inir@medmode.org':
                a = soup.new_tag('a', href='mailto:inir@medmode.org')
                a.string = part
                frag.append(a)
            elif part:
                frag.append(part)
        for x in frag[::-1]:
            node.insert_after(x)
        node.extract()
    for a in soup.find_all('a'):
        a.attrs.pop('class', None)
        for s in a.find_all('span'):
            s.unwrap()

    # Cross-links between the pages (text unchanged).
    def link_first(text: str, href: str):
        for node in soup.find_all(string=re.compile(re.escape(text))):
            if node.find_parent('a') or node.find_parent(['h2', 'h3']):
                continue
            before, _, after = node.partition(text)
            a = soup.new_tag('a', href=href)
            a.string = text
            node.replace_with(before, a, after)
            return
        # the phrase may sit inside <strong>
    if kind == 'terms':
        link_first('Privacy Policy', '/privacy')
        link_first('pricing page', '/pricing')
    else:
        link_first('Terms and Conditions', '/terms')

    # Closing line ("PAL is not a medical device … All rights reserved.")
    last = soup.find_all('p', recursive=False)[-1]
    if 'not a medical device' in last.get_text():
        last['class'] = 'closing'

    toc = ''.join(f'<li><a href="#{h["id"]}">{html.escape(h.get_text())}</a></li>' for h in soup.find_all('h2'))
    is_terms = kind == 'terms'
    body = hero(
        'Legal',
        'Terms <em>&amp;</em> Conditions' if is_terms else 'Privacy <em>Policy</em>',
        'The terms that govern your use of PAL — Personal Assistant for Life.' if is_terms
        else 'How LocumPro Health collects, uses, shares and protects your personal data in PAL.',
        html.escape(updated),
    ) + f"""
<main class="legal">
  <div class="wrap legal-grid">
    <details class="toc" open><summary class="toc-h">Contents</summary><ol>{toc}</ol></details>
    <article class="doc" aria-label="{html.escape(title)}">
{soup.decode(formatter='html5').strip()}
      <a class="back-top" href="#top">↑ Back to top</a>
    </article>
  </div>
</main>
<script>if(matchMedia('(max-width:999px)').matches){{var d=document.querySelector('details.toc');if(d)d.removeAttribute('open');}}</script>"""
    body = body.replace('<header class="sub-hero">', '<header class="sub-hero" id="top">', 1)
    out = page(f'{title} — PAL', f'PAL {title}. LocumPro Health Private Limited.', kind, body, HERO_CSS + LEGAL_CSS)
    (OUT / f'{kind}.html').write_text(out, encoding='utf-8')
    return title


# ── Pricing page ────────────────────────────────────────────────────────────
PRICING_CSS = """
.pricing{padding:60px 0 40px}
.plans{display:grid;gap:22px;max-width:980px;margin:0 auto}
@media(min-width:820px){.plans{grid-template-columns:1fr 1fr}}
.plan{position:relative;background:var(--paper);color:var(--ink);border-radius:24px;padding:34px 30px 30px;
  display:flex;flex-direction:column;box-shadow:0 30px 70px -30px rgba(0,0,0,.6);border:2px solid transparent}
.plan.featured{border-color:var(--jade);box-shadow:0 30px 80px -26px rgba(55,181,155,.45)}
.plan .tag{position:absolute;top:-14px;left:30px;background:var(--gold);color:#2a1f08;font-family:var(--mono);
  font-size:.74rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:6px 12px;border-radius:20px}
.plan-head{display:flex;align-items:center;gap:12px}
.plan-head .pv{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;
  background:linear-gradient(150deg,var(--jade),var(--jade-deep));color:#08282a;flex:none}
.plan-head .pv .med{width:29px;height:29px}
.plan h2{font-family:var(--serif);font-weight:400;font-size:1.9rem;line-height:1.1}
.people{display:inline-flex;align-items:center;gap:8px;margin-top:16px;font-weight:700;font-size:1.02rem;
  color:var(--jade-deep);background:rgba(31,125,107,.1);padding:8px 14px;border-radius:10px;align-self:flex-start}
.people svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2}
.price{margin:22px 0 4px;display:flex;align-items:baseline;gap:6px}
.price .amt{font-family:var(--serif);font-size:3.6rem;line-height:1;font-weight:400;letter-spacing:-.02em}
.price .cur{font-family:var(--serif);font-size:2rem;align-self:flex-start;margin-top:6px}
.price .per{font-size:1.05rem;color:#3d4c51}
.tax{font-size:.95rem;color:#3d4c51}
.plan .btn{justify-content:center;margin-top:24px}
.plan .btn-g{border-color:rgba(13,31,36,.25);color:var(--ink)}
.plan .btn-g:hover{border-color:var(--jade-deep);background:rgba(31,125,107,.07)}
.inc{font-family:var(--mono);font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:var(--jade-deep);
  margin:26px 0 12px;padding-top:20px;border-top:1px solid var(--line)}
.feats{list-style:none;display:flex;flex-direction:column;gap:13px}
.feats li{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:start}
.feats .ck{width:22px;height:22px;border-radius:50%;background:rgba(31,125,107,.14);display:grid;place-items:center;margin-top:2px}
.feats .ck svg{width:13px;height:13px;fill:none;stroke:var(--jade-deep);stroke-width:3}
.feats b{display:block;font-weight:700;font-size:1rem;line-height:1.35}
.feats span{display:block;font-size:.95rem;line-height:1.5;color:#3d4c51}
.feats li.who b{color:var(--jade-deep)}
.price-notes{max-width:980px;margin:36px auto 0;display:grid;gap:14px;color:var(--mist)}
@media(min-width:820px){.price-notes{grid-template-columns:repeat(3,1fr)}}
.price-notes div{border:1px solid var(--line-dark);border-radius:14px;padding:16px 18px;background:rgba(255,255,255,.02);font-size:.95rem;line-height:1.55}
.price-notes b{display:block;color:var(--paper);margin-bottom:4px}
.price-notes a{color:var(--jade);text-decoration:underline;text-underline-offset:3px}
"""

CHECK = '<span class="ck"><svg viewBox="0 0 24 24"><use href="#i-check"/></svg></span>'
PEOPLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>'


def build_pricing():
    cards = []
    for p in PLANS:
        featured = p['name'] == 'Family'
        who = ('Everything below for you' if not featured
               else 'Everything below for each of up to 3 people in one family group')
        feats = f'<li class="who">{CHECK}<div><b>{p["people"]}</b><span>{who}</span></div></li>' + ''.join(
            f'<li>{CHECK}<div><b>{html.escape(t)}</b><span>{html.escape(d)}</span></div></li>' for t, d in FEATURES)
        cards.append(f"""
    <section class="plan{' featured' if featured else ''}" aria-labelledby="plan-{p['name'].lower()}">
      {f'<span class="tag">{p["tag"]}</span>' if p['tag'] else ''}
      <div class="plan-head"><span class="pv">{ROSETTE}</span><h2 id="plan-{p['name'].lower()}">{p['name']}</h2></div>
      <span class="people">{PEOPLE_ICON}{p['people']}</span>
      <div class="price" aria-label="Rupees {p['price']} per {PRICE_PERIOD}, inclusive of all taxes">
        <span class="cur">₹</span><span class="amt">{p['price']}</span><span class="per">/ {PRICE_PERIOD}</span>
      </div>
      <div class="tax">Inclusive of all taxes</div>
      <a class="btn {'btn-p' if featured else 'btn-g'}" href="/signup">Choose {p['name']} <span>→</span></a>
      <div class="inc">What’s included</div>
      <ul class="feats">{feats}</ul>
    </section>""")
    body = hero(
        'Pricing',
        'One price. <em>Everything</em> included.',
        'Every PAL feature comes with both plans. The only difference is how many people are covered.',
        'Prices in Indian rupees · inclusive of all taxes',
    ) + f"""
<main class="pricing">
  <div class="wrap">
    <div class="plans">{''.join(cards)}
    </div>
    <div class="price-notes">
      <div><b>Inclusive of all taxes</b>The price you see is the price you pay — no extra GST at checkout.</div>
      <div><b>Cancel any time</b>Cancelling stops the next renewal. See our <a href="/terms#10-cancellation-and-refunds">Terms &amp; Conditions</a>.</div>
      <div><b>Your data stays yours</b>Never sold, never used for ads. Read our <a href="/privacy">Privacy Policy</a>.</div>
    </div>
  </div>
</main>"""
    (OUT / 'pricing.html').write_text(
        page('Pricing — PAL', 'PAL plans: Individual ₹41 and Family ₹99 (up to 3 people). Inclusive of all taxes.', 'pricing', body, HERO_CSS + PRICING_CSS),
        encoding='utf-8')


# ── Landing page ────────────────────────────────────────────────────────────
def build_landing():
    s = landing
    # "Open PAL" buttons → the app's login page (same tab).
    s = re.sub(r'<a class="nav-cta" href="https://pal-agent\.medmode\.org/" target="_blank" rel="noopener noreferrer">Open PAL <span style="opacity:\.6">↗</span></a>',
               '<a class="nav-cta" href="/login">Open PAL <span style="opacity:.6">→</span></a>', s)
    s = s.replace('<a class="btn btn-p" href="https://pal-agent.medmode.org/" target="_blank" rel="noopener noreferrer">Open PAL <span>↗</span></a>',
                  '<a class="btn btn-p" href="/login">Open PAL <span>→</span></a>')
    # Nav: add Pricing.
    s = s.replace('      <a href="#science">The science</a>\n    </div>',
                  '      <a href="#science">The science</a>\n      <a href="/pricing">Pricing</a>\n    </div>', 1)
    # Footer: replace the external link with the site's legal/account links.
    s = s.replace('    <span><a href="https://pal-agent.medmode.org/" target="_blank" rel="noopener noreferrer">pal-agent.medmode.org ↗</a></span>\n',
                  '    <span>© 2026 LocumPro Health Private Limited</span>\n', 1)
    s = s.replace('  <p class="disc">', '  ' + foot_links('') + '\n  <p class="disc">', 1)
    s = s.replace(STYLE, STYLE.replace('</style>', EXTRA_CSS + '</style>'), 1)
    s = s.replace(section(r'<link rel="preconnect" href="https://fonts.googleapis.com">.*?<style>', landing)[:-7], FONT_LINKS + '\n', 1)
    s = s.replace('</head>', SESSION_SCRIPT + '\n</head>', 1)
    s = s.replace('<p class="note">Live prototype · opens in a new tab</p>', '<p class="note">Log in, or create your account in a minute</p>')
    # Browser mock-up on the landing page: show this site's address.
    s = s.replace('<span class="br-url">pal-agent.medmode.org</span>', '<span class="br-url">palcare.life</span>')
    assert 'pal-agent.medmode.org' not in s, 'external app link left on the landing page'
    (OUT / 'landing.html').write_text(s, encoding='utf-8')


if __name__ == '__main__':
    build_landing()
    build_pricing()
    t1 = build_legal('terms-fragment.html', 'terms')
    t2 = build_legal('privacy-fragment.html', 'privacy')
    for f in ('landing', 'pricing', 'terms', 'privacy'):
        print(f'public/{f}.html', (OUT / f'{f}.html').stat().st_size, 'bytes')
