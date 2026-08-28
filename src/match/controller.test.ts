// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import {
  assembleDeck,
  deriveExtraDeck,
  type ArchetypeId,
  type BaseMonsterId,
  type BaseMonsterCard,
} from "../cards/catalog";
import { createArenaScene } from "../arena";
import {
  createMatch,
  getPlayer,
  type LandCard,
  type LandPermanent,
  type MatchState,
  type MonsterPermanent,
  type PendingStackItem,
  type PlayerId,
} from "../rules/core";
import {
  cardKeywordMarkup,
  blockerPromptMarkup,
  createFusionUpgradeOption,
  mountMatch,
  responseWindowMessage,
  TARGETING_TIMEOUT_MS,
  type OnlineMatchAdapter,
  type OnlineMatchUpdate,
} from "./controller";
import { AI_PRESENTATION_BEAT_MS } from "./ai-presentation";

vi.mock("../card-art", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../card-art")>();
  return {
    ...actual,
    createCardArtRenderer: () => ({
      render: () => "data:image/png;base64,",
      dispose: () => {},
    }),
  };
});

describe("response window messages", () => {
  it("attributes spells, summons, and fusions to the opponent", () => {
    expect(responseWindowMessage(pendingSpell(), "ai")).toBe(
      "Your opponent has cast Bolt.",
    );
    expect(responseWindowMessage(pendingSummon(), "ai")).toBe(
      "Your opponent has summoned Stone Bull.",
    );
    expect(responseWindowMessage(pendingFusion(), "ai")).toBe(
      "Your opponent is fusing Ember Imp + Tide Serpent.",
    );
  });

  it("uses player numbers in hotseat", () => {
    expect(responseWindowMessage(pendingSpell(), "hotseat")).toBe(
      "Player 2 has cast Bolt.",
    );
    expect(responseWindowMessage(pendingSpell("player-1"), "hotseat")).toBe(
      "Player 1 has cast Bolt.",
    );
  });
});

describe("fusion upgrade prompt options", () => {
  it("keeps the consumed base and upgraded fusion identities separate", () => {
    const baseMonster = assembleDeck("fire-water").find(
      (candidate): candidate is BaseMonsterCard =>
        candidate.kind === "monster" &&
        candidate.category === "base-monster" &&
        candidate.name === "Ember Imp",
    );
    const fusion = deriveExtraDeck("fire-water").find(
      (candidate) => candidate.name === "Steam Beast",
    );
    if (!baseMonster || !fusion) {
      throw new Error("Missing fusion upgrade fixtures");
    }

    expect(createFusionUpgradeOption(fusion, baseMonster)).toEqual({
      fusionId: fusion.instanceId,
      fusionName: "Steam Beast",
      fusionPortraitId: "Steam Beast",
      baseMonsterId: baseMonster.instanceId,
      baseMonsterName: "Ember Imp",
      baseMonsterPortraitId: "Ember Imp",
    });
  });
});

