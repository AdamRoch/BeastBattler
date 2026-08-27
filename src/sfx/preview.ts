import {
  SFX_EFFECTS,
  createSfxEngine,
  type SfxEffect,
} from "./index";
import {
  bindSfxToUserGestures,
  mountSfxControls,
} from "./controls";

const app = document.querySelector<HTMLElement>("#sfx-preview");
if (!app) {
  throw new Error("Missing #sfx-preview root");
}

const engine = createSfxEngine();
const unbindGestures = bindSfxToUserGestures(document, engine);
const controls = mountSfxControls(app, engine);
const effectGrid = document.createElement("section");
effectGrid.className = "sfx-preview-grid";
effectGrid.innerHTML = SFX_EFFECTS.map((effect) => `
  <button type="button" data-preview-effect="${effect}">${label(effect)}</button>
`).join("");
app.append(effectGrid);

const ambientButton = document.createElement("button");
ambientButton.className = "sfx-preview-ambient";
ambientButton.type = "button";
ambientButton.dataset.previewAmbient = "off";
ambientButton.textContent = "AMBIENT HUM: OFF";
app.append(ambientButton);

const status = document.createElement("output");
status.className = "sfx-preview-status";
app.append(status);

function renderStatus(): void {
  const state = engine.getDebugState();
  status.textContent = JSON.stringify(state);
  document.body.dataset.audioState = state.contextState;
}

function handleClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const effectButton = target.closest<HTMLButtonElement>("[data-preview-effect]");
  if (effectButton) {
    engine.play(effectButton.dataset.previewEffect as SfxEffect);
    renderStatus();
    return;
  }
  if (target.closest("[data-preview-ambient]")) {
    const enabled = ambientButton.dataset.previewAmbient !== "on";
    ambientButton.dataset.previewAmbient = enabled ? "on" : "off";
    ambientButton.textContent = `AMBIENT HUM: ${enabled ? "ON" : "OFF"}`;
    engine.setAmbientMonsterCount(enabled ? 3 : 0);
    renderStatus();
  }
}

effectGrid.addEventListener("click", handleClick);
ambientButton.addEventListener("click", handleClick);
renderStatus();

Object.assign(window, {
  __beastBattlerSfx: engine,
  __disposeSfxPreview() {
    controls.dispose();
    unbindGestures();
    engine.dispose();
  },
});

function label(effect: SfxEffect): string {
  return effect.replaceAll("-", " ").toUpperCase();
}
