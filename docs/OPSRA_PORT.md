# Site transcription (from the Opsra Framer export)

The Opsra template from Originkit is a **Framer static export**, not a
component library: three HTML pages, a minified Framer runtime, 104 hashed
woff2 files and 97 hashed images. There is no source to import.

Rather than redraw it, it is **transcribed**. `scripts/opsra_extract.py`
parses the export's DOM and re-emits it as JSX with the same elements, the
same attributes and the same inline styles; the 306KB stylesheet is copied
byte-for-byte with only asset URLs rewritten. Nothing in this pipeline
decides what the page looks like — that decision is already made, and the
job is to not corrupt it in transit.

## Regenerating

```bash
python3 scripts/opsra_extract.py          # writes to a scratch dir
# copy out/opsra.css and out/page-full.jsx.txt into web/components/opsra/
```

`web/components/opsra/page-full.tsx` is generated. **Do not hand-edit it** —
re-run the extractor.

## Verifying

Two harnesses, both requiring the original served alongside the port:

```bash
cd web/opsra && python3 -m http.server 8123 &   # the original export
cd web && npx next dev -p 3000 &                # the port at /opsra-port

node scripts/opsra_compare.mjs    # full-page screenshot diff, 3 viewports
node scripts/opsra_dom_diff.mjs   # per-element geometry diff
```

Both disable JavaScript on *both* sides. The export has 43 scroll-reveal
nodes driven by the Framer runtime; leaving it on compares a revealed
original against an unrevealed port and drowns the real signal.

Last measured:

| | desktop | tablet | phone |
|---|---|---|---|
| page height delta | 0 | 0 | 0 |
| pixel diff | 0.31% | 0.00% | 0.00% |

Structural: 1096/1096 named nodes present, **0 geometry mismatches >1px**,
43/43 `opacity:0` states preserved. `#main` element count differs by 2 —
the two `<style>` tags moved into the stylesheet.

The residual 0.31% on desktop is a single 188px band containing the giant
`OPSRA` wordmark, which the *port renders and the original does not*: it is
scroll-reveal transform state, not missing content.

## Things that will bite you

Four bugs cost real time here; all four are the kind that produce a page
that looks approximately right.

1. **The wrapper chain is load-bearing.** Every layout rule is scoped under
   `.framer-pnUdQ` (`.framer-pnUdQ .framer-lm07mn-container{…}`). Composing
   a page from bare `<section>`s matches *zero* layout rules and the
   sections spill sideways to 7244px. This is why the extractor emits the
   whole `#main` subtree instead of per-section components.

2. **Host CSS inherits in.** The export assumes initial values for anything
   its own reset does not set. Mounted in our app it inherited
   `globals.css`'s base line-height (`normal` → `18px`), adding 4px per card
   in Social Proof. The extractor now re-asserts those initial values on
   `#main`.

3. **JSX string attributes are not JS strings.** A backslash in
   `attr="…"` is literal, so `json.dumps` output (`\"`, `→`) corrupts
   the value silently. Anything non-ASCII or containing a quote must use
   expression form, and `ensure_ascii=False`.

4. **`<img alt>` is `alt=""`, not `alt={true}`.** The export has 179
   decorative images with intentionally empty alt. Emitting a bare
   attribute in JSX means `true` — a type error and a screen-reader
   regression.

## Not yet done

The transcription is static. These are runtime-driven in the original and
still need real React implementations:

- mobile nav menu
- FAQ accordion
- pricing monthly/annual toggle (both states are in the DOM)
- Social Proof carousel (its prev/next buttons ship `disabled`)
- scroll reveal for the 43 `opacity:0` nodes (IntersectionObserver;
  21 are the identical `translateY(50px)` pattern)

Copy is still Opsra's throughout.


## Content swap

`scripts/opsra_content.py` maps the export's copy and brand marks to ours.
Keys match the export's exact text node, entities included; the extractor
prints any entry that stops matching, so a re-pull cannot silently restore
the template's copy. It also sweeps `data-framer-name` (design-file layer
names are copies of the original sentences and sit in view-source) and
fails loudly on any surviving `Opsra`/`framer.com` reference.

Currently: **every entry matches, nothing leaks.** Brand marks are in
`web/public/brand/`; assets are served from `/site/`.

Three matching bugs worth remembering:

- `alt="opsra logo\n"` carries a literal newline where the eye reads a
  trailing space, so attribute keys are matched whitespace-insensitively.
- Several text nodes end with a space before an inline `<a>`; the matcher
  preserves trailing whitespace or the words either side join up.
- The Challenges headline is one `<span>` per character for a staggered
  reveal. It is rebuilt from `SPLIT_TEXT`, keeping entities in a single
  span — splitting `&rsquo;` across five renders the literal characters.

**Placeholder:** `LINKS` points the footer socials at conventional
`marketersh` handles we do not own. Replace before launch.

## Open: applying the shell site-wide

`SiteShell` (nav + footer + the `#main > .framer-pnUdQ` wrapper, with a
children slot) and `HomeBody` are generated and typecheck clean. Wiring
them into `app/(marketing)/layout.tsx` renders every route 200 with the
shell and the new marks present in the DOM — but the page paints blank,
with JavaScript both on and off.

What is known: it is not hydration (JS-off is blank too) and not the
transcription (which measures 0% pixel diff standalone). Computed styles
are right at the point of failure — the nav reports 92px tall,
`opacity: 1`, `color: rgb(252,253,253)` on `rgb(21,30,29)` — and nothing
paints. That points at stacking/clipping introduced by splitting the tree
at `<section>` boundaries, or at `globals.css` interacting with the
export's reset.

The integration is reverted on `app/(marketing)/` so the marketing site
keeps working. Reproduce by importing `SiteShell` in the marketing layout.
