import type { ArenaScene, ArenaAnimationEvent } from "../arena";
import {
  ANNOUNCER_CLIPS,
  announcerClipSource,
  announcerLineForMonster,
  type AnnouncerLine,
} from "./announcer";

export const SFX_EFFECTS = [
  "summon",
  "summon-warp",
  "fusion",
  "fusion-star3",
  "attack",
  "hit",
  "death",
  "lp-tick",
  "spell-bolt",
  "spell-destroy",
  "spell-draw",
  "spell-counterspell",
  "ui-click",
  "phase-change",
  "curtain",
  "victory",
  "defeat",
] as const;

export type SfxEffect = (typeof SFX_EFFECTS)[number];

export interface SfxSettings {
  readonly muted: boolean;
  readonly volume: number;
}

export interface SfxDebugState extends SfxSettings {
  readonly announcerClipCount: number;
  readonly announcerLine: AnnouncerLine | null;
  readonly announcerQueueLength: number;
  readonly ambientMonsterCount: number;
  readonly contextState: AudioContextState | "uninitialized";
  readonly effectCounts: Readonly<Record<SfxEffect, number>>;
  readonly initialized: boolean;
  readonly musicPlaying: boolean;
}

export interface SfxEngine {
  unlock(): Promise<boolean>;
  startMusic(): Promise<boolean>;
  play(effect: SfxEffect): void;
  announce(line: AnnouncerLine): void;
  announceSummon(
    monsterName: string,
    materialization: "summon" | "fusion",
  ): void;
  announceResult(outcome: "win" | "loss"): void;
  playLpTicks(count: number): void;
  playAnimation(event: ArenaAnimationEvent): void;
  setAmbientMonsterCount(count: number): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  getSettings(): SfxSettings;
  getDebugState(): SfxDebugState;
  onSettingsChange(listener: (settings: SfxSettings) => void): () => void;
  dispose(): void;
}