describe("VS AI arena reconciliation", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("places the human Moss Tortoise after the AI resolves its response", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.append(root);
    const arena = createArenaScene(16 / 9);
    const controller = mountMatch(root, arena, {
      mode: "ai",
      playerOneArchetype: "fire-earth",
      initialState: humanMossTortoiseSummonState(),
    });

    click(root, '[data-card-id="summon-moss-tortoise"]');
    expect(controller.getState().responsePlayer).toBe("player-2");

    // A delayed retirement can leave a renderer-only object in the final
    // player slot while rules still permits this summon.
    arena.placeMonster(
      "retired-player-animation-object",
      { side: "player", slot: 2 },
      new THREE.Group(),
    );

    vi.advanceTimersByTime(360);

    const moss = getPlayer(controller.getState(), "player-1").monsters.find(
      (monster) => monster.card.instanceId === "summon-moss-tortoise",
    );
    expect(moss?.card.name).toBe("Moss Tortoise");
    const arenaMoss = arena.getMonster(moss?.card.instanceId ?? "");
    expect(arenaMoss?.userData.monsterId).toBe(moss?.card.instanceId);
    expect(
      arenaMoss?.getObjectByName("summoning-sickness-indicator"),
    ).toBeTruthy();
    expect(arena.getMonster("retired-player-animation-object")).toBeUndefined();

    controller.dispose();
  });

  it.each([
    ["Moss Tortoise", "moss-tortoise"],
    ["Stone Bull", "stone-bull"],
  ])(
    "places a resolved AI %s after clearing a retired object from its last slot",
    (name, cardId) => {
      vi.useFakeTimers();
      const root = document.createElement("div");
      document.body.append(root);
      const arena = createArenaScene(16 / 9);
      const controller = mountMatch(root, arena, {
        mode: "ai",
        initialState: aiSummonState(cardId),
      });

      vi.advanceTimersByTime(360);
      expect(controller.getState().responsePlayer).toBe("player-1");
      expect(root.querySelector('[data-action="pass-response"]')).toBeNull();
      vi.advanceTimersByTime(AI_PRESENTATION_BEAT_MS);

      // This mirrors a retired animation object that has survived its rules
      // permanent and would have made the old firstOpenSlot() path silently
      // skip the resolved summon.
      arena.placeMonster(
        "retired-animation-object",
        { side: "opponent", slot: 2 },
        new THREE.Group(),
      );

      click(root, '[data-action="pass-response"]');

      const summoned = getPlayer(controller.getState(), "player-2").monsters.find(
        (monster) => monster.card.instanceId === `summon-${cardId}`,
      );
      expect(summoned?.card.name).toBe(name);
      const arenaMonster = arena.getMonster(summoned?.card.instanceId ?? "");
      expect(arenaMonster).toBeTruthy();
      expect(
        arenaMonster?.getObjectByName("summoning-sickness-indicator"),
      ).toBeTruthy();
      expect(arena.getMonster("retired-animation-object")).toBeUndefined();

      controller.dispose();
    },
  );
});

describe("authoritative scene reconciliation", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it.each(["ai", "hotseat"] as const)(
    "places every monster from an initial %s snapshot exactly once",
    (mode) => {
      const root = document.createElement("div");
      document.body.append(root);
      const arena = createArenaScene(16 / 9);
      const state = authoritativeMossState();
      const controller = mountMatch(root, arena, { mode, initialState: state });

      expect(occupiedMonsterIds(arena)).toEqual(["authoritative-moss"]);
      expect(arena.getMonsterIds().filter((id) => id === "authoritative-moss")).toHaveLength(1);

      controller.dispose();
    },
  );

  it("does not let delayed death cleanup remove a monster restored by an online snapshot", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.append(root);
    const arena = createArenaScene(16 / 9);
    const live = authoritativeMossState();
    const adapter = new TestOnlineAdapter(live);
    const controller = mountMatch(root, arena, {
      mode: "online",
      online: adapter,
      playerOneArchetype: "fire-earth",
      playerTwoArchetype: "earth-lightning",
    });

    expect(occupiedMonsterIds(arena)).toEqual(["authoritative-moss"]);
    const moss = getPlayer(live, "player-1").monsters[0];
    if (!moss) throw new Error("Missing authoritative Moss Tortoise");
    const retired = withPlayer(live, "player-1", {
      monsters: [],
      discardPile: [...getPlayer(live, "player-1").discardPile, moss.card],
    });
    adapter.publish({ state: retired });
    expect(occupiedMonsterIds(arena)).toEqual([]);

    adapter.publish({ state: live });
    expect(occupiedMonsterIds(arena)).toEqual(["authoritative-moss"]);
    vi.advanceTimersByTime(950);
    expect(occupiedMonsterIds(arena)).toEqual(["authoritative-moss"]);
    expect(arena.getMonster("authoritative-moss")).toBeTruthy();

    controller.dispose();
  });
});

