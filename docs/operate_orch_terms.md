# AI Agent Orchestration Expert Notecards

## Core Map

```text
AI Agent Systems
├── Cognition and Decisions
├── Context, Memory, Knowledge, and State
├── Tools, Protocols, and Environment
└── Orchestration, Runtime, and Governance
```

Each card contains a term, compressed definition, and minimal diagram.

# Branch 1: Agent Cognition and Decision Architecture

## 1. Agentic loop

Repeated observation, reasoning, action, and correction until a stopping condition is met.

```text
Observe → Think → Act → Verify → Repeat
```

## 2. Goal conditioning

Steering behavior toward an explicit desired outcome rather than generic completion.

```text
Goal + State → Action
```

## 3. Objective function

The measurable criterion the agent attempts to optimize or satisfy.

```text
Actions → Score → Selection
```

## 4. Goal decomposition

Breaking a mission into independently executable and verifiable subgoals.

```text
Mission → Goal A + Goal B + Goal C
```

## 5. Goal stack

A hierarchy linking mission, objectives, tasks, and immediate actions.

```text
Mission ↓ Objective ↓ Task ↓ Action
```

## 6. Constraint satisfaction

Selecting actions that meet requirements without violating hard limits.

```text
Candidate action ∩ Constraints → Valid action
```

## 7. Plan and execute

Separating plan creation from execution and later correction.

```text
Planner → Plan → Executor → Result
```

## 8. Interleaved reasoning and action

Alternating thought, tool use, and observation instead of planning everything upfront.

```text
Think → Tool → Observe → Think
```

## 9. Dynamic replanning

Changing the plan when new evidence invalidates assumptions.

```text
Plan + New evidence → Revised plan
```

## 10. Hierarchical task planning

Recursively reducing high level tasks into primitive executable actions.

```text
Task → Subtask → Primitive action
```

## 11. Task graph

A graph representing tasks, dependencies, branches, and joins.

```text
A → B → D; A → C → D
```

## 12. Dependency aware scheduling

Running work only when its required inputs or predecessor tasks are ready.

```text
Prerequisites complete → Task released
```

## 13. Critical path

The dependency chain that determines the minimum possible completion time.

```text
Longest required path → Finish time
```

## 14. Search based planning

Exploring multiple action sequences before committing to one.

```text
State → {Path 1, Path 2, Path 3}
```

## 15. Tree of Thoughts

Branching into several reasoning paths, evaluating them, then pruning weaker paths.

```text
Thought → Branches → Score → Prune
```

## 16. Graph of Thoughts

Representing reasoning as a graph where ideas can merge, reuse, or loop.

```text
Ideas ⇄ Transformations → Synthesis
```

## 17. Beam search

Keeping only the best few candidate plans at each search depth.

```text
Many candidates → Top k → Expand
```

## 18. Monte Carlo tree search

Estimating action quality through repeated simulated trajectories.

```text
Select → Simulate → Score → Update
```

## 19. World model

An internal model predicting how the environment changes after an action.

```text
State + Action → Predicted next state
```

## 20. Counterfactual simulation

Testing imagined actions without executing them in the real environment.

```text
What if action X? → Simulated outcome
```

## 21. Policy

The rule or learned mapping from current state to next action.

```text
State → Policy → Action
```

## 22. Meta policy

A policy that chooses the model, strategy, workflow, or agent used to solve a task.

```text
Task → Strategy selector → Method
```

## 23. Model routing

Selecting models according to capability, cost, latency, modality, or risk.

```text
Request → Router → Best model
```

## 24. Adaptive reasoning effort

Increasing reasoning depth only when uncertainty or task difficulty requires it.

```text
Difficulty ↑ → Compute ↑
```

## 25. Inference time scaling

Improving output through extra sampling, search, critique, or verification at runtime.

```text
More runtime compute → Better candidate selection
```

## 26. Self reflection

Having the agent inspect its own output for defects before proceeding.

```text
Draft → Critique → Revision
```

## 27. Verifier model

A separate model or procedure that scores correctness without generating the original answer.

```text
Generator → Candidate → Verifier
```

## 28. Process supervision

Evaluating intermediate reasoning or actions rather than only the final result.

```text
Step 1 ✓ → Step 2 ✓ → Outcome
```

## 29. Value of information

The expected benefit of obtaining more evidence before acting.