export interface SfxEngineOptions {
  readonly announcerAudioFactory?: (source: string) => AnnouncerAudioElement | null;
  readonly audioContextFactory?: () => AudioContext;
  readonly backgroundMusicFactory?: (source: string) => BackgroundMusicElement | null;
  readonly backgroundMusicSource?: string | null;
  readonly storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

export interface AnnouncerAudioElement {
  currentTime: number;
  onended: HTMLAudioElement["onended"];
  onerror: HTMLAudioElement["onerror"];
  preload: string;
  volume: number;
  play(): Promise<void>;
  pause(): void;
}

interface BackgroundMusicElement {
  loop: boolean;
  preload: string;
  volume: number;
  play(): Promise<void>;
  pause(): void;
}

const STORAGE_KEY = "beast-battler:sfx:v1";
const DEFAULT_SETTINGS: SfxSettings = { muted: false, volume: 0.32 };
const BACKGROUND_MUSIC_SOURCE = "/audio/background-music.mp3";
const BACKGROUND_MUSIC_GAIN = 0.16;
const ANNOUNCER_GAIN = 1.5;
const SILENCE = 0.0001;
const WARP_FALLBACK_DELAY_SECONDS = 0.14;

export function readSfxSettings(
  storage: Pick<Storage, "getItem"> | null,
): SfxSettings {
  if (!storage) {
    return DEFAULT_SETTINGS;
  }
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (!value) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(value) as Partial<SfxSettings>;
    return {
      muted: typeof parsed.muted === "boolean" ? parsed.muted : false,
      volume: normalizeVolume(parsed.volume),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function effectForAnimation(
  event: ArenaAnimationEvent,
): SfxEffect {
  switch (event.type) {
    case "summon":
      return "summon";
    case "fusion":
      return event.variant === "star3" ? "fusion-star3" : "fusion";
    case "attack":
      return "attack";
    case "hit":
      return "hit";
    case "death":
      return "death";
    case "spell":
      return `spell-${event.spell}`;
    case "burst":
      return "spell-bolt";
  }
}

export function createSfxEngine(
  options: SfxEngineOptions = {},
): SfxEngine {
  const storage = options.storage === undefined
    ? browserStorage()
    : options.storage;
  const contextFactory = options.audioContextFactory ?? createBrowserAudioContext;
  const announcerAudioFactory = options.announcerAudioFactory ?? createBrowserAnnouncerAudio;
  const backgroundMusicFactory = options.backgroundMusicFactory ?? createBrowserBackgroundMusic;
  const backgroundMusicSource = options.backgroundMusicSource === undefined
    ? BACKGROUND_MUSIC_SOURCE
    : options.backgroundMusicSource;
  const settingsListeners = new Set<(settings: SfxSettings) => void>();
  const effectCounts = Object.fromEntries(
    SFX_EFFECTS.map((effect) => [effect, 0]),
  ) as Record<SfxEffect, number>;

  let settings = readSfxSettings(storage);
  let context: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let ambientGain: GainNode | null = null;
  let backgroundMusic: BackgroundMusicElement | null | undefined;
  let musicPlaying = false;
  let musicRequest: Promise<boolean> | null = null;
  let ambientMonsterCount = 0;
  let disposed = false;
  const announcerAudio = new Map<AnnouncerLine, AnnouncerAudioElement | null>();
  const announcementQueue: Array<{
    readonly line: AnnouncerLine;
    readonly onComplete?: () => void;
  }> = [];
  let activeAnnouncement: {
    readonly audio: AnnouncerAudioElement;
    readonly cancel: () => void;
    readonly line: AnnouncerLine;
  } | null = null;
  const suppressedMaterializations: Record<"summon" | "fusion", number> = {
    summon: 0,
    fusion: 0,
  };

  preloadAnnouncerClips();

  async function unlock(): Promise<boolean> {
    if (disposed) {
      return false;
    }
    const musicStart = startMusic();
    let contextReady = false;
    try {
      ensureContext();
      if (context?.state === "suspended") {
        await context.resume();
      }
      contextReady = context?.state === "running";
    } catch {
      contextReady = false;
    }
    return contextReady || await musicStart;
  }

  function startMusic(): Promise<boolean> {
    if (disposed || musicPlaying) {
      return Promise.resolve(musicPlaying);
    }
    if (musicRequest) {
      return musicRequest;
    }
    const audio = getBackgroundMusic();
    if (!audio) {
      return Promise.resolve(false);
    }

    audio.volume = backgroundMusicVolume();
    musicRequest = Promise.resolve(audio.play())
      .then(() => {
        if (disposed) {
          audio.pause();
          return false;
        }
        musicPlaying = true;
        return true;
      })
      .catch(() => false)
      .finally(() => {
        musicRequest = null;
      });
    return musicRequest;
  }

  function getBackgroundMusic(): BackgroundMusicElement | null {
    if (backgroundMusic !== undefined) {
      return backgroundMusic;
    }
    backgroundMusic = backgroundMusicSource
      ? backgroundMusicFactory(backgroundMusicSource)
      : null;
    if (backgroundMusic) {
      backgroundMusic.loop = true;
      backgroundMusic.preload = "auto";
      backgroundMusic.volume = backgroundMusicVolume();
    }
    return backgroundMusic;
  }

  function ensureContext(): void {
    if (context) {
      return;
    }
    context = contextFactory();
    masterGain = context.createGain();
    masterGain.gain.value = effectiveVolume();
    masterGain.connect(context.destination);
    createAmbientNodes(context, masterGain);
  }

  function createAmbientNodes(
    audioContext: AudioContext,
    destination: AudioNode,
  ): void {
    ambientGain = audioContext.createGain();
    ambientGain.gain.value = ambientLevel(ambientMonsterCount);
    ambientGain.connect(destination);

    const hum = audioContext.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 58;
    hum.connect(ambientGain);

    const shimmer = audioContext.createOscillator();
    shimmer.type = "triangle";
    shimmer.frequency.value = 174;
    const shimmerGain = audioContext.createGain();
    shimmerGain.gain.value = 0.22;
    shimmer.connect(shimmerGain);
    shimmerGain.connect(ambientGain);

    const lfo = audioContext.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.19;
    const lfoDepth = audioContext.createGain();
    lfoDepth.gain.value = 5;
    lfo.connect(lfoDepth);
    lfoDepth.connect(shimmer.detune);

    hum.start();
    shimmer.start();
    lfo.start();
  }

  function play(effect: SfxEffect): void {
    scheduleEffect(effect, 0);
  }

  function announce(line: AnnouncerLine): void {
    queueAnnouncement(line);
  }

  function announceSummon(
    monsterName: string,
    materialization: "summon" | "fusion",
  ): void {
    suppressedMaterializations[materialization] += 1;
    if (!context || !masterGain || disposed || effectiveVolume() === 0) {
      return;
    }

    const line = announcerLineForMonster(monsterName);
    if (!line) {
      scheduleEffect("summon-warp", WARP_FALLBACK_DELAY_SECONDS);
      return;
    }

    queueAnnouncement(line, () => scheduleEffect("summon-warp", 0));
  }

  function announceResult(outcome: "win" | "loss"): void {
    if (!context || !masterGain || disposed || effectiveVolume() === 0) {
      return;
    }
    stopAnnouncements();
    const lines: readonly AnnouncerLine[] = outcome === "win"
      ? [
          "victory",
          "you-have-won-at-the-game-of-beast-battler",
          "beast-mode-thanks",
        ]
      : ["defeat", "banished-to-the-shadow-realm"];
    for (const line of lines) {
      queueAnnouncement(line);
    }
  }

  function preloadAnnouncerClips(): void {
    for (const line of Object.keys(ANNOUNCER_CLIPS) as AnnouncerLine[]) {
      let audio: AnnouncerAudioElement | null = null;
      try {
        audio = announcerAudioFactory(announcerClipSource(line));
        if (audio) {
          audio.preload = "auto";
          audio.volume = announcerVolume();
        }
      } catch {
        audio = null;
      }
      announcerAudio.set(line, audio);
    }
  }

  function queueAnnouncement(line: AnnouncerLine, onComplete?: () => void): void {
    if (!context || !masterGain || disposed || effectiveVolume() === 0) {
      return;
    }
    announcementQueue.push({ line, onComplete });
    playNextAnnouncement();
  }

  function playNextAnnouncement(): void {
    if (activeAnnouncement || disposed) {
      return;
    }
    const queued = announcementQueue.shift();
    if (!queued) {
      return;
    }
    const audio = announcerAudio.get(queued.line);
    if (!audio) {
      queued.onComplete?.();
      playNextAnnouncement();
      return;
    }

    let settled = false;
    const settleAnnouncement = (completed: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      audio.onended = null;
      audio.onerror = null;
      if (activeAnnouncement?.audio === audio) {
        activeAnnouncement = null;
      }
      if (completed) {
        queued.onComplete?.();
        playNextAnnouncement();
      }
    };
    const finishAnnouncement = () => settleAnnouncement(true);
    const cancelAnnouncement = () => {
      audio.pause();
      audio.currentTime = 0;
      settleAnnouncement(false);
    };
    try {
      audio.currentTime = 0;
      audio.volume = announcerVolume();
      audio.onended = finishAnnouncement;
      audio.onerror = finishAnnouncement;
      activeAnnouncement = {
        audio,
        cancel: cancelAnnouncement,
        line: queued.line,
      };
      void Promise.resolve(audio.play()).catch(finishAnnouncement);
    } catch {
      finishAnnouncement();
    }
  }

  function stopAnnouncements(): void {
    announcementQueue.length = 0;
    if (!activeAnnouncement) {
      return;
    }
    activeAnnouncement.cancel();
  }

  function playLpTicks(count: number): void {
    const tickCount = Math.max(0, Math.min(10, Math.floor(count)));
    for (let index = 0; index < tickCount; index += 1) {
      scheduleEffect("lp-tick", index * 0.075);
    }
  }

  function scheduleEffect(effect: SfxEffect, delay: number): void {
    if (!context || !masterGain || disposed) {
      return;
    }
    try {
      effectCounts[effect] += 1;
      const start = context.currentTime + 0.006 + delay;
      synthesize(effect, context, masterGain, start);
    } catch {
      // Audio must never interrupt the match if a browser rejects a node.
    }
  }

  function synthesize(
    effect: SfxEffect,
    audioContext: AudioContext,
    destination: AudioNode,
    start: number,
  ): void {
    const tone = (
      from: number,
      to: number,
      duration: number,
      gain: number,
      type: OscillatorType = "sine",
      delay = 0,
    ) => playTone(
      audioContext,
      destination,
      start + delay,
      from,
      to,
      duration,
      gain,
      type,
    );
    const noise = (
      duration: number,
      gain: number,
      filterType: BiquadFilterType,
      frequency: number,
      q: number,
      delay = 0,
    ) => playNoise(
      audioContext,
      destination,
      start + delay,
      duration,
      gain,
      filterType,
      frequency,
      q,
    );

    switch (effect) {
      case "summon":
        noise(0.42, 0.045, "bandpass", 1_250, 4);
        tone(150, 820, 0.46, 0.035, "sawtooth");
        return;
      case "summon-warp":
        noise(0.3, 0.042, "bandpass", 1_380, 4.5);
        tone(180, 1_120, 0.32, 0.04, "sawtooth");
        tone(620, 1_460, 0.18, 0.018, "triangle", 0.08);
        return;
      case "fusion":
        tone(78, 660, 0.9, 0.045, "sawtooth");
        noise(0.86, 0.028, "bandpass", 920, 2.8);
        playChord(audioContext, destination, start + 0.72, [220, 330, 440], 0.24, 0.032);
        return;
      case "fusion-star3":
        tone(52, 360, 0.52, 0.055, "sawtooth");
        noise(0.46, 0.035, "lowpass", 760, 1.5);
        playChord(audioContext, destination, start + 0.37, [110, 165, 220], 0.2, 0.04);
        return;
      case "attack":
        tone(430, 1_350, 0.17, 0.035, "sawtooth");
        tone(92, 44, 0.24, 0.055, "sine", 0.13);
        noise(0.12, 0.025, "lowpass", 300, 1, 0.13);
        return;
      case "hit":
        tone(1_650, 710, 0.12, 0.04, "triangle");
        noise(0.08, 0.022, "highpass", 2_400, 1.2);
        return;
      case "death":
        noise(0.58, 0.052, "bandpass", 520, 1.7);
        tone(210, 38, 0.55, 0.04, "square");
        return;
      case "lp-tick":
        tone(680, 390, 0.075, 0.035, "square");
        return;
      case "spell-bolt":
        noise(0.22, 0.055, "highpass", 2_100, 1.4);
        tone(1_900, 230, 0.3, 0.045, "sawtooth");
        return;
      case "spell-destroy":
        noise(0.12, 0.04, "bandpass", 1_800, 3);
        noise(0.12, 0.038, "bandpass", 1_220, 3, 0.08);
        noise(0.16, 0.035, "bandpass", 760, 2.4, 0.16);
        tone(260, 54, 0.34, 0.04, "square");
        return;
      case "spell-draw":
        noise(0.1, 0.025, "highpass", 1_800, 0.8);
        tone(520, 740, 0.1, 0.025, "triangle", 0.05);
        tone(660, 940, 0.13, 0.025, "triangle", 0.15);
        return;
      case "spell-counterspell":
        playChord(audioContext, destination, start, [440, 660, 880], 0.32, 0.035);
        tone(880, 330, 0.28, 0.025, "sine", 0.12);
        return;
      case "ui-click":
        tone(540, 360, 0.045, 0.018, "triangle");
        return;
      case "phase-change":
        tone(330, 660, 0.11, 0.024, "sine");
        return;
      case "curtain":
        noise(0.3, 0.028, "bandpass", 780, 1.4);
        tone(190, 92, 0.3, 0.022, "sine");
        return;
      case "victory":
        [262, 330, 392, 523].forEach((note, index) =>
          tone(note, note * 1.01, 0.28, 0.032, "triangle", index * 0.12),
        );
        return;
      case "defeat":
        [220, 185, 147, 110].forEach((note, index) =>
          tone(note, note * 0.92, 0.34, 0.035, "sawtooth", index * 0.14),
        );
        return;
    }
  }

  function playAnimation(event: ArenaAnimationEvent): void {
    if (
      (event.type === "summon" || event.type === "fusion") &&
      suppressedMaterializations[event.type] > 0
    ) {
      suppressedMaterializations[event.type] -= 1;
      return;
    }
    play(effectForAnimation(event));
  }

  function setAmbientMonsterCount(count: number): void {
    ambientMonsterCount = Math.max(0, Math.floor(count));
    if (context && ambientGain) {
      ambientGain.gain.setTargetAtTime(
        ambientLevel(ambientMonsterCount),
        context.currentTime,
        0.18,
      );
    }
  }

  function setMuted(muted: boolean): void {
    settings = { ...settings, muted };
    if (muted) {
      stopAnnouncements();
    }
    applySettings();
  }

  function setVolume(volume: number): void {
    settings = { ...settings, volume: normalizeVolume(volume) };
    applySettings();
  }

  function applySettings(): void {
    if (context && masterGain) {
      masterGain.gain.setTargetAtTime(
        effectiveVolume(),
        context.currentTime,
        0.025,
      );
    }
    if (backgroundMusic) {
      backgroundMusic.volume = backgroundMusicVolume();
    }
    for (const audio of announcerAudio.values()) {
      if (audio) {
        audio.volume = announcerVolume();
      }
    }
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage can be disabled without disabling audio.
    }
    for (const listener of settingsListeners) {
      listener(settings);
    }
  }

  function effectiveVolume(): number {
    return settings.muted ? 0 : settings.volume;
  }

  function backgroundMusicVolume(): number {
    return effectiveVolume() * BACKGROUND_MUSIC_GAIN;
  }

  function announcerVolume(): number {
    return Math.min(1, effectiveVolume() * ANNOUNCER_GAIN);
  }

  function getDebugState(): SfxDebugState {
    return {
      ...settings,
      announcerClipCount: [...announcerAudio.values()].filter(Boolean).length,
      announcerLine: activeAnnouncement?.line ?? null,
      announcerQueueLength: announcementQueue.length,
      ambientMonsterCount,
      contextState: context?.state ?? "uninitialized",
      effectCounts: { ...effectCounts },
      initialized: context !== null,
      musicPlaying,
    };
  }

  function dispose(): void {
    disposed = true;
    settingsListeners.clear();
    stopAnnouncements();
    backgroundMusic?.pause();
    backgroundMusic = null;
    musicPlaying = false;
    musicRequest = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    context = null;
    masterGain = null;
    ambientGain = null;
  }

  return {
    unlock,
    startMusic,
    play,
    announce,
    announceSummon,
    announceResult,
    playLpTicks,
    playAnimation,
    setAmbientMonsterCount,
    setMuted,
    setVolume,
    getSettings: () => settings,
    getDebugState,
    onSettingsChange(listener) {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    },
    dispose,
  };
}

export function connectArenaSfx(
  arena: Pick<ArenaScene, "onAnimationEvent">,
  engine: SfxEngine,
): () => void {
  return arena.onAnimationEvent((event) => engine.playAnimation(event));
}

function playTone(
  context: AudioContext,
  destination: AudioNode,
  start: number,
  from: number,
  to: number,
  duration: number,
  peakGain: number,
  type: OscillatorType,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
  gain.gain.setValueAtTime(SILENCE, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + Math.min(0.018, duration * 0.25));
  gain.gain.exponentialRampToValueAtTime(SILENCE, start + duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
  oscillator.addEventListener("ended", () => {
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
}

function playNoise(
  context: AudioContext,
  destination: AudioNode,
  start: number,
  duration: number,
  peakGain: number,
  filterType: BiquadFilterType,
  frequency: number,
  q: number,
): void {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  gain.gain.setValueAtTime(SILENCE, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + Math.min(0.012, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(SILENCE, start + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(start);
  source.stop(start + duration + 0.01);
  source.addEventListener("ended", () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  }, { once: true });
}

function playChord(
  context: AudioContext,
  destination: AudioNode,
  start: number,
  notes: readonly number[],
  duration: number,
  totalGain: number,
): void {
  const noteGain = totalGain / notes.length;
  notes.forEach((note) =>
    playTone(context, destination, start, note, note * 1.005, duration, noteGain, "sine"),
  );
}

function normalizeVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : DEFAULT_SETTINGS.volume;
}

function ambientLevel(monsterCount: number): number {
  return monsterCount === 0 ? SILENCE : Math.min(0.014, 0.004 + monsterCount * 0.0015);
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function createBrowserBackgroundMusic(source: string): HTMLAudioElement | null {
  try {
    return globalThis.Audio ? new globalThis.Audio(source) : null;
  } catch {
    return null;
  }
}

function createBrowserAnnouncerAudio(source: string): HTMLAudioElement | null {
  try {
    return globalThis.Audio ? new globalThis.Audio(source) : null;
  } catch {
    return null;
  }
}

function createBrowserAudioContext(): AudioContext {
  const AudioContextConstructor = globalThis.AudioContext ??
    (globalThis as typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("WebAudio is not available");
  }
  return new AudioContextConstructor();
}