describe("hand-card keywords", () => {
  it("labels Flying and Reach cards without labeling ordinary cards", () => {
    const deck = assembleDeck("fire-lightning");
    const voltBat = deck.find((card) => card.kind === "monster" && card.name === "Volt Bat");
    const cinderWall = deck.find((card) => card.kind === "monster" && card.name === "Cinder Wall");
    const emberImp = deck.find((card) => card.kind === "monster" && card.name === "Ember Imp");
    if (!voltBat || !cinderWall || !emberImp) throw new Error("Missing keyword fixtures");

    expect(cardKeywordMarkup(voltBat)).toContain("FLYING");
    expect(cardKeywordMarkup(cinderWall)).toContain("REACH");
    expect(cardKeywordMarkup(emberImp)).toBe("");
  });
});

describe("blocker selection guidance", () => {
  it("offers Reach and Flying against Flying while excluding ground-only blockers", () => {
    const deck = assembleDeck("fire-lightning");
    const attacker = deck.find((card): card is BaseMonsterCard =>
      card.kind === "monster" && card.category === "base-monster" && card.id === "volt-bat");
    const reach = deck.find((card): card is BaseMonsterCard =>
      card.kind === "monster" && card.category === "base-monster" && card.id === "cinder-wall");
    const ground = deck.find((card): card is BaseMonsterCard =>
      card.kind === "monster" && card.category === "base-monster" && card.id === "ember-imp");
    if (!attacker || !reach || !ground) throw new Error("Missing blocker UI fixtures");

    let state = createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
    state = { ...state, activePlayer: "player-1", phase: "combat", turnNumber: 3 };
    state = withPlayer(state, "player-1", { monsters: [permanent(attacker, "flying-attacker")] });
    state = withPlayer(state, "player-2", {
      monsters: [permanent(reach, "reach-blocker"), permanent(attacker, "flying-blocker"), permanent(ground, "ground-blocker")],
    });
    const declaration = {
      attackingPlayer: "player-1" as const,
      defendingPlayer: "player-2" as const,
      turnNumber: 3,
      attackerIds: ["flying-attacker"],
    };

    document.body.innerHTML = blockerPromptMarkup(state, declaration, getPlayer(state, "player-2").monsters);
    const options = [...document.querySelectorAll<HTMLOptionElement>('[data-block-attacker="flying-attacker"] option')]
      .map((option) => option.value);

    expect(options).toContain("reach-blocker");
    expect(options).toContain("flying-blocker");
    expect(options).not.toContain("ground-blocker");
  });
});

