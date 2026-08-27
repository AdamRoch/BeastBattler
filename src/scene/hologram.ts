import * as THREE from "three";

export const HOLOGRAM_ELEMENT_COLORS = {
  fire: 0xff4f2e,
  water: 0x22c9ff,
  earth: 0x8ed06c,
  air: 0xb9f5ff,
  lightning: 0xc58cff,
} as const;

export type HologramElement = keyof typeof HOLOGRAM_ELEMENT_COLORS;

export interface HologramPalette {
  primary: HologramElement;
  secondary?: HologramElement;
}

interface HologramState {
  baseScaleY: number;
  baseY: THREE.IUniform<number>;
  dissolve: THREE.IUniform<number>;
  flash: THREE.IUniform<number>;
  glitch: THREE.IUniform<number>;
  height: THREE.IUniform<number>;
  localMinYOffset: number;
  reveal: THREE.IUniform<number>;
  time: THREE.IUniform<number>;
}

export interface HologramAnimationState {
  dissolve: number;
  flash: number;
  glitch: number;
  reveal: number;
}

const hologramStates = new WeakMap<THREE.Object3D, HologramState>();

const vertexShader = /* glsl */ `
  uniform float uGlitchAmount;
  uniform float uPhase;
  uniform float uTime;

  varying vec3 vViewNormal;
  varying vec3 vViewDirection;
  varying vec3 vWorldPosition;

  void main() {
    vec3 animatedPosition = position;
    float glitchBand = step(
      0.72,
      fract(position.y * 8.0 + uTime * 3.2 + uPhase)
    );
    animatedPosition.x += (glitchBand - 0.5) * uGlitchAmount * 0.16;

    vec4 viewPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
    vec4 worldPosition = modelMatrix * vec4(animatedPosition, 1.0);

    vViewNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uPrimaryColor;
  uniform vec3 uSecondaryColor;
  uniform float uBaseY;
  uniform float uDissolveProgress;
  uniform float uFlashAmount;
  uniform float uHeight;
  uniform float uTime;
  uniform float uPhase;
  uniform float uRevealProgress;

  varying vec3 vViewNormal;
  varying vec3 vViewDirection;
  varying vec3 vWorldPosition;

  void main() {
    float normalizedHeight = clamp(
      (vWorldPosition.y - uBaseY) / max(uHeight, 0.001),
      0.0,
      1.0
    );
    float dissolveNoise = fract(sin(dot(
      floor(vWorldPosition * 31.0),
      vec3(12.9898, 78.233, 37.719)
    )) * 43758.5453);

    if (normalizedHeight > uRevealProgress + (dissolveNoise - 0.5) * 0.045) {
      discard;
    }
    if (normalizedHeight < uDissolveProgress + (dissolveNoise - 0.5) * 0.09) {
      discard;
    }

    float facing = abs(dot(normalize(vViewNormal), normalize(vViewDirection)));
    float fresnel = pow(1.0 - clamp(facing, 0.0, 1.0), 2.25);

    float scanWave = 0.5 + 0.5 * sin(
      vWorldPosition.y * 82.0 - uTime * 5.2 + uPhase
    );
    float scanline = smoothstep(0.82, 0.98, scanWave);

    float flicker = 0.965
      + 0.020 * sin(uTime * 7.0 + uPhase)
      + 0.010 * sin(uTime * 17.0 + uPhase * 1.7);

    float paletteMix = 0.5
      + 0.24 * sin(vWorldPosition.y * 3.6 + uPhase);
    vec3 projectionColor = mix(
      uPrimaryColor,
      uSecondaryColor,
      paletteMix
    );
    vec3 surfaceColor = mix(uBaseColor, projectionColor, 0.52);

    vec3 glow = surfaceColor * (0.54 + scanline * 0.24);
    glow += projectionColor * (fresnel * 1.35 + scanline * 0.34);
    glow = mix(glow, vec3(1.8), clamp(uFlashAmount, 0.0, 1.0));

    float alpha = (0.28 + fresnel * 0.46 + scanline * 0.12) * flicker;
    gl_FragColor = vec4(glow * flicker, alpha);
  }
`;

