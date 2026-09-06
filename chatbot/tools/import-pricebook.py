#!/usr/bin/env python3
"""
Fold the RepairDesk price book into the knowledge base.

Run this every time a fresh price book lands (export from FixDesk/RepairDesk,
regenerate data/pricebook.json), then rebuild the payloads:

    python3 tools/import-pricebook.py
    bash build.sh && node shopify/build-payload.js && node shopify/build-widget.js
    (cd app && node --test)

What it does, and deliberately does not do:
  - Uses the LAST-12-MONTHS median as the going rate where there are enough
    recent jobs, falling back to the era median. The low-high band is the
    range of medians across eras and screen qualities, never raw outliers.
  - Never touches a row marked "verified": true - those are George's word.
  - Never invents: a device+fault pair is only added with 4+ real jobs and
    a charge in the last two years.
  - Skips the iPod 6th Gen placeholder, accessory lines, and part-only
    oddities the price book itself flags as noise.
"""
import json, math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB_PATH = os.path.join(ROOT, 'knowledge-base.json')
BOOK_PATH = os.path.join(ROOT, 'data', 'pricebook.json')

CATMAP = {
    'Screen': 'screen',
    'Battery': 'battery',
    'Charging port': 'charging',
    'Back glass / housing': 'back_glass',
    'Rear camera': 'camera',
    'Speaker / earpiece': 'speaker',
}
SKIP_DEV = re.compile(r'ipod|cable|chargeup|headphone|akg|\bcase\b|protector|power bank', re.I)
SKIP_QUAL = {'Digitizer only', ' Post Components Assembling', ' Post Save Data'}
OEM = 'Original / OEM'

def norm_name(dev):
    d = re.sub(r'\b(64|128|256|512)\s*GB\b', '', dev, flags=re.I)
    d = re.sub(r'\s+', ' ', d).strip()
    if d.lower().startswith('samsung '):
        d = 'Galaxy ' + d[8:]
    return d

def brand_of(name):
    l = name.lower()
    if l.startswith(('iphone', 'ipad', 'macbook', 'imac', 'ipod')): return 'Apple'
    if l.startswith('galaxy'): return 'Samsung'
    if l.startswith('google'): return 'Google'
    if l.startswith('huawei'): return 'Huawei'
    if l.startswith('oppo'): return 'Oppo'
    return 'Other'

def match_key(model):
    k = model.lower()
    k = re.sub(r'\bgoogle\b', '', k)
    k = re.sub(r'\bpixel\s*', '', k)
    k = re.sub(r'\s+', ' ', k).strip()
    return k

def recent(r):
    if (r.get('rn') or 0) >= 3 and r.get('rm') is not None: return r['rm']
    if r.get('e3') is not None: return r['e3']
    return r['med']

def round5(x, mode='near'):
    if mode == 'down': return int(math.floor(x / 5.0) * 5)
    if mode == 'up': return int(math.ceil(x / 5.0) * 5)
    return int(round(x / 5.0) * 5)

def main():
    kb = json.load(open(KB_PATH))
    book = json.load(open(BOOK_PATH))

    groups = {}
    for r in book['det']:
        cat = r.get('cat'); dev = r.get('dev', ''); q = r.get('q', '')
        if cat not in CATMAP or SKIP_DEV.search(dev) or q in SKIP_QUAL:
            continue
        name = norm_name(dev)
        groups.setdefault((name, CATMAP[cat]), []).append(r)

    idx = {}
    for row in kb['pricing']['repairs']:
        idx[(match_key(row['model']), row['repair'])] = row

    updated, added, kept_verified = 0, 0, 0
    for (name, repair), rows in sorted(groups.items()):
        n_total = sum(r['n'] for r in rows)
        ld_max = max(r.get('ld') or '' for r in rows)
        fy_min = min(str(r.get('fy') or '2020') for r in rows)

        cands = []
        for r in rows:
            for v in (r.get('med'), r.get('rm'), r.get('e3')):
                if v is not None: cands.append(v)
        if not cands: continue
        lo, hi = round5(min(cands), 'down'), round5(max(cands), 'up')

        pick_from = [r for r in rows if r.get('q') != OEM] or rows
        best = max(pick_from, key=lambda r: ((r.get('rn') or 0), r['n']))
        typ = round5(recent(best))
        typ = max(lo, min(hi, typ))

        existing = idx.get((match_key(name), repair))
        if existing is not None:
            if existing.get('verified') is True:
                kept_verified += 1
                continue
            existing['low'], existing['high'], existing['typical'] = lo, hi, typ
            existing['sampleSize'] = n_total
            existing['source'] = 'repairdesk tickets'
            updated += 1
        elif n_total >= 4 and ld_max >= '2024-06':
            kb['pricing']['repairs'].append({
                'brand': brand_of(name), 'model': name, 'repair': repair,
                'verified': False, 'costs': {},
                'low': lo, 'high': hi, 'typical': typ,
                'sampleSize': n_total, 'since': fy_min,
                'source': 'repairdesk tickets',
            })
            added += 1

    json.dump(kb, open(KB_PATH, 'w'), indent=2, ensure_ascii=False)
    print(f'updated {updated} rows, added {added} new rows, '
          f'left {kept_verified} verified rows untouched; '
          f"table now {len(kb['pricing']['repairs'])} rows")

if __name__ == '__main__':
    sys.exit(main())