describe("contextual tutorials", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("explains the free mulligan and exposes monster rules from the hand", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const deck = assembleDeck("fire-lightning");
    const voltBat = deck.find(
      (card): card is BaseMonsterCard =>
        card.kind === "monster" &&
        card.category === "base-monster" &&
        card.name === "Volt Bat",
    );
    if (!voltBat) throw new Error("Missing Volt Bat fixture");
    const base = createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
    const state: MatchState = {
      ...base,
      players: [
        { ...base.players[0], hand: [voltBat] },
        base.players[1],
      ],
    };
    const controller = mountMatch(root, createArenaScene(16 / 9), {
      mode: "ai",
      playerOneArchetype: "fire-lightning",
      initialState: state,
    });

    expect(root.querySelector("[data-testid=mulligan-prompt]")?.textContent).toContain(
      "replace all four cards once",
    );
    const trigger = root.querySelector<HTMLElement>(
      `[data-monster-tooltip-card-id="${voltBat.instanceId}"]`,
    );
    trigger?.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 120,
      clientY: 160,
    }));

    const tooltip = root.querySelector<HTMLElement>("[data-testid=monster-tooltip]");
    expect(tooltip?.hidden).toBe(false);
    expect(tooltip?.textContent).toContain("Volt Bat");
    expect(tooltip?.textContent).toContain("IN HAND");
    expect(tooltip?.textContent).toContain(
      "Flying: Can be blocked only by Flying or Reach creatures.",
    );
    controller.dispose();
  });

  it("exposes fusion rules from the extra deck", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const controller = mountMatch(root, createArenaScene(16 / 9), {
      mode: "ai",
      playerOneArchetype: "fire-water",
    });
    const trigger = root.querySelector<HTMLElement>(
      ".extra-card[data-monster-tooltip-card-id]",
    );
    trigger?.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 160,
      clientY: 140,
    }));

    const tooltip = root.querySelector<HTMLElement>("[data-testid=monster-tooltip]");
    expect(tooltip?.hidden).toBe(false);
    expect(tooltip?.textContent).toContain("EXTRA DECK");
    expect(tooltip?.textContent).toContain(
      "Trample: excess combat damage hits the defending player.",
    );
    controller.dispose();
  });

  it("keeps phase guidance visible and renders each land as a ready or used card", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const deck = assembleDeck("fire-water");
    const land = deck.find(
      (card): card is LandCard => card.kind === "land" && card.element === "fire",
    );
    if (!land) throw new Error("Missing Fire land fixture");
    const base = createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
    const state = withPlayer(
      { ...base, activePlayer: "player-1", phase: "main", turnNumber: 2 },
      "player-1",
      {
        hand: [{ ...land, instanceId: "land-in-hand" }],
        lands: [
          readyLand(land, "ready-land-1"),
          { ...readyLand(land, "used-land-1"), ready: false },
        ],
        landPlayedThisTurn: false,
        mulliganDecision: "kept",
      },
    );
    const controller = mountMatch(root, createArenaScene(16 / 9), {
      mode: "ai",
      initialState: state,
    });

    expect(root.querySelector("[data-testid=phase-guidance]")?.textContent).toContain(
      "play one land each turn",
    );
    const tableau = root.querySelector(".land-tableau-player");
    expect(tableau?.getAttribute("aria-label")).toBe("Your lands");
    expect(tableau?.querySelector(".land-count")?.textContent).toBe("2 LANDS");
    expect(tableau?.querySelector(".land-ready-count")?.textContent).toBe("1 READY");
    expect(tableau?.querySelectorAll(".land-permanent")).toHaveLength(2);
    expect(tableau?.querySelectorAll(".land-permanent.is-ready")).toHaveLength(1);
    expect(tableau?.querySelectorAll(".land-permanent.is-used")).toHaveLength(1);
    expect(tableau?.querySelector('[data-land-id="ready-land-1"] img')?.getAttribute("src"))
      .toContain("data:image/svg+xml");
    expect(tableau?.querySelector('[data-land-id="used-land-1"]')?.getAttribute("aria-label"))
      .toBe("Fire Land, used");
    controller.dispose();
  });
});

describe("spell targeting guidance", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("offers only opposing targets and expires after 15 seconds", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.append(root);
    const controller = mountMatch(root, createArenaScene(16 / 9), {
      mode: "ai",
      initialState: spellTargetingState(),
    });

    click(root, '[data-card-id="targeting-bolt"]');

    const friendlyMonster = root.querySelector<HTMLElement>(
      '[data-action="target-monster"][data-owner="player-1"]',
    );
    const friendlyPlayer = root.querySelector<HTMLElement>(
      '[data-action="target-player"][data-player-id="player-1"]',
    );
    const enemy = root.querySelector<HTMLElement>(
      '[data-action="target-monster"][data-owner="player-2"]',
    );
    expect(friendlyMonster).toBeNull();
    expect(friendlyPlayer).toBeNull();
    expect(enemy?.classList.contains("is-lethal-target")).toBe(true);
    expect(root.querySelector(".targeting-timeout-note")?.textContent).toContain(
      "15 seconds",
    );

    vi.advanceTimersByTime(TARGETING_TIMEOUT_MS - 1);
    expect(root.querySelector("[data-testid=targeting-prompt]")).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(root.querySelector("[data-testid=targeting-prompt]")).toBeNull();
    expect(root.querySelector(".notice")?.textContent).toContain(
      "targeting expired after 15 seconds",
    );
    controller.dispose();
  });

  it("previews the real board target and clears the line on cancel", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const controller = mountMatch(root, createArenaScene(16 / 9), {
      mode: "ai",
      initialState: spellTargetingState(),
    });
    click(root, '[data-card-id="targeting-bolt"]');

    const source = root.querySelector<HTMLElement>(
      '[data-card-id="targeting-bolt"]',
    );
    const target = root.querySelector<HTMLElement>(
      '[data-action="board-card"][data-monster-id="targeting-enemy"]',
    );
    const option = root.querySelector<HTMLElement>(
      '[data-action="target-monster"][data-monster-id="targeting-enemy"]',
    );
    if (!source || !target || !option) {
      throw new Error("Missing targeting preview fixtures");
    }
    setRect(source, 120, 560, 110, 150);
    setRect(target, 690, 130, 120, 70);
    option.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 780,
      clientY: 330,
    }));

    const layer = root.querySelector<SVGElement>(".target-preview-layer");
    expect(layer?.hasAttribute("hidden")).toBe(false);
    expect(root.querySelector(".target-preview-path")?.getAttribute("d")).toContain(
      "750 165",
    );

    click(root, '[data-action="cancel-target"]');
    expect(layer?.hasAttribute("hidden")).toBe(true);
    controller.dispose();
  });
});

