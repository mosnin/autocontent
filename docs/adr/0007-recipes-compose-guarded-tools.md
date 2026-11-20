---
status: proposed
---

# Recipes compose guarded tools

When a multi-step task works, the agent may propose saving it as a **recipe**: a named, declarative list of existing
tool calls with fixed parameters and a narrower rule. Recipes get their own access state, and every inner call still
passes the enforcement point, its tier and its approval. Design only; nothing is built. See
[docs/rails/recipes.md](../rails/recipes.md).

## Why

- People repeat the same moves ("boost the winner by 10%"); re-planning them each time costs tokens and invites drift.
- A saved composition can carry a rule tighter than its tools (only campaigns at or above target ROAS for 7 days,
  at most +10%), which is easier to approve once than every time.

## Decision

- **Declarative first.** JSON steps that reference existing tools; no code, no new side-effect paths.
- **No new authority.** A recipe never raises what its inner tools may do. Its access state can only be equal to or
  tighter than the tightest inner tool; a CRITICAL inner step keeps a per-execution approval bound to that step's
  arguments.
- **Code-mode programs later, if at all.** Only if declarative recipes prove too rigid, and then in an isolate whose
  every tool call still goes through the enforcement point.

## Considered options

- **Saved code (coral's private and shared tools).** More expressive; also a new execution surface to secure. Not
  needed for the moves people repeat today.
- **Skills (instructions only).** Exist today; they guide but do not bind parameters or narrow rules.