```text
Information gain − Delay cost → Query or act
```

## 30. Stopping criterion

The condition that ends search, reasoning, or execution.

```text
Success ∨ Budget exhausted ∨ No progress → Stop
```

# Branch 2: Context, Memory, Knowledge, and State

## 1. Context engineering

Selecting and structuring all information available to the model at a decision point.

```text
Sources → Curate → Context → Model
```

## 2. Context assembly

Building the active context from instructions, state, memory, retrieval, and tool results.

```text
Prompt + State + Memory + Tools → Context
```

## 3. Context window

The finite token space the model can attend to during one inference.

```text
Relevant tokens ≤ Window limit
```

## 4. Context budget

The planned allocation of limited context capacity across information types.

```text
Instructions + Evidence + History = Budget
```

## 5. Context rot

Performance loss caused by excessive, stale, conflicting, or low value context.

```text
More context ≠ More signal
```

## 6. Context compression

Reducing token volume while preserving decision relevant information.

```text
Large history → Compact representation
```

## 7. Semantic compression

Compressing by concepts, relationships, and causal meaning rather than text length alone.

```text
Details → Concepts + Relations
```

## 8. Context distillation

Turning long trajectories into compact reusable summaries or rules.

```text
Episodes → Lessons → Persistent summary
```

## 9. Progressive disclosure

Loading detail only when the current task stage requires it.

```text
Overview → Need detected → Detail
```

## 10. Just in time context

Retrieving information immediately before it becomes useful.

```text
Task state → Retrieve needed evidence
```

## 11. Context caching

Reusing stable prompt segments or computed context to reduce repeated work.

```text
Stable prefix → Cache → Reuse
```

## 12. Semantic cache

Reusing prior results when a new request is meaningfully similar, not textually identical.

```text
New query ≈ Old query → Cached result
```

## 13. Working memory

Temporary information actively used during the current reasoning episode.

```text
Current task ↔ Active facts
```

## 14. Episodic memory

Stored records of past events, actions, trajectories, and outcomes.

```text
Experience → Episode store
```

## 15. Semantic memory

Generalized facts and relationships extracted from experiences or knowledge sources.

```text
Episodes → Facts and concepts
```

## 16. Procedural memory

Reusable knowledge describing how to perform a class of tasks.

```text
Trigger → Procedure → Execution
```

## 17. Prospective memory

A stored intention that activates when a future condition occurs.

```text
Condition becomes true → Remembered action
```

## 18. Memory consolidation

Transforming raw interactions into stable facts, procedures, or summaries.

```text
Raw events → Filter → Durable memory
```

## 19. Memory retrieval policy

The rule deciding which memories enter the active context.

```text
Goal + State → Rank memories
```

## 20. Memory salience

The estimated importance of a memory to the current decision.

```text
Relevance × Importance × Recency
```

## 21. Memory decay

Lowering retrieval priority as information becomes old, unused, or contradicted.

```text
Time or contradiction ↑ → Weight ↓
```

## 22. Memory provenance

Tracking the origin, evidence, author, and transformation history of remembered information.

```text
Claim → Source → Transformations
```

## 23. Retrieval augmented generation

Retrieving external evidence and placing it into context before generation.

```text
Query → Retrieve → Ground → Generate
```

## 24. Hybrid retrieval

Combining lexical, vector, graph, metadata, and reranking methods.

```text
Keyword + Vector + Graph → Ranked evidence
```

## 25. Reranking

Rescoring retrieved candidates with a stronger relevance model.

```text
Candidates → Reranker → Best evidence
```

## 26. Knowledge graph

Entities and typed relationships stored as a graph for structured reasoning.

```text
Entity → Relation → Entity
```

## 27. Temporal knowledge graph

A knowledge graph that records when facts and relationships are valid.

```text
Entity → Relation at time t → Entity
```

## 28. Agent state

The structured data required for the agent to continue correctly.

```text
Inputs + Progress + Decisions + Pending work
```

## 29. Checkpointing

Saving recoverable state at meaningful execution boundaries.

```text
Run → Snapshot → Resume
```

## 30. Event sourcing

Reconstructing current state from an ordered log of state changing events.

```text
Events 1…n → Replay → Current state
```

# Branch 3: Tools, Protocols, and Environmental Interaction

## 1. Tool calling

Generating a structured request that invokes an external capability.