describe("Reach beast fusion prompts", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each([
    {
      archetype: "fire-water" as const,
      first: "ember-imp" as const,
      second: "cinder-wall" as const,
      expected: "Inferno Beast",
    },
    {
      archetype: "fire-earth" as const,
      first: "stone-bull" as const,
      second: "moss-tortoise" as const,
      expected: "Golem Beast",
    },
  ])(
    "offers $expected when $second is one of the parents",
    ({ archetype, first, second, expected }) => {
      const root = document.createElement("div");
      document.body.append(root);
      const controller = mountMatch(root, createArenaScene(16 / 9), {
        mode: "ai",
        playerOneArchetype: archetype,
        initialState: reachFusionState(archetype, first, second),
      });

      const prompt = root.querySelector<HTMLElement>("[data-testid=fusion-prompt]");
      expect(prompt?.textContent).toContain(expected);
      expect(prompt?.textContent).toContain("Both beasts are consumed");
      controller.dispose();
    },
  );

  it("explains that a spent fusion result cannot be summoned again", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const state = reachFusionState(
      "fire-water",
      "ember-imp",
      "cinder-wall",
      "Inferno Beast",
    );
    const controller = mountMatch(root, createArenaScene(16 / 9), {
      mode: "ai",
      playerOneArchetype: "fire-water",
      initialState: state,
    });

    expect(root.querySelector("[data-testid=fusion-prompt]")).toBeNull();
    const inferno = [...root.querySelectorAll<HTMLElement>(".extra-card")].find(
      (card) => card.textContent?.includes("Inferno Beast"),
    );
    expect(inferno?.classList.contains("is-spent")).toBe(true);
    inferno?.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 120,
      clientY: 140,
    }));
    expect(root.querySelector("[data-testid=monster-tooltip]")?.textContent).toContain(
      "Already used: this fusion cannot be summoned from the extra deck again this match.",
    );
    controller.dispose();
  });
});

function pendingSpell(controller: "player-1" | "player-2" = "player-2"): PendingStackItem {
  const card = assembleDeck("fire-water").find(
    (candidate) => candidate.kind === "spell" && candidate.id === "bolt",
  );
  if (!card || card.kind !== "spell") throw new Error("Missing Bolt fixture");
  return {
    stackId: "bolt",
    kind: "spell",
    controller,
    card,
    target: { kind: "player", playerId: "player-1" },
    targetStackId: null,
  };
}

function pendingSummon(): PendingStackItem {
  const card = assembleDeck("earth-lightning").find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.name === "Stone Bull",
  );
  if (!card) throw new Error("Missing Stone Bull fixture");
  return { stackId: "stone-bull", kind: "summon", controller: "player-2", card };
}

function pendingFusion(): PendingStackItem {
  const card = deriveExtraDeck("fire-water").find(
    (candidate) => candidate.name === "Steam Beast",
  );
  if (!card) throw new Error("Missing Steam Beast fixture");
  return {
    stackId: "steam-beast",
    kind: "fusion",
    controller: "player-2",
    card,
    parentNames: ["Ember Imp", "Tide Serpent"],
  };
}

