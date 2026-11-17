# INTENT-002: Agent World — The Stigmergic Engineering Experiment
<!-- Source: Mark's INTENT-002 (v2.0, approved for implementation), kept verbatim below. Section headings are mapped onto the starter's gate names in comments. -->

The Stigmergic Engineering Experiment

Project: Agent World
Version: 2.0
Status: Approved for Implementation
Foundation: Existing Little World application
Implementation: Separate simulation alongside Little World
Inspiration: Peter Small — Intelligent Objects, Artificial Life, Stigmergy, and Game Theory
Engineering Method: Intent-Driven Engineering

## Outcome <!-- §1 Intent -->

Create an interactive artificial-life simulation in which autonomous software engineering agents construct, maintain, and evolve a digital software ecosystem.

The application should visually demonstrate how complex engineering systems emerge through local decisions, indirect coordination, cooperation, competition, and adaptation.

The experience should resemble watching an ant colony build an AI ecosystem.

The agents must make genuine decisions based on their objectives, capabilities, resources, and perceived environment.

The system must not simply animate predetermined workflows.

Primary objective: Demonstrate emergent engineering behavior in an entertaining, observable, and explainable simulation.

This is a learning experiment and demonstration, not a commercial product.

## 2. Relationship To Little World

Preserve the existing Little World application.

Agent World must operate as a separate simulation experience accessible from the existing application.

Provide a simple selection mechanism:

Choose Your World

- Little World — Original civilization simulation.
- Agent World — Autonomous AI engineering civilization.

Both experiences should remain independently usable.

Reuse existing components where practical:

- World rendering.
- Character animations.
- Movement.
- Simulation timing.
- Camera controls.
- User interaction.
- Existing UI components.

Do not duplicate working systems unnecessarily.

Do not modify Little World’s simulation behavior unless required for safe shared-component extraction.

Preserve existing functionality through automated regression tests.

Avoid architectural restructuring that provides no demonstrated benefit.

## 3. Agent Population

Begin with ten autonomous agents.

Initial roles:

| Role | Count | Responsibility |
|---|---|---|
| Developer | 3 | Construct and modify services |
| Architect | 2 | Evaluate and improve structures |
| Tester | 2 | Detect defects and verify repairs |
| Explorer | 2 | Discover opportunities |
| Optimizer | 1 | Improve efficiency |

Every agent must possess:

- Unique identity.
- Role.
- Skills and capabilities.
- Energy.
- Current objective.
- Behavioral strategy.
- Limited memory.
- Environmental perception.
- Available actions.
- Current activity.
- Action history.

Agents must independently evaluate and select actions.

Agent roles define capabilities, not predetermined scripts.

## 4. The Software Civilization

Replace agricultural structures with recognizable software engineering structures.

Initial structure types:

- Repository.
- API.
- Service.
- Data Store.
- Shared Library.
- Integration Connection.

Each structure should possess meaningful simulation properties:

- Construction progress.
- Reliability.
- Complexity.
- Resource cost.
- Usage.
- Dependencies.
- Defect state.

Agents may construct, inspect, connect, test, repair, improve, reuse, or abandon structures.

Structures must affect the decisions of nearby agents.

The environment must evolve as agents act upon it.

## 5. Stigmergy — The Core Experiment

Implement indirect coordination through environmental signals.

Agents should influence other agents by changing their shared environment.

Examples:

Construction Signal

An unfinished API creates an opportunity for Developers.

Failure Signal

A defective service creates an opportunity for Testers, Developers, and Architects.

Integration Signal

An isolated service creates an opportunity for connecting it to other structures.

Optimization Signal

An inefficient service creates an opportunity for improvement.

Reuse Signal

A useful shared capability attracts additional agents.

Signals must:

- Originate from real environmental state.
- Possess measurable strength.
- Be discoverable through agent perception.
- Influence decision calculations.
- Decay or disappear when appropriate.
- Compete with other opportunities.

Agents must remain free to ignore signals.

Do not centrally assign tasks.

A coordination sequence should emerge because agents independently respond to environmental changes.

## 6. Agent Decision Engine

Each agent operates through a repeated autonomous decision cycle.

Observe → Evaluate → Decide → Act → Learn

Observe

Inspect the agent’s local environment.

Identify visible structures, signals, available resources, and nearby agents.

Evaluate

Identify valid actions based on capabilities and available resources.

Estimate benefits, costs, risks, and expected rewards.

Decide

Select an action using a strategy-specific utility calculation.

Act

Execute the selected action.

Update the environment.

Learn

Record the result.

Adaptive agents may adjust future preferences using observed outcomes.

Use deterministic simulation rules with seeded probabilistic choices.

No external LLM is required.

Keep decisions computationally inexpensive and explainable.

Do not introduce unnecessary machine-learning frameworks.

## 7. Evolutionary Game Theory

Introduce three behavioral strategies.

Cooperative

Prioritizes:

- Shared progress.
- Completing existing work.
- Reusable capabilities.
- Helping other agents.
- Overall ecosystem health.

Competitive

Prioritizes:

