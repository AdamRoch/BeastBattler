import * as THREE from "three";

import { mountApp } from "./app/controller";
import { createArenaScene } from "./arena";
import {
  connectArenaSfx,
  createSfxEngine,
} from "./sfx";
import {
  bindSfxToUserGestures,
  mountSfxControls,
} from "./sfx/controls";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root element");
}

const arena = createArenaScene(
  window.innerWidth / window.innerHeight,
);
const { scene, camera } = arena;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.append(renderer.domElement);
const sfx = createSfxEngine();
if (import.meta.env.DEV) {
  Object.assign(window, { __beastBattlerSfx: sfx });
}
bindSfxToUserGestures(document, sfx);
connectArenaSfx(arena, sfx);
mountSfxControls(app, sfx);
mountApp(app, arena, { sfx });

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", resize);

function render(timestampMilliseconds: DOMHighResTimeStamp): void {
  arena.update(timestampMilliseconds / 1000);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
