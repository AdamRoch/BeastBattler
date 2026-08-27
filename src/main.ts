import * as THREE from "three";

import { mountApp } from "./app/controller";
import { createArenaScene } from "./arena";
import {
  startOnlineMatch,
  type OnlineMatchController,
} from "./match/online";
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

let onlineMatch: OnlineMatchController | null = null;
const controller = mountApp(app, arena, {
  sfx,
  startOnlineMatch(session) {
    onlineMatch = startOnlineMatch(app, session, {
      arena,
      sfx,
      onReturnToLobby() {
        onlineMatch?.dispose();
        onlineMatch = null;
        controller.returnToOnlineLobby();
      },
    });
  },
});

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
