import { describe, expect, it, vi } from "vitest";

import type { ArenaAnimationEvent } from "../arena";
import {
  SFX_EFFECTS,
  type AnnouncerAudioElement,
  createSfxEngine,
  effectForAnimation,
  readSfxSettings,
} from "./index";
import { ANNOUNCER_CLIPS, announcerLineForMonster } from "./announcer";
import { BASE_MONSTERS, FUSION_MONSTERS } from "../cards/catalog";

describe("procedural sound effects", () => {
  it("maps every arena animation to a sound signature", () => {
    const events: readonly ArenaAnimationEvent[] = [
      { type: "summon", monsterId: "monster" },
      { type: "combat-link", attackerId: "monster", target: { kind: "side", side: "opponent" } },
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
    expect(readSfxSettings(null)).toEqual({
      muted: false,
      volume: 1,
      musicVolume: 1,
      voiceVolume: 1,
      effectsVolume: 1,
    });
    expect(readSfxSettings({
      getItem: () => JSON.stringify({ muted: true, volume: 4 }),
    })).toEqual({
      muted: true,
      volume: 1,
      musicVolume: 1,
      voiceVolume: 1,
      effectsVolume: 1,
    });
    expect(readSfxSettings({ getItem: () => "not-json" })).toEqual({
      muted: false,
      volume: 1,
      musicVolume: 1,
      voiceVolume: 1,
      effectsVolume: 1,
    });
  });

  it("multiplies channels with the master setting and persists them", async () => {
    const music = fakeBackgroundMusic();
    const storage = fakeStorage();
    const { audios, factory } = fakeAnnouncerAudio();
    const engine = createSfxEngine({
      announcerAudioFactory: factory,
      audioContextFactory: fakeAudioContext,
      backgroundMusicFactory: () => music,
      storage,
    });

    await engine.unlock();
    engine.setVolume(0.5);
    engine.setMusicVolume(0.5);
    engine.setVoiceVolume(0.5);
    engine.setEffectsVolume(0.25);

    expect(music.volume).toBeCloseTo(0.04);
    expect(audios.get(ANNOUNCER_CLIPS.victory)?.volume).toBeCloseTo(0.375);
    expect(engine.getSettings()).toMatchObject({
      volume: 0.5,
      musicVolume: 0.5,
      voiceVolume: 0.5,
      effectsVolume: 0.25,
    });
    expect(JSON.parse(storage.value ?? "{}")).toMatchObject({
      muted: false,
      volume: 0.5,
      musicVolume: 0.5,
      voiceVolume: 0.5,
      effectsVolume: 0.25,
    });
    engine.dispose();
  });

  it("ducks music for a voice queue and restores only after the last line", async () => {
    vi.useFakeTimers();
    const music = fakeBackgroundMusic();
    const { audios, factory } = fakeAnnouncerAudio();
    const engine = createSfxEngine({
      announcerAudioFactory: factory,
      audioContextFactory: fakeAudioContext,
      backgroundMusicFactory: () => music,
      storage: null,
    });
    await engine.unlock();

    engine.announceResult("loss");
    await settleMusicFade();
    expect(music.volume).toBeLessThan(0.16);
    const duckedVolume = music.volume;

    finishAudio(audios.get(ANNOUNCER_CLIPS.defeat));
    await settleMusicFade();
    expect(music.volume).toBeLessThan(0.16);

    finishAudio(audios.get(ANNOUNCER_CLIPS["banished-to-the-shadow-realm"]));
    expect(music.volume).toBeGreaterThan(duckedVolume);
    engine.dispose();
    vi.useRealTimers();
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

  it("loops background music, retries blocked autoplay, and follows master settings", async () => {
    const music = {
      loop: false,
      preload: "none",
      volume: 1,
      play: vi.fn()
        .mockRejectedValueOnce(new Error("Autoplay blocked"))
        .mockResolvedValue(undefined),
      pause: vi.fn(),
    };
    const factory = vi.fn(() => music);
    const engine = createSfxEngine({
      audioContextFactory: fakeAudioContext,
      backgroundMusicFactory: factory,
      storage: null,
    });

    await expect(engine.startMusic()).resolves.toBe(false);
    expect(factory).toHaveBeenCalledWith("/audio/background-music.mp3");
    expect(music).toMatchObject({
      loop: true,
      preload: "auto",
      volume: 0.16,
    });

    await expect(engine.unlock()).resolves.toBe(true);
    expect(music.play).toHaveBeenCalledTimes(2);
    expect(engine.getDebugState().musicPlaying).toBe(true);

    engine.setVolume(0.5);
    expect(music.volume).toBeCloseTo(0.08);
    engine.setMuted(true);
    expect(music.volume).toBe(0);
    engine.setMuted(false);
    expect(music.volume).toBeCloseTo(0.08);

    engine.dispose();
    expect(music.pause).toHaveBeenCalledOnce();
  });

  it("preloads Adam's clips, calls the monster name, then schedules the warp", async () => {
    const { audios, factory } = fakeAnnouncerAudio();
    const engine = createSfxEngine({
      announcerAudioFactory: factory,
      audioContextFactory: fakeAudioContext,
      storage: null,
    });

    expect(factory).toHaveBeenCalledTimes(43);
    expect(engine.getDebugState().announcerClipCount).toBe(43);
    const stoneBull = audios.get(ANNOUNCER_CLIPS["stone-bull"]);
    expect(stoneBull).toMatchObject({ preload: "auto", volume: 1 });

    await engine.unlock();
    engine.announceSummon("Stone Bull", "summon");

    expect(stoneBull?.play).toHaveBeenCalledOnce();
    expect(engine.getDebugState()).toMatchObject({
      announcerLine: "stone-bull",
      announcerQueueLength: 0,
    });
    finishAudio(stoneBull);
    expect(engine.getDebugState().effectCounts["summon-warp"]).toBe(1);
    expect(engine.getDebugState().announcerLine).toBeNull();

    engine.playAnimation({ type: "summon", monsterId: "stone-bull" });
    expect(engine.getDebugState().effectCounts.summon).toBe(0);
    engine.dispose();
  });

  it("does not announce or schedule the warp while sound is muted", async () => {
    const { audios, factory } = fakeAnnouncerAudio();
    const engine = createSfxEngine({
      announcerAudioFactory: factory,
      audioContextFactory: fakeAudioContext,
      storage: null,
    });

    await engine.unlock();
    engine.setMuted(true);
    engine.announceSummon("Stone Bull", "fusion");
    expect(audios.get(ANNOUNCER_CLIPS["stone-bull"])?.play).not.toHaveBeenCalled();
    expect(engine.getDebugState().effectCounts["summon-warp"]).toBe(0);
    engine.dispose();
  });

  it("queues the complete winner message and lets mute stop it", async () => {
    const { audios, factory } = fakeAnnouncerAudio();
    const engine = createSfxEngine({
      announcerAudioFactory: factory,
      audioContextFactory: fakeAudioContext,
      storage: null,
    });
    await engine.unlock();

    engine.announceResult("win");
    const victory = audios.get(ANNOUNCER_CLIPS.victory);
    const gameLine = audios.get(ANNOUNCER_CLIPS["you-have-won-at-the-game-of-beast-battler"]);
    const thanks = audios.get(ANNOUNCER_CLIPS["beast-mode-thanks"]);
    expect(victory?.play).toHaveBeenCalledOnce();
    expect(engine.getDebugState()).toMatchObject({
      announcerLine: "victory",
      announcerQueueLength: 2,
    });

    finishAudio(victory);
    expect(gameLine?.play).toHaveBeenCalledOnce();
    finishAudio(gameLine);
    expect(thanks?.play).toHaveBeenCalledOnce();

    engine.setMuted(true);
    expect(thanks?.pause).toHaveBeenCalledOnce();
    expect(engine.getDebugState()).toMatchObject({
      announcerLine: null,
      announcerQueueLength: 0,
    });
    engine.dispose();
  });

  it("ships a recorded clip for every catalog monster", () => {
    const monsters = [...BASE_MONSTERS, ...FUSION_MONSTERS];
    expect(Object.keys(ANNOUNCER_CLIPS)).toHaveLength(43);
    expect(monsters.map((monster) => announcerLineForMonster(monster.name))).toEqual(
      monsters.map((monster) => monster.id),
    );
    expect(announcerLineForMonster("Definitely Not A Beast")).toBeNull();
  });
});

function fakeAnnouncerAudio(): {
  audios: Map<string, AnnouncerAudioElement & { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }>;
  factory: (source: string) => AnnouncerAudioElement | null;
} {
  const audios = new Map<string, AnnouncerAudioElement & {
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  }>();
  const factory = vi.fn((source: string) => {
    const audio = {
      currentTime: 0,
      onended: null,
      onerror: null,
      preload: "none",
      volume: 1,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } satisfies AnnouncerAudioElement;
    audios.set(source, audio);
    return audio;
  });
  return { audios, factory };
}

function finishAudio(audio: AnnouncerAudioElement | undefined): void {
  const onended = audio?.onended as (() => void) | null | undefined;
  onended?.();
}

function fakeBackgroundMusic() {
  return {
    loop: false,
    preload: "none",
    volume: 1,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  };
}

function fakeStorage(): { value: string | null; getItem: () => string | null; setItem: (key: string, value: string) => void } {
  let value: string | null = null;
  return {
    get value() {
      return value;
    },
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
  };
}

async function settleMusicFade(): Promise<void> {
  for (let frame = 0; frame < 20; frame += 1) {
    await vi.advanceTimersByTimeAsync(20);
  }
}

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
