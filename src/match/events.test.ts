import { describe, expect, it } from "vitest";

import { SPELLS } from "../cards/catalog";
import type { PendingSpell, PendingStackItem } from "../rules/core";
import { resolveStackEvents } from "./events";

describe("match stack event binding", () => {
  it("reports a countered summon without treating it as resolved", () => {
    const summon: PendingStackItem = {
      stackId: "summon",
      kind: "summon",
      controller: "player-1",
      card: {
        instanceId: "monster",
        name: "Monster",
        kind: "monster",
        category: "base-monster",
        element: "fire",
        attack: 2,
        health: 1,
        level: 1,
      },
    };
    const counter = counterspell("counter", "summon", "player-2");

    const result = resolveStackEvents([summon, counter]);

    expect(result.resolved.map((item) => item.stackId)).toEqual(["counter"]);
    expect(result.countered.map((item) => item.stackId)).toEqual(["summon"]);
  });

  it("handles counter-the-counter in reverse stack order", () => {
    const original: PendingSpell = {
      ...spell("destroy", "destroy"),
      target: {
        kind: "monster",
        playerId: "player-2",
        monsterId: "target",
      },
    };
    const firstCounter = counterspell("counter-1", "destroy", "player-2");
    const secondCounter = counterspell(
      "counter-2",
      "counter-1",
      "player-1",
    );

    const result = resolveStackEvents([
      original,
      firstCounter,
      secondCounter,
    ]);

    expect(result.resolved.map((item) => item.stackId)).toEqual([
      "counter-2",
      "destroy",
    ]);
    expect(result.countered.map((item) => item.stackId)).toEqual([
      "counter-1",
    ]);
  });
});

function counterspell(
  stackId: string,
  targetStackId: string,
  controller: PendingSpell["controller"],
): PendingSpell {
  return {
    ...spell("counterspell", stackId),
    controller,
    target: null,
    targetStackId,
  };
}

function spell(
  id: "destroy" | "counterspell",
  stackId: string,
): Omit<PendingSpell, "target"> {
  const definition = SPELLS.find((card) => card.id === id);
  if (!definition) {
    throw new Error(`Missing spell: ${id}`);
  }
  return {
    stackId,
    kind: "spell",
    controller: "player-1",
    card: { ...definition, instanceId: `${stackId}-card` },
    targetStackId: null,
  };
}
