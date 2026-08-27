import { describe, expect, it, vi } from "vitest";

import type { ArenaAnimationEvent } from "../arena";
import {
  SFX_EFFECTS,
  createSfxEngine,
  effectForAnimation,
  readSfxSettings,
  summonAnnouncementPlan,
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
    expect(SFX_EFFECTS).toHaveLength(17);
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

  it("calls the monster name, then schedules the warp through the SFX engine", async () => {
    const spoken: SpeechSynthesisUtterance[] = [];
    const engine = createSfxEngine({
      audioContextFactory: fakeAudioContext,
      storage: null,
      speechSynthesis: {
        cancel: vi.fn(),
        speak: (utterance) => spoken.push(utterance),
      },
      speechUtteranceFactory: (text) => ({ text } as SpeechSynthesisUtterance),
    });

    await engine.unlock();
    engine.announceSummon("Stone Bull", "summon");

    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatchObject({
      text: "Stone Bull!",
      pitch: 0.62,
      rate: 0.82,
      volume: 0.32,
    });
    spoken[0].onend?.(new Event("end") as SpeechSynthesisEvent);
    expect(engine.getDebugState().effectCounts["summon-warp"]).toBe(1);

    engine.playAnimation({ type: "summon", monsterId: "stone-bull" });
    expect(engine.getDebugState().effectCounts.summon).toBe(0);
    engine.dispose();
  });

  it("does not speak or schedule the warp while sound is muted", async () => {
    const speak = vi.fn();
    const engine = createSfxEngine({
      audioContextFactory: fakeAudioContext,
      storage: null,
      speechSynthesis: { cancel: vi.fn(), speak },
      speechUtteranceFactory: (text) => ({ text } as SpeechSynthesisUtterance),
    });

    await engine.unlock();
    engine.setMuted(true);
    engine.announceSummon("Stone Bull", "fusion");
    expect(speak).not.toHaveBeenCalled();
    expect(engine.getDebugState().effectCounts["summon-warp"]).toBe(0);
    engine.dispose();
  });

  it("keeps the announcer voice settings in one testable plan", () => {
    expect(summonAnnouncementPlan("Steam Beast")).toEqual({
      text: "Steam Beast!",
      pitch: 0.62,
      rate: 0.82,
    });
  });
});

function fakeAudioContext(): AudioContext {
  const parameter = () => ({
    value: 0,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const oscillator = () => ({
    ...node(),
    type: "sine",
    frequency: parameter(),
    detune: parameter(),
    start: vi.fn(),
    stop: vi.fn(),
    addEventListener: vi.fn(),
  });

  return {
    state: "running",
    currentTime: 0,
    sampleRate: 44_100,
    destination: node(),
    createGain: () => ({ ...node(), gain: parameter() }),
    createOscillator: oscillator,
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn(),
    }),
    createBiquadFilter: () => ({
      ...node(),
      type: "lowpass",
      frequency: parameter(),
      Q: parameter(),
    }),
    resume: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as AudioContext;
}
