"""Generate the fal model registry from the verified harvest.

Every entry here was proven to exist (its queue OpenAPI resolved) and
carries fal's own published billing unit and price. Anything whose billing
unit we cannot price honestly is dropped rather than guessed at.
"""
import json, pathlib, re

SCRATCH = pathlib.Path(
    '/tmp/claude-0/-home-user-autocontent/04d9a49a-9de8-5cd4-99e2-d9ce018943a2/scratchpad'
)
harvest = json.load(open(SCRATCH / 'harvest.json'))

# fal category -> (our model class, output kind)
CATEGORY = {
    'text-to-image': ('image', 'image'),
    'image-to-image': ('image', 'image'),
    'text-to-video': ('video', 'video'),
    'image-to-video': ('video', 'video'),
    'video-to-video': ('video2video', 'video'),
    'audio-to-video': ('lipsync', 'video'),
    'text-to-audio': ('audio', 'audio'),
    'text-to-speech': ('audio', 'audio'),
}

# fal billing unit -> (our unit, price multiplier applied to fal's price).
#
# 'videos' is deliberately absent. fal's flat per-video `price` is a BASE:
# the published text prices those endpoints by resolution and length on top
# of it ("$0.15 for 360p ... for 8-second videos, costs double"). Pricing
# them off the base alone would under-estimate, and an under-estimate lets a
# generation start that the cap should have refused. They are left out until
# there is a rate card we can compute from.
UNITS = {
    'seconds': ('second', 1),
    'images': ('image', 1),
    'megapixels': ('megapixel', 1),
    'processed megapixels': ('megapixel', 1),
    '1000 characters': ('character', 0.001),
}

# our payload key -> the field this endpoint actually reads it as
FIELD_ALIASES = {
    'images_list': ('image_urls', 'images'),
    'last_image': ('end_image_url', 'tail_image_url'),
    'text': ('text', 'prompt'),
    'audio_url': ('audio_url',),
}

# Mirrors the server's per-kind whitelist: a param this class does not
# accept is never mapped, so `text` can only ever mean a speech script.
KIND_PARAMS = {
    'image': ('prompt', 'negative_prompt', 'image_size', 'aspect_ratio',
              'num_images', 'seed', 'image_url', 'images_list', 'strength'),
    'video': ('prompt', 'negative_prompt', 'image_url', 'images_list',
              'last_image', 'aspect_ratio', 'resolution', 'seed'),
    'audio': ('text', 'voice'),
    'lipsync': ('video_url', 'audio_url', 'image_url', 'prompt', 'resolution', 'seed'),
    'video2video': ('video_url', 'image_url', 'prompt', 'aspect_ratio',
                    'resolution', 'seed', 'scale'),
    'recast': ('video_url', 'image_url', 'prompt', 'aspect_ratio', 'resolution',
               'seed', 'character_orientation'),
}

# The written input each class needs: an entry that offers none of these has
# nothing for the prompt box to drive, so it is dropped rather than shipped
# as a model you cannot actually prompt.
WRITTEN_INPUT = {
    'image': ('prompt',), 'video': ('prompt',), 'audio': ('text',),
    'lipsync': (), 'video2video': (), 'recast': (),
}

fal_models = {m['id']: m for m in json.load(open(SCRATCH / 'fal-models.json'))}


def endpoint_field(props: dict, param: str) -> str | None:
    """The field name this endpoint reads our param as, if it takes it."""
    for candidate in FIELD_ALIASES.get(param, (param,)):
        if candidate in props:
            return candidate
    return None


def durations(props: dict) -> tuple[list[int], str, int | None]:
    field = props.get('duration')
    if not isinstance(field, dict):
        return [], '', None
    values = field.get('enum') or []
    seconds, suffix = [], ''
    for value in values:
        text = str(value)
        match = re.fullmatch(r'(\d+)(s?)', text)
        if not match:
            return [], '', None
        seconds.append(int(match.group(1)))
        if match.group(2):
            suffix = 's'
    default = field.get('default')
    default_sec = None
    if default is not None:
        m = re.fullmatch(r'(\d+)s?', str(default))
        if m:
            default_sec = int(m.group(1))
    return sorted(set(seconds)), suffix, default_sec


def trim(schema: dict) -> dict:
    """Keep only what a control needs — fal schemas carry long descriptions
    and examples we would only be shipping to the browser unread."""
    out = {}
    for key in ('type', 'title', 'enum', 'default', 'minimum', 'maximum'):
        if key in schema:
            out[key] = schema[key]
    if isinstance(schema.get('anyOf'), list):
        for option in schema['anyOf']:
            if isinstance(option, dict) and option.get('enum'):
                out['enum'] = option['enum']
                out.setdefault('type', option.get('type', 'string'))
                break
    return out