```text
Intent → Tool arguments → Tool result
```

## 2. Function schema

A typed machine readable contract describing a tool and its arguments.

```text
Name + Types + Constraints → Valid call
```

## 3. Tool affordance

The actions a tool makes possible for the agent.

```text
Tool interface → Possible actions
```

## 4. Tool semantics

The exact meaning, effects, limits, and failure behavior of a tool.

```text
Call → Defined effect
```

## 5. Tool discoverability

The ability to find the right capability within a large tool ecosystem.

```text
Task → Search capabilities → Select tool
```

## 6. Tool selection policy

The logic choosing a tool based on fit, cost, permissions, and risk.

```text
Candidates → Policy → Tool
```

## 7. Tool grounding

Connecting model reasoning to external data or real world operations.

```text
Reasoning ↔ External truth
```

## 8. Tool result normalization

Converting heterogeneous responses into a consistent internal format.

```text
Many response shapes → Canonical result
```

## 9. Structured output

Model output constrained to a defined schema for machine processing.

```text
Model → Schema valid object
```

## 10. Schema adherence

The degree to which generated data conforms to required types and constraints.

```text
Output ∈ Schema
```

## 11. Model Context Protocol

An open protocol connecting AI applications to tools, data, prompts, and resources.

```text
Agent client ↔ MCP server ↔ System
```

## 12. MCP client

The component that discovers and invokes capabilities exposed by MCP servers.

```text
Agent → MCP client → Server
```

## 13. MCP server

A service exposing tools, resources, or prompts through the MCP standard.

```text
External system → MCP interface
```

## 14. MCP transport

The communication channel carrying MCP messages between client and server.

```text
Client ⇄ Transport ⇄ Server
```

## 15. Agent2Agent protocol

A standard for discovery, messaging, delegation, and coordination between independent agents.

```text
Agent A ⇄ A2A ⇄ Agent B
```

## 16. Agent card

A machine readable description of an agent’s identity, skills, endpoints, and capabilities.

```text
Agent → Capability manifest
```

## 17. Agent Skills

Portable packages containing instructions, procedures, examples, and resources for specialized work.

```text
Skill package → Agent capability
```

## 18. Computer use

Allowing an agent to perceive and operate graphical user interfaces.

```text
Screenshot → Interpret → Click or type
```

## 19. Browser automation

Programmatic navigation and interaction with web applications.

```text
DOM or pixels → Actions → Page state
```

## 20. Code execution

Running generated code inside a controlled execution environment.

```text
Model → Code → Sandbox → Result
```

## 21. Sandbox

An isolated environment limiting filesystem, network, process, and credential access.

```text
Untrusted action inside bounded container
```

## 22. Side effect classification

Categorizing actions by their ability to read, write, send, delete, purchase, or publish.

```text
Action → Risk class
```

## 23. Idempotency

The property that repeating an operation does not create duplicate effects.

```text
Execute twice → One logical effect
```

## 24. Idempotency key

A unique request identifier used to suppress duplicate external operations.

```text
Request ID repeated → Duplicate rejected
```

## 25. Transaction

A group of operations that commits consistently or fails without partial state.

```text
Begin → Operations → Commit or rollback
```

## 26. Compensating action

A corrective operation that semantically reverses an earlier side effect.

```text
Action A → Failure → Compensation A⁻¹
```

## 27. Dry run

Validating an action plan without committing external changes.

```text
Proposed action → Simulation → Approval
```

## 28. Capability based security

Granting explicit, narrowly scoped powers instead of broad ambient authority.

```text
Capability token → Specific allowed action
```

## 29. Least privilege

Giving an agent only the permissions required for its current task.

```text
Needed permissions only
```

## 30. Credential delegation

Providing temporary or scoped authority to act on behalf of a user or service.

```text
Principal → Scoped credential → Agent
```

# Branch 4: Multi Agent Orchestration, Runtime, and Governance

## 1. Orchestrator

The control layer assigning work, routing state, enforcing policies, and tracking completion.

```text
Goal → Orchestrator → Agents
```

## 2. Supervisor pattern

A central agent selects specialists, reviews results, and decides the next step.

```text
Supervisor ⇄ Specialists
```

## 3. Router pattern

A lightweight classifier sends each request to the best specialist or workflow.

```text
Request → Router → Specialist
```

## 4. Handoff

