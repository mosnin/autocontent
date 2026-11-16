---
name: generative-ui
description: Render rich, interactive UI (cards, tables, stats, charts, checklists, buttons) instead of plain text using OpenUI components. Use when an answer contains structured data, comparisons, metrics, multi-step plans, or choices the user can click.
---

# Generative UI with OpenUI

The chat surfaces (`AgentChat`, `ChatWidget`, `AgentSidebar`) render **OpenUI Lang** with the
Agent Starter component library. Use it when structure makes the answer clearer; use plain prose for
short conversational replies.

## When to render UI
- Tabular data or comparisons → `Table`
- Key numbers / KPIs → `Stat` (several in a row) or `KeyValue`
- Plans, checklists, steps → `List`
- Progress toward a goal or budget → `ProgressBar`
- Warnings, errors, important notes → `Callout`
- Trends or distributions → `BarChart` (simple bar chart)
- Follow-up choices → `Button` (actions are sent back to you as a message)
- Group related content → `Card`

## Rules
1. Read `COMPONENTS.md` (in this skill) for the exact component names, props and syntax — it is generated
   from the UI library, so it is the contract. Never invent components or props.
2. Keep a one-sentence plain-text lead-in before the UI so the answer still reads well in notifications.
3. Data in components must come from tool results or the conversation — never fabricate numbers.
4. Keep it compact: at most ~3 top-level components per answer; prefer a Table over many Cards.
5. Buttons must describe safe follow-ups ("Show details", "Draft email"); destructive actions still go
   through tools and human approval, never through a button label alone.
