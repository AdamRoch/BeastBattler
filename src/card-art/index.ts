import * as THREE from "three";

import {
  ASSIGNED_MONSTER_IDS,
  createMonsterModel,
  getMonsterHologramPalette,
  type AssignedMonsterId,
} from "../models";
import {
  HOLOGRAM_ELEMENT_COLORS,
  updateHologramTime,
  type HologramElement,
} from "../scene/hologram";

export const SPELL_CARD_IDS = [
  "Bolt",
  "Destroy",
  "Draw",
  "Counterspell",
] as const;

export type SpellCardId = (typeof SPELL_CARD_IDS)[number];
export type CardArtId = AssignedMonsterId | SpellCardId;

export const CARD_ART_IDS: readonly CardArtId[] = [
  ...ASSIGNED_MONSTER_IDS,
  ...SPELL_CARD_IDS,
];

export interface CardArtRendererOptions {
  height?: number;
  width?: number;
}

export interface CardArtRenderer {
  render(cardId: CardArtId): string;
  renderAll(): ReadonlyMap<CardArtId, string>;
  dispose(): void;
}

const DEFAULT_WIDTH = 384;
const DEFAULT_HEIGHT = 536;

const SPELL_STYLES: Readonly<
  Record<SpellCardId, { accent: string; icon: string; subtitle: string }>
> = {
  Bolt: {
    accent: "#68d8ff",
    icon: '<path d="M224 96 132 282h66l-38 158 112-214h-72z" fill="currentColor"/>',
    subtitle: "DAMAGE SPELL",
  },
  Destroy: {
    accent: "#ff6747",
    icon:
      '<path d="m192 92 42 112 105-54-64 101 105 48-119 4 23 116-77-90-78 89 25-115-119-6 105-47-62-102 104 56z" fill="currentColor"/>',
    subtitle: "REMOVAL SPELL",
  },
  Draw: {
    accent: "#72f0d4",
    icon:
      '<g fill="none" stroke="currentColor" stroke-width="15"><rect x="104" y="146" width="130" height="190" rx="10" transform="rotate(-14 169 241)"/><rect x="150" y="120" width="130" height="190" rx="10"/><path d="M183 171h64M183 210h64M183 249h44"/></g>',
    subtitle: "CARD ADVANTAGE",
  },
  Counterspell: {
    accent: "#7c9dff",
    icon:
      '<g fill="none" stroke="currentColor"><circle cx="192" cy="250" r="112" stroke-width="13"/><circle cx="192" cy="250" r="72" stroke-width="8"/><path d="m112 330 160-160" stroke-width="22"/></g>',
    subtitle: "NEGATE SPELL",
  },
};

function isSpellCardId(cardId: CardArtId): cardId is SpellCardId {
  return SPELL_CARD_IDS.includes(cardId as SpellCardId);
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      material.dispose();
    }
  });
}

