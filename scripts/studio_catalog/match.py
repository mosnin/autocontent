"""Match our UI catalog entries to real fal endpoints, conservatively."""
import json, re, sys, pathlib

CAT = pathlib.Path('/home/user/autocontent/web/lib/studio/catalog')
fal = json.load(open('/tmp/claude-0/-home-user-autocontent/04d9a49a-9de8-5cd4-99e2-d9ce018943a2/scratchpad/fal-models.json'))

DIRECTION = {
    't2i': {'text-to-image'},
    't2v': {'text-to-video'},
    'i2i': {'image-to-image'},
    'i2v': {'image-to-video'},
    'v2v': {'video-to-video'},
    'lipsync': {'audio-to-video', 'video-to-video', 'image-to-video'},
    'recast': {'video-to-video', 'image-to-video'},
    'audio': {'text-to-audio', 'text-to-speech', 'audio-to-audio'},
}

STOP = {
    'ai', 'fal', 'video', 'image', 'text', 'to', 'the', 'model', 'v', 'edit',
    'generate', 'generation', 'preview', 'api', 'lite', 'gen',
}


def norm(s: str) -> list[str]:
    s = s.lower().replace('.', '').replace('_', '-')
    parts = re.split(r'[^a-z0-9]+', s)
    return [p for p in parts if p and p not in STOP]


def catalog_entries(fname: str, kind: str):
    text = (CAT / fname).read_text()
    out = []
    for m in re.finditer(r'"id": "([^"]+)",\s*\n\s*"name": "([^"]+)"', text):
        out.append({'id': m.group(1), 'name': m.group(2), 'kind': kind})
    return out


FILES = [
    ('t2i-models.ts', 't2i'), ('t2v-models.ts', 't2v'), ('i2i-models.ts', 'i2i'),
    ('i2v-models.ts', 'i2v'), ('v2v-models.ts', 'v2v'),
    ('lipsync-models.ts', 'lipsync'), ('recast-models.ts', 'recast'),
    ('audio-models.ts', 'audio'),
]

fal_index = []
for item in fal:
    fal_index.append({
        'endpoint': item['id'],
        'title': item.get('title') or '',
        'category': item.get('category') or '',
        'tokens': set(norm(item['id'])) | set(norm(item.get('title') or '')),
    })

results = []
for fname, kind in FILES:
    entries = catalog_entries(fname, kind)
    if not entries:
        print('NO ENTRIES', fname, file=sys.stderr)
    cats = DIRECTION[kind]
    for e in entries:
        tokens = set(norm(e['id'])) | set(norm(e['name']))
        tokens -= {'i2v', 't2v', 'i2i', 't2i', 'v2v', 'lipsync'}
        best, best_score = None, 0.0
        for f in fal_index:
            if f['category'] not in cats:
                continue
            inter = tokens & f['tokens']
            if not inter:
                continue
            score = len(inter) / len(tokens | f['tokens'])
            if score > best_score:
                best, best_score = f, score
        results.append({
            'kind': kind, 'catalog_id': e['id'], 'name': e['name'],
            'endpoint': best['endpoint'] if best else None,
            'fal_title': best['title'] if best else None,
            'score': round(best_score, 3),
        })

json.dump(results, open('/tmp/claude-0/-home-user-autocontent/04d9a49a-9de8-5cd4-99e2-d9ce018943a2/scratchpad/matches.json', 'w'), indent=1)
strong = [r for r in results if r['score'] >= 0.6]
mid = [r for r in results if 0.4 <= r['score'] < 0.6]
print(f'{len(results)} catalog entries, {len(strong)} strong (>=0.6), {len(mid)} mid (0.4-0.6)')
for r in strong[:25]:
    print(f"  {r['score']:.2f} {r['catalog_id']:42s} -> {r['endpoint']}")
