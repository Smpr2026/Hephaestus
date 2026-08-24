#!/usr/bin/env bash
# Rebuilds demo.html from knowledge-base.json + app/src/brain.js.
# Run after editing either one, so the offline demo and the local server
# always answer identically.
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
import json, re
kb = json.load(open('knowledge-base.json'))          # validates the JSON as a side effect
brain = open('app/src/brain.js').read()
html = open('demo.html').read()

def swap(html, start, end, body):  # noqa
    """Replace the marked block, insisting the markers appear exactly once."""
    new, n = re.subn(re.escape(start) + r'.*?' + re.escape(end), lambda m: start + body + end, html, flags=re.S)
    if n != 1:
        raise SystemExit('marker %s not found exactly once' % start)
    return new

html = swap(html, '<!--KB:START-->', '<!--KB:END-->',
            '\n<script type="application/json" id="smpr-kb">%s</script>\n'
            % json.dumps(kb, ensure_ascii=False, separators=(',', ':')))
html = swap(html, '<!--BRAIN:START-->', '<!--BRAIN:END-->',
            '\n<script>\n%s\n</script>\n' % brain)
open('demo.html','w').write(html)

# artifact.html is the same engine in a page shaped for publishing to claude.ai
art = open('artifact.html').read()
art = swap(art, '<!--KB:START-->', '<!--KB:END-->',
           '\n<script type="application/json" id="smpr-kb">%s</script>\n'
           % json.dumps(kb, ensure_ascii=False, separators=(',', ':')))
art = swap(art, '<!--BRAIN:START-->', '<!--BRAIN:END-->',
           '\n<script>\n%s\n</script>\n' % brain)
open('artifact.html','w').write(art)

print('Built demo.html + artifact.html — %d answers, %d price rows, %d test questions'
      % (len(kb['intents']), len(kb['pricing']['repairs']), len(kb['testBank'])))
PY
