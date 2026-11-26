# Architecture decision records

One file per decision, named for the decision as a sentence: `NNNN-<decision>.md`. Front matter carries
`status: proposed | accepted | superseded by NNNN`. Each record says what we decided, why, what we considered, and what
it costs. When a decision changes, write a new record that supersedes the old one; do not rewrite history.

Terms follow [../GLOSSARY.md](../GLOSSARY.md). The rails themselves are described in [../rails/](../rails/README.md).

| # | Decision | Status |
|---|---|---|
| [0001](0001-decision-models-judge-and-code-decides.md) | Decision models judge and code decides | accepted |
| [0002](0002-a-decision-model-can-tighten-never-loosen-a-tier.md) | A decision model can tighten, never loosen, a tier | accepted |
| [0003](0003-money-paths-fail-closed.md) | Money paths fail closed | accepted |
| [0004](0004-approvals-are-bound-to-exact-arguments-and-single-use.md) | Approvals are bound to exact arguments and single use | accepted |
| [0005](0005-one-enforcement-point-reads-current-facts-at-dispatch.md) | One enforcement point reads current facts at dispatch | accepted |
| [0006](0006-indeterminate-outcomes-are-never-retried.md) | Indeterminate outcomes are never retried | accepted |
| [0007](0007-recipes-compose-guarded-tools.md) | Recipes compose guarded tools | proposed |
| [0008](0008-all-model-calls-go-through-openrouter.md) | All model calls go through OpenRouter | accepted |
| [0009](0009-facts-are-invalidated-never-deleted.md) | Facts are invalidated, never deleted | proposed |
| [0010](0010-learnings-carry-their-evidence.md) | Learnings carry their evidence | proposed |