Transferring active control and relevant context from one agent to another.

```text
Agent A → Context + Control → Agent B
```

## 5. Delegation

Assigning a bounded task while the original agent retains overall responsibility.

```text
Manager → Task → Worker → Result
```

## 6. Blackboard architecture

Agents coordinate through a shared workspace containing partial results and tasks.

```text
Agents ⇄ Shared blackboard
```

## 7. Contract net protocol

Agents announce tasks, submit bids, and award work based on capability or cost.

```text
Announce → Bid → Award → Execute
```

## 8. Role specialization

Assigning agents distinct objectives, tools, knowledge, or permissions.

```text
General mission → Specialized roles
```

## 9. Swarm orchestration

Many semi autonomous agents coordinate through local rules rather than one detailed controller.

```text
Local interactions → Global behavior
```

## 10. Parallel fan out and fan in

Launching independent subtasks concurrently, then combining their outputs.

```text
Task → {A, B, C} → Synthesis
```

## 11. Map reduce for agents

Applying one operation across partitions, then aggregating the results.

```text
Map across chunks → Reduce findings
```

## 12. Consensus mechanism

A rule for combining conflicting agent judgments into one decision.

```text
Opinions → Aggregation rule → Decision
```

## 13. Debate protocol

Agents challenge competing solutions so weaknesses become visible before selection.

```text
Proposal A ⇄ Proposal B → Judge
```

## 14. Shared state

A common data structure multiple agents read and update during coordination.

```text
Agent A ⇄ State ⇄ Agent B
```

## 15. Message passing

Agents exchange explicit messages rather than sharing internal memory directly.

```text
Agent A → Message → Agent B
```

## 16. Actor model

Concurrent agents operate as isolated actors communicating through asynchronous messages.

```text
Actor A ⇄ Mailbox ⇄ Actor B
```

## 17. Durable execution

Persisting workflow progress so long running work survives crashes and restarts.

```text
Run → Persist → Crash → Resume
```

## 18. Deterministic replay

Reconstructing execution by replaying recorded decisions and events under controlled rules.

```text
Event log → Replay → Reproduced state
```

## 19. Saga pattern

Coordinating distributed transactions through ordered steps and compensating actions.

```text
Step A → B → Failure → Undo B, A
```

## 20. Backpressure

Slowing producers when downstream agents or tools cannot safely absorb more work.

```text
Queue full → Producer slows
```

## 21. Work stealing

Idle workers pull tasks from busier workers to improve utilization.

```text
Idle worker ← Busy queue
```

## 22. Circuit breaker

Temporarily blocking calls to a failing dependency to prevent cascading damage.

```text
Failures exceed threshold → Open circuit
```

## 23. Bulkhead isolation

Separating resources so one failing workload cannot exhaust the entire system.

```text
Pool A | Pool B | Pool C
```

## 24. Dead letter queue

A holding queue for tasks that repeatedly fail and require inspection or repair.

```text
Failed task → Retry limit → DLQ
```

## 25. Distributed tracing

Recording causal spans across model calls, tools, agents, and services.

```text
Trace → Spans → End to end path
```

## 26. Trace grading

Scoring complete execution traces to locate workflow level failures.

```text
Trace → Criteria → Grade
```

## 27. Agent evaluation

Measuring task success, trajectory quality, reliability, latency, and cost.

```text
Runs → Metrics → Decision
```

## 28. Guardrail

A validation or policy check that blocks, modifies, or escalates unsafe behavior.

```text
Input or action → Check → Allow or block
```

## 29. Policy as code

Expressing operational and security rules as executable, version controlled logic.

```text
Rule repository → Runtime enforcement
```

## 30. Budget governor

A control mechanism enforcing limits on tokens, money, time, tools, or concurrency.

```text
Usage → Budget check → Continue or stop
```

# Mastery Standard

For every term, you should be able to:

1. Define it without vendor language.
2. Draw it from memory.
3. Identify the failure it prevents.
4. Name when it should not be used.
5. Implement or simulate a minimal example.
6. Explain how it connects to the other three branches.

# Recommended Learning Sequence

1. Learn five cards per day.
2. Redraw each diagram from memory.
3. Build one minimal implementation per group of ten.
4. Compare two architectures using the terms.
5. Audit a real agent system and label every component.
6. Finish by designing one governed multi agent runtime from first principles.