- Individual rewards.
- Exclusive opportunities.
- Personal efficiency.
- Resource accumulation.

Adaptive

Adjusts behavior based on observed outcomes.

Learns whether cooperation or competition produces better results under current conditions.

Strategies must change actual action selection.

Do not artificially guarantee that cooperation succeeds.

Competition may improve short-term performance while damaging overall system efficiency.

Cooperation may improve shared outcomes but carry costs.

Allow meaningful tradeoffs to emerge.

## 8. Autonomous Work And Coordination

Agents should perform engineering activities based on available opportunities.

Example:

A Developer begins constructing an API.

The Developer runs out of energy.

The unfinished API generates an environmental signal.

Another Developer discovers the unfinished structure.

That Developer evaluates whether completing it offers sufficient reward.

The Developer may complete the API.

A Tester later discovers the completed service.

The Tester identifies a defect.

The defect creates a failure signal.

An Architect evaluates the failure.

A Developer may repair the service.

A Tester may verify the repair.

This is an example of possible emergent behavior.

Do not hardcode this sequence as a mandatory workflow.

Every action must result from valid agent decisions.

Support resource reservation or equivalent safeguards to prevent conflicting actions.

## 9. Visual Environment

Preserve Little World’s engaging animated visual style.

Agent World should feel like a living digital civilization.

Agents should visibly:

- Explore.
- Travel toward objectives.
- Construct structures.
- Inspect services.
- Repair defects.
- Establish connections.
- Collaborate.
- Compete for opportunities.

Represent structures as attractive, recognizable digital buildings or objects.

Use visible connections between related structures.

Show environmental signals through subtle visual effects.

Avoid excessive visual clutter.

A user should enjoy watching the simulation without needing to understand the underlying algorithms.

## 10. Agent Inspector

Allow the user to select any agent.

Display a live inspection panel.

Identity

- Agent name.
- Role.
- Strategy.
- Energy.
- Current objective.

Perception

- Visible structures.
- Nearby agents.
- Environmental signals.
- Discovered opportunities.

Decision

- Available actions.
- Estimated utility of each candidate.
- Selected action.
- Reason for selection.

Activity

- Current task.
- Current destination.
- Progress.
- Recent decisions.
- Successful actions.
- Failed actions.

Inspector values must originate from actual simulation state.

Decision explanations must reflect the factors used by the decision engine.

Do not fabricate rationales after decisions are made.

The inspector should update as the selected agent moves through its decision cycle.

## 11. Structure Inspector

Allow selection of software structures.

Display:

- Structure identity.
- Type.
- Completion status.
- Reliability.
- Complexity.
- Resource cost.
- Defects.
- Dependencies.
- Connected structures.
- Recent modifications.
- Agents currently interacting with the structure.

Use actual simulation properties.

## 12. Activity Feed

Display meaningful simulation events.

Examples:

- Developer-003 started constructing API-001.
- Explorer-002 discovered an unfinished service.
- Tester-001 identified a defect.
- Architect-002 selected a reliability improvement.
- Developer-001 repaired Service-004.
- Optimizer-001 improved API efficiency.
- Connector relationship established between two services.

Events must originate from actual actions and state transitions.

Do not generate fictional activity.

Keep the feed concise and readable.

## 13. Simulation Metrics

Provide a compact dashboard showing:

- Active agents.
- Completed structures.
- Ecosystem reliability.
- Useful work completed.
- Resource consumption.
- Cooperation events.
- Competition events.
- Defects discovered.
- Defects repaired.
- Reused capabilities.

Metrics must reflect actual simulation state.

Provide basic historical trends where practical.

Do not implement a complex analytics platform.

## 14. Experiment Controls

Provide:

- Start.
- Pause.
- Resume.
- Simulation speed.
- Reset.
- Random seed.
- Agent selection.
- Structure selection.

Support three initial simulation configurations:

Cooperative World

Most agents favor cooperative strategies.

Competitive World

Most agents favor competitive strategies.

Mixed World

Agents use a mixture of cooperative, competitive, and adaptive strategies.

The same seed and initial conditions should be reproducible.

The user should be able to compare outcomes between configurations.

## 15. System Architecture

Use the existing Little World technology stack.

Prefer shared rendering and interaction components.

Separate Agent World into logical components:

- World State.
- Agent Model.
- Perception Engine.
- Decision Engine.
- Action Executor.
- Environmental Signal System.
- Resource Model.
- Simulation Metrics.
- Event History.
- Rendering Adapter.
- Inspector UI.

These are logical modules, not separate services.

The simulation must run locally in the browser.

No external AI services.

No cloud infrastructure.

No microservices.

No external orchestration framework.

No database unless the existing application already requires one.

Use simple, extensible implementation techniques.

## 16. Simulation Integrity

Maintain consistent world state.

Prevent invalid actions.

Prevent negative resource balances.

Ensure agents cannot perform actions outside their capabilities.

Ensure structures cannot be modified inconsistently by simultaneous actions.

Separate seeded randomness from rendering.

Ensure identical seeds and identical user inputs produce equivalent simulation results.