entries, skipped = [], {}
for item in harvest:
    endpoint = item['endpoint']
    meta = fal_models.get(endpoint)
    billing = item.get('billing') or {}
    if not meta:
        skipped[endpoint] = 'not in the fal model list'
        continue
    category = CATEGORY.get(meta.get('category'))
    if not category:
        skipped[endpoint] = f"category {meta.get('category')}"
        continue
    unit_info = UNITS.get(billing.get('billing_unit'))
    if not unit_info or not billing.get('price'):
        skipped[endpoint] = f"billing unit {billing.get('billing_unit')!r}"
        continue

    kind, output_kind = category
    unit, multiplier = unit_info
    price = round(float(billing['price']) * multiplier, 8)

    props = item['properties']
    field_map = {}
    schema = {}
    for param in KIND_PARAMS[kind]:
        field = endpoint_field(props, param)
        if field is None:
            continue
        if field != param:
            field_map[param] = field
        schema[param] = trim(props[field])

    required = [
        p for p in KIND_PARAMS[kind]
        if (f := endpoint_field(props, p)) and f in item.get('required', [])
    ]

    needed = WRITTEN_INPUT[kind]
    if needed and not any(p in schema for p in needed):
        skipped[endpoint] = 'no promptable input'
        continue

    allowed, suffix, default_sec = durations(props)
    entry = {
        'id': endpoint,
        'name': meta.get('title') or endpoint,
        'kind': kind,
        'endpoint': endpoint,
        'unit': unit,
        'usd_per_unit': str(price),
        'output_kind': output_kind,
        # Only a confident name match links to the ported catalog entry; a
        # loose one would point the UI at the wrong model's schema.
        'catalog_id': item.get('catalog_id') if item.get('score', 0) >= 0.6 else '',
        'required_params': required,
        'input_schema': schema,
    }
    if field_map:
        entry['field_map'] = field_map
    if allowed:
        entry['allowed_durations'] = allowed
        entry['duration_suffix'] = suffix
        entry['max_duration_sec'] = max(allowed)
    if default_sec:
        entry['default_duration_sec'] = default_sec
    entries.append(entry)

# fal reuses one title across an endpoint family (text-to-image and its
# /edit sibling are both "Nano Banana"). A picker with two identical rows is
# unusable, so repeated titles take the endpoint's category as a suffix.
DIRECTION = {
    'text-to-image': 'text to image', 'image-to-image': 'image to image',
    'text-to-video': 'text to video', 'image-to-video': 'image to video',
    'video-to-video': 'video to video', 'audio-to-video': 'lip sync',
    'text-to-audio': 'audio', 'text-to-speech': 'speech',
}
counts = {}
for e in entries:
    counts[e['name']] = counts.get(e['name'], 0) + 1
for e in entries:
    if counts[e['name']] > 1:
        category = fal_models[e['id']].get('category')
        e['name'] = f"{e['name']} ({DIRECTION.get(category, category)})"
# Still ambiguous (same title, same category, different endpoint): fall back
# to the endpoint's own tail, which is unique by construction.
counts = {}
for e in entries:
    counts[e['name']] = counts.get(e['name'], 0) + 1
for e in entries:
    if counts[e['name']] > 1:
        e['name'] = f"{e['name']} · {e['id'].split('/', 1)[1]}"

entries.sort(key=lambda e: (e['kind'], e['id']))
json.dump(entries, open(SCRATCH / 'registry.json', 'w'), indent=1)

by_kind = {}
for e in entries:
    by_kind[e['kind']] = by_kind.get(e['kind'], 0) + 1
print(f'{len(entries)} entries: {sorted(by_kind.items())}')
reasons = {}
for reason in skipped.values():
    reasons[reason] = reasons.get(reason, 0) + 1
print(f'{len(skipped)} skipped: {sorted(reasons.items(), key=lambda kv: -kv[1])}')


# ── Emit the Python module the service imports ───────────────────────────────
HEADER = """\
# Generated — do not edit by hand. Regenerate with web/scripts/... (see
# docs); every entry below was verified against fal at generation time.
#
# marketer.sh Studio: the fal model registry.
#
# Each entry is a fal endpoint we confirmed exists (its queue OpenAPI
# resolved), carrying fal's own published billing unit and price, the
# subset of its input schema our payload whitelist allows, and the field
# names that endpoint actually reads those params as. Endpoints whose
# billing unit we cannot price honestly (credits, tokens, opaque "units")
# are absent rather than guessed at.
#
# Prices drift. Correct one without a deploy through
# MARKETER_FAL_PRICE_OVERRIDES rather than editing this file.

FAL_REGISTRY: list[dict] = """
out = SCRATCH / 'studio_fal_registry.py'
import pprint
body = pprint.pformat(entries, width=88, sort_dicts=False)
out.write_text(HEADER + body + "\n")
print('wrote', out, len(out.read_text()) // 1024, 'KB')
