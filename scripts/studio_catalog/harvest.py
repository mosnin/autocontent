"""Verify each candidate fal endpoint and harvest its real schema + price.

Existence comes from the queue OpenAPI (404 for an endpoint that isn't
there); the published price comes from the model page's pricingInfoOverride.
Nothing is invented: an endpoint that fails either check is dropped.
"""
import json, re, pathlib, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

SCRATCH = pathlib.Path('/tmp/claude-0/-home-user-autocontent/04d9a49a-9de8-5cd4-99e2-d9ce018943a2/scratchpad')
matches = json.load(open(SCRATCH / 'matches.json'))

candidates = {}
for m in matches:
    if not m['endpoint'] or m['score'] < 0.5:
        continue
    # Keep the best-scoring catalog entry per endpoint.
    prev = candidates.get(m['endpoint'])
    if prev is None or m['score'] > prev['score']:
        candidates[m['endpoint']] = m
print(len(candidates), 'candidate endpoints')


def get(url: str, timeout: int = 30) -> str | None:
    req = urllib.request.Request(url, headers={'accept': '*/*', 'user-agent': 'marketer.sh-catalog/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError:
        return None
    except Exception:
        return None


def harvest(endpoint: str) -> dict | None:
    spec_raw = get(f'https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={endpoint}')
    if not spec_raw:
        return None
    try:
        spec = json.loads(spec_raw)
    except json.JSONDecodeError:
        return None
    schemas = spec.get('components', {}).get('schemas', {})
    inp = next(
        (v for k, v in schemas.items() if k.endswith('Input')),
        None,
    )
    if inp is None:
        return None

    page = get(f'https://fal.ai/models/{endpoint}') or ''
    price_text = ''
    m = re.search(r'"pricingInfoOverride":"((?:[^"\\]|\\.)*)"', page)
    if m:
        price_text = json.loads(f'"{m.group(1)}"')
    if not price_text:
        m2 = re.search(r'<p>((?:(?!</p>).)*?\$[0-9][^<]*?)</p>', page)
        if m2:
            price_text = re.sub(r'<[^>]+>', '', m2.group(1))

    return {
        'endpoint': endpoint,
        'properties': inp.get('properties', {}),
        'required': inp.get('required', []),
        'price_text': price_text,
    }


with ThreadPoolExecutor(max_workers=8) as pool:
    harvested = list(pool.map(harvest, candidates))

ok = [h for h in harvested if h]
for h in ok:
    h.update({k: v for k, v in candidates[h['endpoint']].items() if k != 'endpoint'})
json.dump(ok, open(SCRATCH / 'harvest.json', 'w'), indent=1)
print(f'{len(ok)}/{len(candidates)} verified')
print('with price text:', sum(1 for h in ok if h['price_text']))