Record decisions and environmental changes.

Use simulation time rather than wall-clock time for simulation behavior.

Avoid frame-rate-dependent decision outcomes.

## 17. Initial Experiment

The first experiment should demonstrate:

Can ten autonomous engineering agents construct and maintain a software ecosystem without central coordination?

Run the simulation for ten simulated minutes.

Observe:

- Structures created.
- Defects discovered.
- Defects repaired.
- Cooperation events.
- Competition events.
- Resources consumed.
- Ecosystem reliability.
- Emergent relationships.

The application should expose enough information to explain what occurred.

Unexpected outcomes are acceptable.

The simulation must not manipulate results to produce a predetermined conclusion.

## Acceptance criteria <!-- §18 -->

Version 2 is complete when:

1. Little World remains functional and independently accessible.
2. Agent World launches as a separate simulation.
3. Ten autonomous agents populate the environment.
4. Agents independently evaluate and select valid actions.
5. Agents visibly move toward selected objectives.
6. Agents construct and modify software structures.
7. Environmental signals influence agent behavior.
8. Cooperative and competitive strategies affect decisions.
9. The agent inspector displays actual perception and decision data.
10. The structure inspector displays real structure state.
11. The activity feed reports actual simulation events.
12. Metrics derive from real simulation events.
13. The user can pause, resume, reset, and change simulation speed.
14. Fixed seeds reproduce equivalent simulation outcomes.
15. The simulation runs continuously for ten minutes without intervention or serious performance degradation.
16. Automated tests validate decision-making, resource accounting, signals, and state transitions.
17. Existing Little World regression tests continue passing.

## Evidence <!-- §19 Evidence requirements -->

Provide:

- Summary of reused Little World components.
- Description of new Agent World modules.
- Explanation of decision calculations.
- Explanation of environmental signal propagation.
- Explanation of behavioral strategies.
- Automated test results.
- Example agent decision trace.
- Example emergent coordination sequence.
- Instructions for running both simulations.
- Known limitations.

Evidence must reflect actual implementation results.

Do not claim emergent behavior solely because agents move around the screen.

Demonstrate that one agent’s environmental changes influence another agent’s independent decisions.

## Constraints <!-- §20 Scope boundaries -->

Do not implement:

- External LLM integration.
- Real code generation.
- Real repositories.
- Actual deployment.
- CI/CD execution.
- Enterprise governance infrastructure.
- Distributed agent orchestration.
- Multiplayer functionality.
- Complex reinforcement-learning systems.
- Commercialization features.

Do not introduce additional frameworks without evidence of need.

Do not create elaborate abstractions for hypothetical future requirements.

Preserve simplicity.

## 21. Implementation Approach

Inspect the existing Little World repository.

Identify opportunities for component reuse.

Preserve the existing application.

Create Agent World alongside Little World.

Implement the minimum complete simulation supporting autonomous decisions and stigmergic coordination.

Use incremental integration.

Validate decisions independently from rendering.

Add visual behavior after the underlying simulation logic works.

Verify the complete application.

Record evidence and limitations.

The implementation agent owns technical decisions within the stated intent and constraints.

Do not request additional architectural direction unless a genuine blocking ambiguity prevents progress.

## 22. Success Definition

Agent World should be enjoyable to watch and intellectually interesting to inspect.

Ten autonomous software engineering agents should gradually construct a recognizable software ecosystem.

Agents should discover opportunities, compete for resources, cooperate indirectly, and respond to environmental changes.

Their decisions should be inspectable.

Their actions should have meaningful consequences.

The world should evolve differently under different strategies and environmental conditions.

The simulation must demonstrate actual agent-based behavior rather than predetermined animation.

Central research question:

Can simple autonomous engineering agents construct complex, coordinated software systems through local decisions, game theory, and stigmergic interactions?

Build the smallest convincing demonstration that allows us to explore that question.

## Final instruction to Claude Code

You are working inside an existing application containing Little World.

Do not replace Little World.

Create Agent World as a separate selectable experience.

Reuse working capabilities.

Preserve the existing visual quality.

Prioritize genuine autonomous decisions, environmental coordination, and observable emergent behavior.

Implement the complete Version 2 scope without unnecessary infrastructure.

Test your implementation.

Provide reproducible evidence.

Make the simulation entertaining.

Let the agents build their world.

## One thing Mark especially wants to see

Dude, when you click an Architect, I want to see what that Architect actually perceives, not merely what it’s doing.

Perhaps it sees three services, notices two are connected, and discovers that the third is isolated.

It evaluates several alternatives, decides the isolated service presents the greatest opportunity, and walks over to investigate.

Meanwhile, a Developer might independently reach a different conclusion.

Two agents. Same world. Different perceptions, capabilities, strategies, and decisions.

That’s how we begin demonstrating something more interesting than scripted automation.

And if those individual decisions eventually produce a software ecosystem that neither we nor Claude explicitly designed, we’ll have a fascinating demonstration of the ideas Peter Small was exploring decades ago.

This is the version I’d build next.
