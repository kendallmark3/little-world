# Simulation Rules (v0.1)

Numbers live in `RULES` in `src/sim/sim.js`.

## Needs
- Hunger rises 0.11/min awake, 0.04/min asleep. At 55% an inhabitant goes to eat: one food, −60 hunger. If the granary is empty they forage a berry bush directly.
- Energy drains while awake (faster while working, faster for *sleepy* people) and recovers while sleeping — fast at home, slowly by the campfire if homeless.
- Health falls when starving (hunger ≥ 95) or collapsed (energy ≤ 2), recovers when fed and rested. Health 0 = death.
- Happiness eases toward a target built from: having a home, mature trees within 5 tiles of home, evening chats at the campfire, Rook's encouragement, market days, the *cheerful* trait; minus hunger, exhaustion, poor health, debt, and a near-empty granary. A full day below 15% and the inhabitant leaves.

## Day
- 06:00–18:00 work · 18:00–21:30 leisure at the campfire (curious people explore the river) · 21:30–06:00 sleep. Night cancels unfinished work, but nobody drops what they are carrying.
- Crops grow only 06:00–20:00.

## Work
- **Farmer:** harvest ripe fields (3 food, Jenny +2), sow fallow ones, tend growing ones (60% faster growth for 4 h).
- **Gatherer:** pick berries when food is low or wood is plentiful, otherwise chop trees (4 wood each; the tree is gone).
- **Builder:** raise house sites (16 wood, 4 hours of work), fetch lumber, chop when the stockpile is empty.
- **Laborer:** whatever is short — food first, then lumber, then fields.
- **Rook (Leader):** builds when there is a site, otherwise walks over and encourages a worker (+20% work speed for 4 h). When food runs low he rallies everyone to food work.
- **Doctor (Merchant):** runs the market stall. He sells every meal for 1 coin and buys produce and labor from his purse. When his purse reaches 25 he declares a market day: free meals. Nobody else gets paid if Doctor is broke. Coins are conserved.

## Settlement
- When free beds drop to one or fewer, Rook starts a new house near the village.
- At 08:00 a traveler arrives if there is a free bed, food ≥ 2 per person, and average happiness ≥ 50. They take the occupation the village is shortest on.
- At dawn, grain beyond 6 per person spoils at 15%.

## Player
- Plant tree (grows in ~2 days) · Build house (marks a site; builders still need 16 wood) · Till field (2×2) · Add food (+20) · pause and speed.
