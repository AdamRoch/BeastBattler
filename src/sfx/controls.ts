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
      <span>VOLUME</span>
      <input data-sfx-volume type="range" min="0" max="1" step="0.01" aria-label="Master sound volume" />
    </label>
  `;
  root.append(controls);

  const muteButtonElement = controls.querySelector<HTMLButtonElement>("[data-sfx-mute]");
  const volumeInputElement = controls.querySelector<HTMLInputElement>("[data-sfx-volume]");
  if (!muteButtonElement || !volumeInputElement) {
    throw new Error("Sound controls failed to mount");
  }
  const muteButton = muteButtonElement;
  const volumeInput = volumeInputElement;

  function render(): void {
    const settings = engine.getSettings();
    muteButton.textContent = settings.muted ? "SOUND OFF" : "SOUND ON";
    muteButton.setAttribute("aria-pressed", String(settings.muted));
    volumeInput.value = String(settings.volume);
  }

  const toggleMute = () => engine.setMuted(!engine.getSettings().muted);
  const changeVolume = () => engine.setVolume(Number(volumeInput.value));
  muteButton.addEventListener("click", toggleMute);
  volumeInput.addEventListener("input", changeVolume);
  const stopSettingsListener = engine.onSettingsChange(render);
  render();

  return {
    dispose() {
      stopSettingsListener();
      muteButton.removeEventListener("click", toggleMute);
      volumeInput.removeEventListener("input", changeVolume);
      controls.remove();
    },
  };
}