function createBackdropTexture(
  width: number,
  height: number,
  primaryElement: HologramElement,
  secondaryElement: HologramElement,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create card-art backdrop canvas");
  }

  const primary = `#${HOLOGRAM_ELEMENT_COLORS[primaryElement]
    .toString(16)
    .padStart(6, "0")}`;
  const secondary = `#${HOLOGRAM_ELEMENT_COLORS[secondaryElement]
    .toString(16)
    .padStart(6, "0")}`;

  context.fillStyle = "#050711";
  context.fillRect(0, 0, width, height);

  const wash = context.createLinearGradient(0, 0, width, height);
  wash.addColorStop(0, `${primary}bb`);
  wash.addColorStop(0.48, "#090d1c");
  wash.addColorStop(1, `${secondary}99`);
  context.fillStyle = wash;
  context.fillRect(0, 0, width, height);

  const halo = context.createRadialGradient(
    width * 0.5,
    height * 0.42,
    12,
    width * 0.5,
    height * 0.42,
    width * 0.58,
  );
  halo.addColorStop(0, "rgba(255,255,255,0.2)");
  halo.addColorStop(0.35, `${primary}42`);
  halo.addColorStop(1, "rgba(2,4,12,0)");
  context.fillStyle = halo;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(215,240,255,0.10)";
  context.lineWidth = 1;
  const gridSize = Math.max(Math.floor(width / 12), 20);
  for (let x = 0; x <= width; x += gridSize) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += gridSize) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.strokeStyle = `${secondary}66`;
  context.lineWidth = 3;
  context.beginPath();
  context.arc(width / 2, height * 0.48, width * 0.31, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function poseAngle(cardId: string): number {
  let hash = 0;
  for (let index = 0; index < cardId.length; index += 1) {
    hash = (hash * 33 + cardId.charCodeAt(index)) >>> 0;
  }
  return THREE.MathUtils.lerp(-0.34, 0.34, (hash % 1000) / 999);
}

export function createSpellCardArt(
  cardId: SpellCardId,
  options: CardArtRendererOptions = {},
): string {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("Card art dimensions must be positive integers");
  }

  const style = SPELL_STYLES[cardId];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${DEFAULT_WIDTH} ${DEFAULT_HEIGHT}">
      <defs>
        <radialGradient id="halo" cx="50%" cy="40%" r="62%">
          <stop offset="0" stop-color="${style.accent}" stop-opacity="0.42"/>
          <stop offset="0.58" stop-color="#0b1020"/>
          <stop offset="1" stop-color="#04060d"/>
        </radialGradient>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke="${style.accent}" stroke-opacity="0.12"/>
        </pattern>
      </defs>
      <rect width="384" height="536" fill="url(#halo)"/>
      <rect width="384" height="536" fill="url(#grid)"/>
      <g color="${style.accent}">${style.icon}</g>
      <path d="M48 424h288" stroke="${style.accent}" stroke-width="2" stroke-opacity="0.65"/>
      <text x="192" y="468" fill="#f4f7ff" font-family="system-ui, sans-serif" font-size="35" font-weight="750" text-anchor="middle">${cardId}</text>
      <text x="192" y="500" fill="${style.accent}" font-family="system-ui, sans-serif" font-size="13" font-weight="650" letter-spacing="3" text-anchor="middle">${style.subtitle}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createCardArtRenderer(
  options: CardArtRendererOptions = {},
): CardArtRenderer {
  if (typeof document === "undefined") {
    throw new Error("Card art rendering requires a browser DOM");
  }

  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("Card art dimensions must be positive integers");
  }

  const renderer = new THREE.WebGLRenderer({
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const cache = new Map<CardArtId, string>();
  let disposed = false;

  function renderMonster(cardId: AssignedMonsterId): string {
    const palette = getMonsterHologramPalette(cardId);
    const primary = palette.primary;
    const secondary = palette.secondary ?? primary;
    const backdrop = createBackdropTexture(
      width,
      height,
      primary,
      secondary,
    );

    const scene = new THREE.Scene();
    scene.background = backdrop;
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 20);
    camera.position.set(2.35, 1.65, 3.65);
    camera.lookAt(0, 0.78, 0);

    scene.add(new THREE.HemisphereLight(0xbceaff, 0x080b14, 1.4));

    const platform = new THREE.Mesh(
      new THREE.CircleGeometry(1.08, 40),
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: HOLOGRAM_ELEMENT_COLORS[primary],
        depthWrite: false,
        opacity: 0.24,
        transparent: true,
      }),
    );
    platform.rotation.x = -Math.PI / 2;
    platform.position.y = 0.01;
    scene.add(platform);

    const model = createMonsterModel(cardId);
    model.rotation.y = poseAngle(cardId);
    scene.add(model);
    scene.updateMatrixWorld(true);
    updateHologramTime(model, 3.25);

    renderer.render(scene, camera);
    const image = renderer.domElement.toDataURL("image/png");

    disposeObject(model);
    platform.geometry.dispose();
    platform.material.dispose();
    backdrop.dispose();
    return image;
  }

  function render(cardId: CardArtId): string {
    if (disposed) {
      throw new Error("Card art renderer has been disposed");
    }

    const cached = cache.get(cardId);
    if (cached) {
      return cached;
    }
    if (!CARD_ART_IDS.includes(cardId)) {
      throw new Error(`Unknown card art id: ${cardId}`);
    }

    const image = isSpellCardId(cardId)
      ? createSpellCardArt(cardId, { height, width })
      : renderMonster(cardId);
    cache.set(cardId, image);
    return image;
  }

  return {
    render,
    renderAll() {
      for (const cardId of CARD_ART_IDS) {
        render(cardId);
      }
      return new Map(cache);
    },
    dispose() {
      if (!disposed) {
        renderer.dispose();
        cache.clear();
        disposed = true;
      }
    },
  };
}
