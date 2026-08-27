import * as THREE from "three";

import {
  ASSIGNED_MONSTER_IDS,
  createMonsterModel,
  MODEL_TURN_SPEED,
} from "./index";
import { updateHologramTime } from "../scene/hologram";

type PreviewEntry = {
  camera: THREE.PerspectiveCamera;
  model: THREE.Group;
  scene: THREE.Scene;
  displayCanvas: HTMLCanvasElement;
  displayContext: CanvasRenderingContext2D;
};

const entries: PreviewEntry[] = [];
const root = document.querySelector<HTMLDivElement>("#monster-grid");

if (!root) {
  throw new Error("Missing #monster-grid root element");
}

const grid = root;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a0a12, 1);

function makeEntry(cardId: string): PreviewEntry {
  const card = document.createElement("article");
  card.className = "monster-card";

  const heading = document.createElement("h2");
  heading.textContent = cardId;
  card.append(heading);

  const stage = document.createElement("div");
  stage.className = "monster-stage";
  card.append(stage);
  grid.append(card);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a12);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(2.45, 1.7, 3.15);
  camera.lookAt(0, 0.78, 0);

  scene.add(new THREE.HemisphereLight(0xb9e8ff, 0x151322, 2.1));

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x4f8cff, 1.6);
  rimLight.position.set(-3, 1.4, -2);
  scene.add(rimLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.08, 24),
    new THREE.MeshStandardMaterial({
      color: 0x151526,
      roughness: 0.92,
      metalness: 0.05,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  scene.add(floor);

  const model = createMonsterModel(cardId);
  scene.add(model);

  const displayCanvas = document.createElement("canvas");
  displayCanvas.setAttribute("aria-label", `${cardId} model render`);
  stage.append(displayCanvas);

  const displayContext = displayCanvas.getContext("2d");
  if (!displayContext) {
    throw new Error(`Unable to create preview canvas for ${cardId}`);
  }

  const entry = { camera, model, scene, displayCanvas, displayContext };
  entries.push(entry);

  const resize = (): void => {
    const width = Math.max(stage.clientWidth, 1);
    const height = Math.max(stage.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    displayCanvas.width = Math.max(Math.floor(width * pixelRatio), 1);
    displayCanvas.height = Math.max(Math.floor(height * pixelRatio), 1);
  };

  new ResizeObserver(resize).observe(stage);
  resize();
  return entry;
}

for (const cardId of ASSIGNED_MONSTER_IDS) {
  makeEntry(cardId);
}

let previousTime = performance.now();

function render(time: number): void {
  const deltaSeconds = Math.min((time - previousTime) / 1000, 0.1);
  previousTime = time;

  for (const entry of entries) {
    entry.model.rotation.y += MODEL_TURN_SPEED * deltaSeconds;
    updateHologramTime(entry.model, time / 1000);

    const width = Math.max(entry.displayCanvas.clientWidth, 1);
    const height = Math.max(entry.displayCanvas.clientHeight, 1);
    renderer.setSize(width, height, false);
    renderer.render(entry.scene, entry.camera);
    entry.displayContext.clearRect(
      0,
      0,
      entry.displayCanvas.width,
      entry.displayCanvas.height,
    );
    entry.displayContext.drawImage(
      renderer.domElement,
      0,
      0,
      entry.displayCanvas.width,
      entry.displayCanvas.height,
    );
  }

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
