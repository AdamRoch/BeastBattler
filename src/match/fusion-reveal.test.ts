// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { BASE_MONSTERS, FUSION_MONSTERS } from "../cards/catalog";
import type { PendingFusionSummon } from "../rules/core";
import { createFusionRevealOverlay, fusionRevealFromEvent } from "./fusion-reveal";

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

function revealFixture() {
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
  return { data: fusionRevealFromEvent([emberImp, tideSerpent], event) };
}

describe("fusion reveal overlay", () => {
  it("is non-rendered when created and after dismiss, rendered only while shown", () => {
    const root = document.createElement("div");
    const { data } = revealFixture();
    const overlay = createFusionRevealOverlay(root, () => "portrait.png");
    const element = root.querySelector<HTMLElement>('[data-testid="fusion-reveal"]');
    if (!element) {
      throw new Error("Overlay element not mounted");
    }

    // Regression: a CSS `display: grid` rule on .fusion-reveal-overlay used to
    // defeat the `hidden` attribute, leaving a full-screen click-capturing
    // overlay over the match at all times.
    expect(element.hidden).toBe(true);
    expect(element.style.display).toBe("none");

    overlay.show(data);
    expect(element.hidden).toBe(false);
    expect(element.style.display).toBe("grid");

    overlay.dismiss();
    expect(element.hidden).toBe(true);
    expect(element.style.display).toBe("none");
    expect(element.childElementCount).toBe(0);
  });
});