function materialColor(material: THREE.Material): THREE.Color {
  if (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshBasicMaterial ||
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshPhongMaterial
  ) {
    return material.color.clone();
  }

  return new THREE.Color(HOLOGRAM_ELEMENT_COLORS.air);
}

function phaseFromName(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return (hash / 0xffffffff) * Math.PI * 2;
}

function createHologramMaterial(
  source: THREE.Material,
  palette: HologramPalette,
  state: HologramState,
  phase: number,
): THREE.ShaderMaterial {
  const primaryColor = new THREE.Color(
    HOLOGRAM_ELEMENT_COLORS[palette.primary],
  );
  const secondaryColor = new THREE.Color(
    HOLOGRAM_ELEMENT_COLORS[palette.secondary ?? palette.primary],
  );

  const material = new THREE.ShaderMaterial({
    name: `${source.name || "monster"}-hologram`,
    uniforms: {
      uBaseColor: { value: materialColor(source) },
      uPrimaryColor: { value: primaryColor },
      uSecondaryColor: { value: secondaryColor },
      uBaseY: state.baseY,
      uDissolveProgress: state.dissolve,
      uFlashAmount: state.flash,
      uGlitchAmount: state.glitch,
      uHeight: state.height,
      uRevealProgress: state.reveal,
      uTime: state.time,
      uPhase: { value: phase },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  material.forceSinglePass = true;
  material.userData.isHologram = true;
  return material;
}

export function applyHologramTreatment<T extends THREE.Object3D>(
  model: T,
  palette: HologramPalette,
): T {
  if (hologramStates.has(model)) {
    return model;
  }

  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const worldPosition = model.getWorldPosition(new THREE.Vector3());
  const state: HologramState = {
    baseScaleY: model.scale.y,
    baseY: { value: bounds.min.y },
    dissolve: { value: 0 },
    flash: { value: 0 },
    glitch: { value: 0 },
    height: { value: Math.max(bounds.max.y - bounds.min.y, 0.001) },
    localMinYOffset: bounds.min.y - worldPosition.y,
    reveal: { value: 1 },
    time: { value: 0 },
  };
  const phase = phaseFromName(model.name);

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.material = Array.isArray(object.material)
      ? object.material.map((material) =>
          createHologramMaterial(material, palette, state, phase),
        )
      : createHologramMaterial(object.material, palette, state, phase);
  });

  hologramStates.set(model, state);
  return model;
}

export function updateHologramTime(
  model: THREE.Object3D,
  elapsedSeconds: number,
): void {
  const state = hologramStates.get(model);
  if (state) {
    state.time.value = elapsedSeconds;
    const position = model.getWorldPosition(new THREE.Vector3());
    const scale = model.getWorldScale(new THREE.Vector3());
    const scaleRatio = scale.y / Math.max(Math.abs(state.baseScaleY), 0.001);
    state.baseY.value = position.y + state.localMinYOffset * scaleRatio;
    state.height.value = Math.max(1.6 * Math.abs(scaleRatio), 0.001);
  }
}

export function setHologramAnimationState(
  model: THREE.Object3D,
  animation: Partial<HologramAnimationState>,
): void {
  const state = hologramStates.get(model);
  if (!state) {
    return;
  }

  if (animation.reveal !== undefined) {
    state.reveal.value = THREE.MathUtils.clamp(animation.reveal, 0, 1);
  }
  if (animation.flash !== undefined) {
    state.flash.value = THREE.MathUtils.clamp(animation.flash, 0, 1);
  }
  if (animation.dissolve !== undefined) {
    state.dissolve.value = THREE.MathUtils.clamp(animation.dissolve, 0, 1);
  }
  if (animation.glitch !== undefined) {
    state.glitch.value = THREE.MathUtils.clamp(animation.glitch, 0, 1);
  }
}

export function resetHologramAnimationState(model: THREE.Object3D): void {
  setHologramAnimationState(model, {
    dissolve: 0,
    flash: 0,
    glitch: 0,
    reveal: 1,
  });
}

export function isHologramMaterial(
  material: THREE.Material,
): material is THREE.ShaderMaterial {
  return (
    material instanceof THREE.ShaderMaterial &&
    material.userData.isHologram === true
  );
}