function aiSummonState(cardId: string): MatchState {
  const deck = assembleDeck("earth-lightning");
  const summonCard = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === cardId,
  );
  const stoneBull = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "stone-bull",
  );
  const sparkLynx = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "spark-lynx",
  );
  const earthLand = deck.find(
    (candidate): candidate is LandCard =>
      candidate.kind === "land" && candidate.element === "earth",
  );
  if (!summonCard || !stoneBull || !sparkLynx || !earthLand) {
    throw new Error("Missing deterministic AI summon fixtures");
  }

  const state = createMatch({
    playerOneDeck: assembleDeck("fire-water"),
    playerTwoDeck: deck,
    playerOneExtraDeck: deriveExtraDeck("fire-water"),
    playerTwoExtraDeck: deriveExtraDeck("earth-lightning"),
    firstPlayer: "player-2",
  });
  return withPlayer({ ...state, activePlayer: "player-2", phase: "main", turnNumber: 5 }, "player-2", {
    hand: [{ ...summonCard, instanceId: `summon-${cardId}` }],
    lands: [readyLand(earthLand, "earth-land-1")],
    monsters: [
      permanent(stoneBull, "ai-stone-bull"),
      permanent(sparkLynx, "ai-spark-lynx"),
    ],
    landPlayedThisTurn: true,
  });
}

function humanMossTortoiseSummonState(): MatchState {
  const deck = assembleDeck("fire-earth");
  const mossTortoise = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "moss-tortoise",
  );
  const cinderWall = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "cinder-wall",
  );
  const stoneBull = deck.find(
    (candidate): candidate is BaseMonsterCard =>
      candidate.kind === "monster" &&
      candidate.category === "base-monster" &&
      candidate.id === "stone-bull",
  );
  const earthLand = deck.find(
    (candidate): candidate is LandCard =>
      candidate.kind === "land" && candidate.element === "earth",
  );
  if (!mossTortoise || !cinderWall || !stoneBull || !earthLand) {
    throw new Error("Missing deterministic human Moss Tortoise fixtures");
  }

  const state = createMatch({
    playerOneDeck: deck,
    playerTwoDeck: assembleDeck("earth-lightning"),
    playerOneExtraDeck: deriveExtraDeck("fire-earth"),
    playerTwoExtraDeck: deriveExtraDeck("earth-lightning"),
    firstPlayer: "player-1",
  });
  return withPlayer({ ...state, activePlayer: "player-1", phase: "main", turnNumber: 5 }, "player-1", {
    hand: [{ ...mossTortoise, instanceId: "summon-moss-tortoise" }],
    lands: [readyLand(earthLand, "human-earth-land-1")],
    monsters: [
      permanent(cinderWall, "human-cinder-wall"),
      permanent(stoneBull, "human-stone-bull"),
    ],
    landPlayedThisTurn: true,
  });
}

function authoritativeMossState(): MatchState {
  const deck = assembleDeck("fire-earth");
  const moss = deck.find(
    (card): card is BaseMonsterCard =>
      card.kind === "monster" && card.category === "base-monster" && card.id === "moss-tortoise",
  );
  if (!moss) throw new Error("Missing authoritative Moss Tortoise fixture");
  let state = createMatch({
    playerOneDeck: deck,
    playerTwoDeck: assembleDeck("earth-lightning"),
    playerOneExtraDeck: deriveExtraDeck("fire-earth"),
    playerTwoExtraDeck: deriveExtraDeck("earth-lightning"),
  });
  state = { ...state, activePlayer: "player-1", phase: "main", turnNumber: 5 };
  state = withPlayer(state, "player-1", {
    monsters: [permanent(moss, "authoritative-moss")],
    mulliganDecision: "kept",
  });
  return withPlayer(state, "player-2", { mulliganDecision: "kept" });
}

