# Automatic draw transition

## Decision

The rules core draws for a new turn and then enters main phase in one state
transition. The first player enters first-turn main phase without drawing.

## Why

Draw has no legal choice. Leaving it as a client-advanced phase made the
browser responsible for moving an authoritative game forward. That creates a
bad failure mode online: a reconnecting client, the server snapshot, and a
decision timer can disagree about whether the match is waiting for input.

The rules core already owns deck order, deck-out, turns, and phases. It now
owns this mandatory transition too. AI, hotseat, and online matches all read
the same resulting main-phase state.

## Consequences

If the deck is empty, the core records deck-out while the turn transition is
still in progress and never publishes a new main phase. The online room manager
therefore has no draw-phase intent to validate or timer to schedule. It sends
the same authoritative snapshot to both clients, including after reconnect.

The renderer compares consecutive states, so it still sees the hand and deck
change and plays the draw animation and new-card highlight without delaying
input. Hotseat's existing handoff curtain still reacts to the changed active
player, keeping the new hand private until the next player takes the device.
