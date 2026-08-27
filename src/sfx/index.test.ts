import { describe, expect, it } from "vitest";

import type { ArenaAnimationEvent } from "../arena";
import {
  SFX_EFFECTS,
  createSfxEngine,
  effectForAnimation,
  readSfxSettings,
} from "./index";

describe("procedural sound effects", () => {
  it("maps every arena animation to a sound signature", () => {
    const events: readonly ArenaAnimationEvent[] = [
      { type: "summon", monsterId: "monster" },
      { type: "attack", attackerId: "monster", target: { kind: "side", side: "opponent" } },
      { type: "hit", monsterId: "monster" },
      { type: "death", monsterId: "monster" },
      { type: "fusion", sourceIds: ["one", "two"], resultId: "fusion" },
      { type: "fusion", sourceIds: ["one", "two"], resultId: "fusion", variant: "star3" },
      { type: "spell", spell: "bolt", source: { kind: "side", side: "player" } },
      { type: "spell", spell: "destroy", source: { kind: "side", side: "player" } },
      { type: "spell", spell: "draw", source: { kind: "side", side: "player" } },
      { type: "spell", spell: "counterspell", source: { kind: "side", side: "player" } },
      { type: "burst", source: { kind: "side", side: "player" }, target: { kind: "side", side: "opponent" } },
    ];

    expect(events.map(effectForAnimation)).toEqual([
      "summon",
      "attack",
      "hit",
      "death",
      "fusion",
      "fusion-star3",
      "spell-bolt",
      "spell-destroy",
      "spell-draw",
      "spell-counterspell",
      "spell-bolt",
    ]);
  });

  it("keeps the full required one-shot roster explicit", () => {
    expect(SFX_EFFECTS).toHaveLength(16);
    expect(new Set(SFX_EFFECTS).size).toBe(SFX_EFFECTS.length);
  });

  it("loads, clamps, and falls back from persisted settings", () => {
    expect(readSfxSettings(null)).toEqual({ muted: false, volume: 0.32 });
    expect(readSfxSettings({
      getItem: () => JSON.stringify({ muted: true, volume: 4 }),
    })).toEqual({ muted: true, volume: 1 });
    expect(readSfxSettings({ getItem: () => "not-json" })).toEqual({
      muted: false,
      volume: 0.32,
    });
  });

  it("does nothing safely before the first gesture", () => {
    const engine = createSfxEngine({ storage: null });
    for (const effect of SFX_EFFECTS) {
      expect(() => engine.play(effect)).not.toThrow();
    }
    engine.setAmbientMonsterCount(3);
    expect(engine.getDebugState()).toMatchObject({
      ambientMonsterCount: 3,
      contextState: "uninitialized",
      initialized: false,
    });
    engine.dispose();
  });
});