function spellTargetingState(): MatchState {
  const deck = assembleDeck("fire-water");
  const bolt = deck.find(
    (card) => card.kind === "spell" && card.id === "bolt",
  );
  const ember = deck.find(
    (card): card is BaseMonsterCard =>
      card.kind === "monster" &&
      card.category === "base-monster" &&
      card.id === "ember-imp",
  );
  const tide = deck.find(
    (card): card is BaseMonsterCard =>
      card.kind === "monster" &&
      card.category === "base-monster" &&
      card.id === "tide-serpent",
  );
  const fireLand = deck.find(
    (card): card is LandCard => card.kind === "land" && card.element === "fire",
  );
  if (!bolt || bolt.kind !== "spell" || !ember || !tide || !fireLand) {
    throw new Error("Missing spell targeting fixtures");
  }

  let state = createMatch({ playerOneDeck: deck, playerTwoDeck: deck });
  state = { ...state, activePlayer: "player-1", phase: "main", turnNumber: 3 };
  state = withPlayer(state, "player-1", {
    hand: [{ ...bolt, instanceId: "targeting-bolt" }],
    lands: [readyLand(fireLand, "targeting-land")],
    monsters: [permanent(ember, "targeting-friendly")],
    landPlayedThisTurn: true,
    mulliganDecision: "kept",
  });
  return withPlayer(state, "player-2", {
    monsters: [permanent(tide, "targeting-enemy")],
    mulliganDecision: "kept",
  });
}

function reachFusionState(
  archetype: ArchetypeId,
  firstId: BaseMonsterId,
  secondId: BaseMonsterId,
  spentFusionName?: string,
): MatchState {
  const deck = assembleDeck(archetype);
  const findBase = (id: BaseMonsterId): BaseMonsterCard => {
    const card = deck.find(
      (candidate): candidate is BaseMonsterCard =>
        candidate.kind === "monster" &&
        candidate.category === "base-monster" &&
        candidate.id === id,
    );
    if (!card) throw new Error(`Missing ${id} fusion fixture`);
    return card;
  };
  const extraDeck = deriveExtraDeck(archetype).filter(
    (card) => card.name !== spentFusionName,
  );
  let state = createMatch({
    playerOneDeck: deck,
    playerTwoDeck: deck,
    playerOneExtraDeck: deriveExtraDeck(archetype),
    playerTwoExtraDeck: deriveExtraDeck(archetype),
  });
  state = { ...state, activePlayer: "player-1", phase: "main", turnNumber: 3 };
  return withPlayer(state, "player-1", {
    hand: [],
    monsters: [
      permanent(findBase(firstId), "reach-fusion-parent-1"),
      permanent(findBase(secondId), "reach-fusion-parent-2"),
    ],
    extraDeck,
    landPlayedThisTurn: true,
    mulliganDecision: "kept",
  });
}

function withPlayer(
  state: MatchState,
  playerId: PlayerId,
  updates: Partial<MatchState["players"][number]>,
): MatchState {
  const index = playerId === "player-1" ? 0 : 1;
  const players = [...state.players] as [MatchState["players"][0], MatchState["players"][1]];
  players[index] = { ...players[index], ...updates };
  return { ...state, players };
}

function readyLand(card: LandCard, instanceId: string): LandPermanent {
  return { card: { ...card, instanceId }, ready: true };
}

function permanent(card: BaseMonsterCard, instanceId: string): MonsterPermanent {
  return {
    card: { ...card, instanceId },
    damage: 0,
    summonedOnTurn: 1,
    summoningSick: false,
  };
}

function click(root: HTMLElement, selector: string): void {
  const button = root.querySelector<HTMLElement>(selector);
  if (!button) throw new Error(`Missing ${selector}`);
  button.click();
}

function occupiedMonsterIds(arena: ReturnType<typeof createArenaScene>): string[] {
  return arena.getMonsterIds().filter((id) => arena.getMonsterZone(id));
}

class TestOnlineAdapter implements OnlineMatchAdapter {
  private readonly listeners = new Set<(update: OnlineMatchUpdate) => void>();

  constructor(private state: MatchState) {}

  getState(): MatchState {
    return this.state;
  }

  localPlayerId(): PlayerId {
    return "player-1";
  }

  subscribe(listener: (update: OnlineMatchUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(update: OnlineMatchUpdate): void {
    if (update.state) this.state = update.state;
    for (const listener of this.listeners) listener(update);
  }

  sendIntent(): void {}
  requestRematch(): void {}
  leaveMatch(): void {}
}

function setRect(
  element: Element,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => new DOMRect(left, top, width, height),
  });
}
