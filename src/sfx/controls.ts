import type { SfxEngine } from "./index";

export interface SfxControls {
  dispose(): void;
}

export function bindSfxToUserGestures(
  documentRoot: Document,
  engine: SfxEngine,
): () => void {
  const unlock = () => {
    void engine.unlock();
  };
  const playButtonSound = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button")) {
      engine.play("ui-click");
    }
  };

  documentRoot.addEventListener("pointerdown", unlock, true);
  documentRoot.addEventListener("keydown", unlock, true);
  documentRoot.addEventListener("click", playButtonSound);
  return () => {
    documentRoot.removeEventListener("pointerdown", unlock, true);
    documentRoot.removeEventListener("keydown", unlock, true);
    documentRoot.removeEventListener("click", playButtonSound);
  };
}

export function mountSfxControls(
  root: HTMLElement,
  engine: SfxEngine,
): SfxControls {
  const controls = document.createElement("aside");
  controls.className = "sfx-controls";
  controls.setAttribute("aria-label", "Sound controls");
  controls.innerHTML = `
    <button class="sfx-mute" type="button" data-sfx-mute aria-pressed="false">SOUND ON</button>
    <label class="sfx-volume">
      <span>MASTER</span>
      <input data-sfx-volume type="range" min="0" max="1" step="0.01" aria-label="Master sound volume" />
    </label>
    <div class="sfx-channels">
      <label class="sfx-volume">
        <span>MUSIC</span>
        <input data-sfx-music-volume type="range" min="0" max="1" step="0.01" aria-label="Music volume" />
      </label>
      <label class="sfx-volume">
        <span>VOICE</span>
        <input data-sfx-voice-volume type="range" min="0" max="1" step="0.01" aria-label="Voice volume" />
      </label>
      <label class="sfx-volume">
        <span>EFFECTS</span>
        <input data-sfx-effects-volume type="range" min="0" max="1" step="0.01" aria-label="Effects volume" />
      </label>
    </div>
  `;
  root.append(controls);

  const muteButtonElement = controls.querySelector<HTMLButtonElement>("[data-sfx-mute]");
  const volumeInputElement = controls.querySelector<HTMLInputElement>("[data-sfx-volume]");
  const musicVolumeInputElement = controls.querySelector<HTMLInputElement>("[data-sfx-music-volume]");
  const voiceVolumeInputElement = controls.querySelector<HTMLInputElement>("[data-sfx-voice-volume]");
  const effectsVolumeInputElement = controls.querySelector<HTMLInputElement>("[data-sfx-effects-volume]");
  if (!muteButtonElement || !volumeInputElement || !musicVolumeInputElement || !voiceVolumeInputElement || !effectsVolumeInputElement) {
    throw new Error("Sound controls failed to mount");
  }
  const muteButton = muteButtonElement;
  const volumeInput = volumeInputElement;
  const musicVolumeInput = musicVolumeInputElement;
  const voiceVolumeInput = voiceVolumeInputElement;
  const effectsVolumeInput = effectsVolumeInputElement;

  function render(): void {
    const settings = engine.getSettings();
    muteButton.textContent = settings.muted ? "SOUND OFF" : "SOUND ON";
    muteButton.setAttribute("aria-pressed", String(settings.muted));
    volumeInput.value = String(settings.volume);
    musicVolumeInput.value = String(settings.musicVolume);
    voiceVolumeInput.value = String(settings.voiceVolume);
    effectsVolumeInput.value = String(settings.effectsVolume);
  }

  const toggleMute = () => engine.setMuted(!engine.getSettings().muted);
  const changeVolume = () => engine.setVolume(Number(volumeInput.value));
  const changeMusicVolume = () => engine.setMusicVolume(Number(musicVolumeInput.value));
  const changeVoiceVolume = () => engine.setVoiceVolume(Number(voiceVolumeInput.value));
  const changeEffectsVolume = () => engine.setEffectsVolume(Number(effectsVolumeInput.value));
  muteButton.addEventListener("click", toggleMute);
  volumeInput.addEventListener("input", changeVolume);
  musicVolumeInput.addEventListener("input", changeMusicVolume);
  voiceVolumeInput.addEventListener("input", changeVoiceVolume);
  effectsVolumeInput.addEventListener("input", changeEffectsVolume);
  const stopSettingsListener = engine.onSettingsChange(render);
  render();

  return {
    dispose() {
      stopSettingsListener();
      muteButton.removeEventListener("click", toggleMute);
      volumeInput.removeEventListener("input", changeVolume);
      musicVolumeInput.removeEventListener("input", changeMusicVolume);
      voiceVolumeInput.removeEventListener("input", changeVoiceVolume);
      effectsVolumeInput.removeEventListener("input", changeEffectsVolume);
      controls.remove();
    },
  };
}
