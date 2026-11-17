# INTENT-001: The Little World
<!-- A living, evolving civilization simulation. Version 0.1 — First Playable World. -->
<!-- Source: Mark's INTENT-001, mapped onto the starter's sections. Deltas are appended below; do not rewrite this intent. -->

Project Owner: Human (Mark) · Implementation Agent: Claude Code · Philosophy: Intent-Driven Engineering
First settlement: **New Beginnings — Population 10.**

## Outcome
Create a visually engaging, interactive, browser-based world populated by autonomous inhabitants who live, move, work, consume resources, and gradually develop a small civilization.

The world should feel alive without requiring constant player intervention.

The player is not controlling individual characters. Instead, the player influences the environment and observes the consequences.

The primary objective is curiosity, discovery, and enjoyment.

A successful experience makes the player wonder:

* What are my inhabitants doing?
* Why did that happen?
* What happens if I change something?
* What will this world look like tomorrow?
* Can this tiny civilization survive without me?

The simulation should produce interesting behavior through relatively simple underlying rules.

It should not depend on an LLM or external AI services.

## Inputs
Initial World

Create a small, visually attractive environment containing:

* A landscape with grass, trees, and natural terrain.
* A river or other water source.
* A small settlement containing five houses.
* A population of ten autonomous inhabitants.
* A shared food supply.
* A day/night cycle.
* A visible simulation clock.

Each inhabitant should have persistent individual attributes.

Suggested attributes include:

* Name
* Age
* Health
* Happiness
* Hunger
* Energy
* Occupation
* Current activity

The implementation agent may select additional attributes when they improve the simulation.

Initial Occupations

The civilization should have basic productive activities.

Examples:

* Farmer
* Builder
* Gatherer
* General laborer

Inhabitants should perform activities that support their own survival and the settlement.

The initial economic system should remain simple.

Autonomous Behavior

Inhabitants should move around the world and make basic decisions according to their needs and available opportunities.

Examples:

A hungry inhabitant seeks food.

A tired inhabitant returns home.

A farmer works in the fields.

A gatherer collects resources.

A builder contributes to settlement development.

The player should be able to observe these activities without issuing individual instructions.

Player Interventions

Provide a small collection of actions that influence the simulation.

Initial actions:

1. Plant trees.
2. Build a house.
3. Add food.
4. Start or pause the simulation.
5. Adjust simulation speed.

Additional interactions are welcome when they materially improve the first playable experience without introducing unnecessary complexity.

## Outputs
Deliver a functioning browser application.

Visual World

The main interface should present an animated, top-down or slightly isometric world.

The world should contain visibly moving inhabitants, distinguishable buildings, natural features, and environmental activity.

Prioritize visual clarity, charm, and responsiveness over photorealism.

The player should be able to recognize meaningful behavior by watching the simulation.

Information Panel

Display essential civilization statistics:

* Population
* Food supply
* Housing capacity
* Average happiness
* Current simulation day
* Available resources

Statistics should reflect actual simulation state rather than decorative or randomly generated numbers.

Individual Inhabitants

Allow the player to select an inhabitant and inspect their characteristics and current activity.

Example:

Jenny — Age 32

Occupation: Farmer
Health: 92%
Happiness: 78%
Current activity: Harvesting crops

The player should be able to observe Jenny moving through the world and performing relevant activities.

Initial Characters

Include three recognizable fictional inhabitants:

Rook: An organizer or community leader.

Doctor: A merchant or economic specialist.

Jenny: A farmer or settlement coordinator.

These are ordinary simulation inhabitants, not AI agents.

Their personalities and occupations may influence their behavior through simple rules.

Other inhabitants should have generated names and characteristics.

Activity Log

Display meaningful events as the world develops.

Examples:

* Day 2: Jenny harvested the first crop.
* Day 3: Food supplies are running low.
* Day 4: Rook began construction of a house.
* Day 5: The settlement reached twelve inhabitants.

The activity log should reflect events that actually occurred.

Persistence

Save the simulation locally so the player can return to the same civilization.

Use a suitable browser-storage mechanism.

The player should be able to reload the application without losing the current world.

Provide a way to reset and begin a new civilization.

Offline progression is optional for this first version.

## Success / Evidence
The first version is successful when:

1. The application runs in a modern desktop or mobile browser.
2. The world displays ten identifiable autonomous inhabitants.
3. Inhabitants move visibly through the environment.
4. Inhabitants demonstrate at least three meaningful behaviors associated with their needs or occupations.
5. Resources change according to actual simulation activity.
6. Player interventions produce observable consequences.
7. The simulation can run continuously for ten minutes without crashing or becoming unresponsive.
8. The player can inspect inhabitants and understand what they are doing.
9. The simulation can be paused, resumed, and accelerated.
10. The world can be saved and restored.
11. Automated checks cover important deterministic simulation rules.
12. A human can interact with the application and reasonably conclude that the world feels alive.

The final criterion is particularly important.

A technically correct simulation that is boring to watch does not accomplish the intent.

