#!/usr/bin/env bash
# Injects knowledge-base.json into demo.html between the KB markers.
# Run this after every edit to knowledge-base.json.
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
import json, re
kb = json.load(open('knowledge-base.json'))          # validates the JSON as a side effect
html = open('demo.html').read()
block = '<!--KB:START-->\n<script type="application/json" id="smpr-kb">%s</script>\n<!--KB:END-->' % json.dumps(kb, ensure_ascii=False, separators=(',', ':'))
new, n = re.subn(r'<!--KB:START-->.*?<!--KB:END-->', lambda m: block, html, flags=re.S)
if n != 1:
    raise SystemExit('KB markers not found exactly once in demo.html')
open('demo.html','w').write(new)
print('Injected %d intents, %d price rows, %d test questions into demo.html'
      % (len(kb['intents']), len(kb['pricing']['repairs']), len(kb['testBank'])))
PY
