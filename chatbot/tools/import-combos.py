#!/usr/bin/env python3
"""
Mine real combined-fault jobs out of the RepairDesk line history and fold
them into the knowledge base, so multi-fault quotes come from what the shop
actually charged for the pair - not a rule of thumb or a plain sum.

Run after dropping a fresh export at data/repair-lines.xlsx ("Repair Lines"
sheet), then rebuild the payloads:

    python3 tools/import-combos.py
    bash build.sh && node shopify/build-payload.js && node shopify/build-widget.js
    (cd app && node --test)

Where the combos come from:
  - Mostly single invoice lines whose description names two or more faults
    with one combined price ("Apple 14 Pro Max - Back Glass, Screen" $380).
  - Plus multi-line invoices where separate mapped fault lines share the
    same invoice on the same device.

What it writes:
  - screen+back glass pairs  -> pricing.combos[model]   (the package path the
    combo answer already reads, and a "recent combined jobs" line on the
    rule card)
  - every other pair         -> pricing.multiCombos["<model>|a+b"]  (the
    stacked multi-fault card quotes it instead of a plain sum)

Guard-rails: iPod-placeholder and accessory lines skipped, sub-$60 lines
skipped, a pair needs 3+ real jobs, and the band is the middle 60% of what
was charged so one weird ticket can't stretch it. Only devices already in
the price table are written - a combo for a phone the bot can't even name
would never be reachable.
"""
import collections
import json
import os
import re
import statistics
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB_PATH = os.path.join(ROOT, 'knowledge-base.json')
XLSX_PATH = os.path.join(ROOT, 'data', 'repair-lines.xlsx')

DESC_PATS = {
    'screen': re.compile(r'\b(screen|lcd|scree|display|front glass)\b', re.I),
    'back_glass': re.compile(r'\b(back ?glass|back ?cover|housing|rear glass|back glas)\b', re.I),
    'battery': re.compile(r'\b(batt?ery|batt)\b', re.I),
    'charging': re.compile(r'\b(charging|charge ?port|c\/port|cport)\b', re.I),
    'camera': re.compile(r'\b(camera|cam\b|lens)\b', re.I),
    'speaker': re.compile(r'\b(speaker|earpiece|mic\b|microphone)\b', re.I),
}
CATMAP = {
    'Screen': 'screen', 'Battery': 'battery', 'Charging port': 'charging',
    'Back glass / housing': 'back_glass', 'Rear camera': 'camera',
    'Speaker / earpiece': 'speaker',
}
JUNK = re.compile(r'ipod|cable|chargeup|headphone|akg|\bcase\b|protector|power bank|surface', re.I)
MIN_PRICE = 60
MIN_JOBS = 3


def norm_name(dev):
    d = re.sub(r'\b(64|128|256|512)\s*GB\b', '', str(dev), flags=re.I)
    d = re.sub(r'\s+', ' ', d).strip()
    if d.lower().startswith('samsung '):
        d = 'Galaxy ' + d[8:]
    return d


def match_key(model):
    k = model.lower()
    k = re.sub(r'\bgoogle\b', '', k)
    k = re.sub(r'\bpixel\s*', '', k)
    return re.sub(r'\s+', ' ', k).strip()


def round5(x, mode='near'):
    import math
    if mode == 'down': return int(math.floor(x / 5.0) * 5)
    if mode == 'up': return int(math.ceil(x / 5.0) * 5)
    return int(round(x / 5.0) * 5)


def main():
    kb = json.load(open(KB_PATH))
    kb_models = {}  # match_key -> canonical model name from the price table
    for row in kb['pricing']['repairs']:
        kb_models.setdefault(match_key(row['model']), row['model'])

    ws = openpyxl.load_workbook(XLSX_PATH, read_only=True)['Repair Lines']
    pair_jobs = collections.defaultdict(list)   # (model, keys tuple) -> [(date, total)]
    invoices = collections.defaultdict(lambda: collections.defaultdict(list))

    for date, ticket, invoice, dev, cat, q, price, qty, desc in ws.iter_rows(min_row=5, values_only=True):
        if not dev or JUNK.search(str(dev)):
            continue
        model = kb_models.get(match_key(norm_name(dev)))
        if not model:
            continue
        try:
            p = float(price) * float(qty or 1)
        except (TypeError, ValueError):
            continue
        if p < MIN_PRICE:
            continue
        d = str(date)[:10]
        # one line, several faults, one combined price
        keys = tuple(sorted(k for k, rx in DESC_PATS.items() if rx.search(str(desc or ''))))
        if len(keys) >= 2:
            pair_jobs[(model, keys)].append((d, p))
        elif invoice and cat in CATMAP:
            invoices[(str(invoice), model)][CATMAP[cat]].append((d, p))

    # several mapped lines on the one invoice for the one device
    for (_, model), kmap in invoices.items():
        if len(kmap) >= 2:
            keys = tuple(sorted(kmap))
            total = sum(p for v in kmap.values() for _, p in v)
            date = max(d for v in kmap.values() for d, _ in v)
            pair_jobs[(model, keys)].append((date, total))

    combos, multi = {}, {}
    for (model, keys), jobs in pair_jobs.items():
        if len(jobs) < MIN_JOBS:
            continue
        totals = sorted(t for _, t in jobs)
        # the middle 60% of what was actually charged
        lo_i, hi_i = int(len(totals) * 0.2), max(int(len(totals) * 0.8) - 1, 0)
        entry = {
            'low': round5(totals[lo_i], 'down'),
            'high': round5(totals[hi_i], 'up'),
            'typical': round5(statistics.median(totals)),
            'sampleSize': len(jobs),
            'since': min(d for d, _ in jobs)[:4],
        }
        entry['typical'] = max(entry['low'], min(entry['high'], entry['typical']))
        if keys == ('back_glass', 'screen'):
            combos[model] = entry
        else:
            multi[model + '|' + '+'.join(keys)] = entry

    kb['pricing']['combos'] = dict(sorted(combos.items()))
    kb['pricing']['multiCombos'] = dict(sorted(multi.items()))
    json.dump(kb, open(KB_PATH, 'w'), indent=2, ensure_ascii=False)
    print(f'screen+back glass packages: {len(combos)} models | '
          f'other fault pairs: {len(multi)} | '
          f"from {sum(len(v) for v in pair_jobs.values())} combined jobs")


if __name__ == '__main__':
    sys.exit(main())
