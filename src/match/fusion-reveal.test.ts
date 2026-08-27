import { describe, expect, it } from "vitest";

import { BASE_MONSTERS, FUSION_MONSTERS } from "../cards/catalog";
import type { PendingFusionSummon } from "../rules/core";
import { fusionRevealFromEvent } from "./fusion-reveal";

describe("fusion reveal data", () => {
  it("preserves the consumed monsters and resolved fusion card", () => {
    const emberImp = BASE_MONSTERS.find((card) => card.id === "ember-imp");
    const tideSerpent = BASE_MONSTERS.find((card) => card.id === "tide-serpent");
    const steamBeast = FUSION_MONSTERS.find((card) => card.id === "steam-beast");
    if (!emberImp || !tideSerpent || !steamBeast) {
      throw new Error("Missing fusion fixture cards");
    }
    const event: PendingFusionSummon = {
      stackId: "fusion-1",
      kind: "fusion",
      controller: "player-1",
      card: { ...steamBeast, instanceId: "steam-beast-1" },
    };

    expect(fusionRevealFromEvent([emberImp, tideSerpent], event)).toEqual({
      sources: [
        { name: "Ember Imp", element: "fire" },
        { name: "Tide Serpent", element: "water" },
      ],
      result: event.card,
    });
  });
});
