# The goo

Marketer has two deliberate effects. The wave marks a person **committing** something ([`WAVE.md`](./WAVE.md)). The goo shows **one department splitting into its specialists**. Each effect has one meaning. Neither is decoration.

**Do not remove it, and do not add more of it.** `npm run ds:guard` fails the build if a registered goo site loses it, if it appears anywhere unregistered, or if anything but the wrapper imports the library.

## What it is

When Marketer hands a job to its specialists, their chips bud out of the Marketer chip like droplets leaving one body. When the work is done, they melt back into it. The text stays crisp throughout; only the surface behind it is liquid.

- **Library:** `liquid-gooey` by Libraries.dev (MIT), an npm dependency pinned to an exact version in `web/package.json`.
- **The only way to use it:** `AgentSplit` from `@/design-system` (`components/goo.tsx`).

## Why it exists

The product's central idea is hard to see: you talk to one Marketer, and behind it a strategist, a content producer, a media buyer and others do the work. A row of chips that simply appears says "here are some agents". Chips that separate from one body say "this is one department, and these are the parts of it working for you now". When they merge back, the job has returned to the one you talk to.

That is the whole brief: the goo makes **delegation** visible.

## Rules

1. **Only for delegation.** The goo is used where Marketer hands work to specialists and where they report back. It is never used for menus, buttons, tabs, toggles, loaders or hover effects.
2. **It follows real events.** A chip buds when that specialist actually starts work on this job, and the chips melt back when the work actually ends. Never animate it on a timer or for show.
3. **The lead chip is always the one body.** Specialists come out of "Marketer" and return to it. Nothing else may be a source.
4. **Quiet surface.** The liquid uses the same neutral fill as a chip (`surface-3`). Colour stays on each specialist's glyph, where it already means "which tool".
5. **It stays real UI.** Every chip is a labelled button, reachable by keyboard when it is out and removed from the tab order when it is tucked in.
6. **It degrades by itself.** Under reduced motion the library snaps instead of flowing. Don't add a second fallback.
7. **One meaning, no second use** without changing this file and the guard's site list in the same commit, with the reason written here.

## Where it is (the registered sites)

The guard holds this list in `guard.mjs` (`GOO_SITES`). Keep the two in step.

| Site | File |
|---|---|
| Preview and tuning page | `app/preview/wave/wave-demo.tsx` |

Real screens are added to this table and to `GOO_SITES` as they are wired.

## Using it

```tsx
<AgentSplit
  agents={activeDepts.map((d) => ({ name: d.agentName, tone: TOOL_ICON[d.id].tone }))}
  working={chat.isBusy}
  activeName={shownDept?.agentName}
  onSelect={openAgentPanel}
/>
```

- `agents` is the list of specialists on this job, in the order they joined. A new entry buds out when it is added.
- `working` false melts every chip back into the lead.
- The blur, contrast and travel distance are set once inside `components/goo.tsx`. Tune them there.

## Checking it

`/preview/wave` has an "agent split" section (add `?theme=light`). Press "Hand off" to bud a specialist and "Done" to melt them back. Check both themes, keyboard focus, and reduced motion.
