# Flying and Reach base creature roles

## Status

Accepted

## Decision

Volt Bat and Gale Hawk have Flying. Cinder Wall and Moss Tortoise have Reach. A Flying attacker can be blocked only by Flying or Reach. Flying and Reach do not alter blocks against ground attackers.

These roles exist only on base creatures. Fusing or upgrading consumes the base card and does not copy its role. Fusion cards retain only their own Burst or Slow keyword.

## Archetype coverage

Every two-element deck can answer Flying:

| Archetype element | Answer |
|---|---|
| Fire | Cinder Wall, Reach |
| Earth | Moss Tortoise, Reach |
| Air | Gale Hawk, Flying |
| Lightning | Volt Bat, Flying |

Water has no Flying or Reach base creature. That is safe because V1 has no mono-Water archetype, so every Water pair includes Fire, Earth, Air, or Lightning.

## Consequences

Combat legality stays in the shared rules engine. The UI and AI use that same legality check, while the server remains the authority for online matches.