### Validation and evidence
Validate the application using appropriate engineering techniques.

At minimum:

* Verify that the application builds and starts successfully.
* Verify that simulation time advances correctly.
* Verify that resource changes follow simulation rules.
* Verify that inhabitants perform their assigned behaviors.
* Verify that saving and restoring preserves the world.
* Verify that pause and speed controls work.
* Verify that the application remains stable during continuous simulation.

Provide a brief implementation summary containing:

* What was built.
* How to run it.
* What behaviors are implemented.
* What was tested.
* What limitations remain.

Avoid unnecessary evaluation infrastructure.

Use deterministic tests where they provide direct evidence.

The human player will determine whether the experience is enjoyable.

## Constraints / Boundaries
Technical

* Browser-based application.
* No required backend.
* No authentication.
* No paid APIs.
* No external AI dependencies.
* No mandatory cloud infrastructure.
* Favor straightforward, maintainable implementation.
* Use a rendering approach appropriate for smooth animation.
* Keep simulation logic separate from presentation where practical.
* Permit future expansion without designing an elaborate framework in advance.

Claude Code may choose the programming language, rendering library, project structure, and simulation techniques.

Simulation

The simulation must be driven by coherent rules.

Do not create the appearance of autonomy by playing unrelated random animations.

Inhabitant decisions should be influenced by their internal state and environment.

Randomness may introduce variation, but outcomes should remain explainable.

Use a deterministic simulation seed where practical to support reproducible behavior.

Engineering

Apply minimum sufficient complexity.

Do not introduce:

* Microservices
* Agent orchestration frameworks
* LLM-based decision engines
* Elaborate evaluation frameworks
* Unnecessary dependency layers
* Premature distributed architecture

Prefer direct implementation and observable behavior.

Scope

Version 0.1 does not require:

* Complex politics
* Warfare
* Detailed genetics
* Advanced economic markets
* Sophisticated weather systems
* Full physics simulation
* Advanced calculus models
* Multiplayer capabilities
* Large-scale civilizations

These remain possible future directions.

Do not sacrifice the first playable experience to accommodate them prematurely.

Architectural recommendation from the owner: keep **simulation time** separate from **rendering time**, so the civilization can be accelerated without inhabitants zipping across the screen at ridiculous speeds.

### Implementation autonomy
Claude Code owns the implementation approach.

Before implementation:

* Inspect the existing repository, if any.
* Identify the simplest suitable application architecture.
* Establish a minimal working development environment.
* Determine how to represent simulation state and render the world.

Then implement the first playable version.

Do not produce an extensive architecture proposal unless an important unresolved decision requires human input.

Prefer a working application over architectural documentation.

Make reasonable implementation decisions independently.

Document only decisions necessary for maintaining and extending the application.

### Stop conditions
Stop and request human direction only when:

* An essential requirement cannot be satisfied within the technical constraints.
* A decision would materially change the intended experience.
* A dependency introduces significant ongoing cost.
* A major implementation obstacle prevents a usable first version.

Otherwise, proceed autonomously.

Do not expand the project into future versions without authorization.

## Definition of Done
Version 0.1 is complete when the player can:

Open the application, watch ten inhabitants living in a small world, influence their environment, observe meaningful consequences, and return later to continue the same civilization.

The world does not need to be sophisticated.

It needs to be alive.



FINAL IMPLEMENTATION DIRECTIVE

Build the smallest enjoyable version of The Little World.

Favor emergent behavior over scripted spectacle.

Favor working software over documentation.

Favor understandable rules over unnecessary complexity.

Give the inhabitants enough autonomy to surprise the player.

Make something worth watching.

## Future Exploration (not v0.1 scope)
The world should eventually provide opportunities to experiment with several interesting disciplines.

These are exploration themes, not immediate implementation requirements.

Agriculture and Ecology

Introduce farming cycles, crop yields, rainfall, soil quality, and resource depletion.

Explore relationships among population, food production, and environmental conditions.

Economics

Introduce trade, supply and demand, occupations, wages, production, consumption, and specialization.

Observe how economic incentives influence settlement development.

Game Theory

Allow inhabitants and settlements to cooperate, compete, negotiate, and make decisions under resource constraints.

Explore emergent behavior without scripting every outcome.

Mathematics and Calculus

Introduce measurable rates of change.

Potential examples:

* Population growth.
* Resource consumption.
* Crop production.
* Disease transmission.
* Economic growth.
* Environmental recovery.

Eventually provide a way for the player to visualize how changing variables affects civilization development.

Mathematics should support meaningful simulation behavior rather than exist as an artificial feature.

Physics

Explore movement, collisions, transportation, environmental interactions, and other physical systems where they improve gameplay.

Migration and Population

Allow inhabitants to move between settlements as opportunities and living conditions change.

Model behavior using individual needs and economic incentives rather than assumptions based on ethnicity or nationality.

Civilization Development

Introduce new buildings, technologies, infrastructure, trade routes, and competing settlements.

The world may eventually evolve across multiple historical eras.
