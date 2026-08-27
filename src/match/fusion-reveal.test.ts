// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { BASE_MONSTERS, FUSION_MONSTERS } from "../cards/catalog";
import type { MonsterPermanent, PendingFusionSummon } from "../rules/core";
import {
  createFusionRevealOverlay,
  fusionRevealFromEvent,
  upgradeRevealsFromTransition,
} from "./fusion-reveal";

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
      parentNames: [emberImp.name, tideSerpent.name],
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

describe("level 3 upgrade reveal data", () => {
  it("triggers only for the permanent that changed from level 2 to level 3", () => {
    const { levelTwo, levelThree } = upgradeFixture();

    expect(upgradeRevealsFromTransition([levelTwo], [levelThree])).toEqual([
      { result: levelThree.card },
    ]);
    expect(upgradeRevealsFromTransition([levelThree], [levelThree])).toEqual([]);
  });

  it("keeps the upgraded card's final name, stars, and stats for the reveal", () => {
    const { levelTwo, levelThree } = upgradeFixture();
    const root = document.createElement("div");
    const overlay = createFusionRevealOverlay(root, () => "portrait.png");
    const reveal = upgradeRevealsFromTransition([levelTwo], [levelThree])[0];
    if (!reveal) {
      throw new Error("Missing level 3 reveal fixture");
    }

    overlay.showUpgrade(reveal);

    const element = root.querySelector<HTMLElement>('[data-testid="fusion-reveal"]');
    expect(element?.textContent).toContain("Level 3 Beast Created!");
    expect(element?.textContent).toContain("Steam Beast");
    expect(element?.textContent).toContain("★★★");
    expect(element?.textContent).toContain("4 ATK · 4 HP");
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
    parentNames: [emberImp.name, tideSerpent.name],
  };
  return { data: fusionRevealFromEvent([emberImp, tideSerpent], event) };
}

function upgradeFixture(): {
  levelTwo: MonsterPermanent;
  levelThree: MonsterPermanent;
} {
  const steamBeast = FUSION_MONSTERS.find((card) => card.id === "steam-beast");
  if (!steamBeast) {
    throw new Error("Missing upgrade fixture card");
  }
  const levelTwoCard = { ...steamBeast, instanceId: "steam-beast-1" };
  const levelTwo: MonsterPermanent = {
    card: levelTwoCard,
    damage: 1,
    summonedOnTurn: 2,
    summoningSick: false,
  };
  return {
    levelTwo,
    levelThree: {
      ...levelTwo,
      card: {
        ...levelTwoCard,
        attack: levelTwoCard.attack + 1,
        health: levelTwoCard.health + 1,
        level: 3,
      },
    },
  };
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

    const { levelTwo, levelThree } = upgradeFixture();
    const upgrade = upgradeRevealsFromTransition([levelTwo], [levelThree])[0];
    if (!upgrade) {
      throw new Error("Missing level 3 reveal fixture");
    }

    overlay.showUpgrade(upgrade);
    expect(element.hidden).toBe(false);
    expect(element.style.display).toBe("grid");

    overlay.dismiss();
    expect(element.hidden).toBe(true);
    expect(element.style.display).toBe("none");
  });
});
