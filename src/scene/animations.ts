import * as THREE from "three";

import {
  resetHologramAnimationState,
  setHologramAnimationState,
} from "./hologram";
import type { PlayerSide } from "./zones";

export interface AnimationPoint {
  x: number;
  y: number;
  z: number;
}

export type AnimationAnchor =
  | { kind: "monster"; monsterId: string }
  | { kind: "side"; side: PlayerSide }
  | { kind: "point"; position: AnimationPoint };

export type SpellAnimation =
  | "bolt"
  | "destroy"
  | "draw"
  | "counterspell";

export type ArenaAnimationEvent =
  | { type: "summon"; monsterId: string }
  | {
      type: "combat-link";
      attackerId: string;
      target: AnimationAnchor;
    }
  | {
      type: "attack";
      attackerId: string;
      target: AnimationAnchor;
    }
  | { type: "hit"; monsterId: string; from?: AnimationAnchor }
  | { type: "death"; monsterId: string }
  | {
      type: "fusion";
      sourceIds: readonly [string, string];
      resultId: string;
      variant?: "fusion" | "star3";
    }
  | {
      type: "spell";
      spell: SpellAnimation;
      source: AnimationAnchor;
      target?: AnimationAnchor;
    }
  | {
      type: "burst";
      source: AnimationAnchor;
      target: AnimationAnchor;
    };

export interface ArenaAnimationSystem {
  effectLayer: THREE.Group;
  dispatch(event: ArenaAnimationEvent): void;
  update(elapsedSeconds: number): void;
  getActiveCount(): number;
}

export interface ArenaAnimationContext {
  camera: THREE.PerspectiveCamera;
  getMonster(monsterId: string): THREE.Object3D | undefined;
}

interface Timeline {
  duration: number;
  finish(): void;
  startTime: number | undefined;
  update(progress: number, elapsed: number): void;
}

const WHITE = 0xffffff;
const BLUE = 0x4caeff;
const BOLT = 0xbbe8ff;
const DESTROY = 0xff693d;
const DRAW = 0x75f4ff;
const BURST = 0xffd35a;
const TAU = Math.PI * 2;

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const normalized = clamp01((value - edge0) / (edge1 - edge0));
  return normalized * normalized * (3 - 2 * normalized);
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function cameraFacingYaw(
  monster: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
): number {
  const monsterPosition = monster.getWorldPosition(new THREE.Vector3());
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  return Math.atan2(
    monsterPosition.x - cameraPosition.x,
    monsterPosition.z - cameraPosition.z,
  );
}

function showcaseYawDelta(from: number, to: number): number {
  const shortest = THREE.MathUtils.euclideanModulo(to - from + Math.PI, TAU)
    - Math.PI;
  return shortest === 0
    ? TAU
    : shortest - Math.sign(shortest) * TAU;
}

function basicGlowMaterial(
  color: THREE.ColorRepresentation,
  opacity = 1,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color,
    depthWrite: false,
    opacity,
    side: THREE.DoubleSide,
    transparent: true,
  });
}

function disposeEffect(effect: THREE.Object3D): void {
  effect.removeFromParent();
  effect.traverse((object) => {
    if (
      !(
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points ||
        object instanceof THREE.Line
      )
    ) {
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

function createFlash(
  position: THREE.Vector3,
  color: THREE.ColorRepresentation = WHITE,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 8),
    basicGlowMaterial(color, 0),
  );
  flash.name = "animation-flash";
  flash.position.copy(position);
  flash.scale.setScalar(0.01);
  return flash;
}

function createBeam(position: THREE.Vector3): {
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  root: THREE.Group;
} {
  const root = new THREE.Group();
  root.name = "summon-beam";
  root.position.copy(position);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.5, 4.8, 16, 1, true),
    basicGlowMaterial(BLUE, 0),
  );
  beam.position.y = 2.4;
  root.add(beam);

  const particleCount = 34;
  const positions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    const angle = index * 2.399;
    const radius = 0.15 + ((index * 17) % 23) / 48;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = ((index * 37) % 100) / 42;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xbdefff,
      depthWrite: false,
      opacity: 0,
      size: 0.075,
      sizeAttenuation: true,
      transparent: true,
    }),
  );
  root.add(particles);
  return { beam, particles, root };
}

function createStreak(
  from: THREE.Vector3,
  color: THREE.ColorRepresentation,
  size: number,
): {
  head: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  root: THREE.Group;
} {
  const root = new THREE.Group();
  root.name = "projectile-streak";

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(6), 3),
  );
  const line = new THREE.Line(
    lineGeometry,
    new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color,
      depthWrite: false,
      opacity: 0.9,
      transparent: true,
    }),
  );
  root.add(line);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(size, 10, 8),
    basicGlowMaterial(color, 0.95),
  );
  head.position.copy(from);
  root.add(head);
  return { head, line, root };
}

function updateStreak(
  streak: ReturnType<typeof createStreak>,
  from: THREE.Vector3,
  to: THREE.Vector3,
  progress: number,
): void {
  const headPosition = from.clone().lerp(to, easeOutCubic(progress));
  const tailProgress = Math.max(progress - 0.22, 0);
  const tailPosition = from.clone().lerp(to, easeOutCubic(tailProgress));
  streak.head.position.copy(headPosition);

  const positions = streak.line.geometry.getAttribute(
    "position",
  ) as THREE.BufferAttribute;
  positions.setXYZ(0, tailPosition.x, tailPosition.y, tailPosition.z);
  positions.setXYZ(1, headPosition.x, headPosition.y, headPosition.z);
  positions.needsUpdate = true;
}

function sidePosition(side: PlayerSide): THREE.Vector3 {
  return new THREE.Vector3(
    side === "player" ? -4.5 : 4.5,
    2.25,
    side === "player" ? 5.3 : -5.3,
  );
}

export function createArenaAnimationSystem(
  context: ArenaAnimationContext,
): ArenaAnimationSystem {
  const effectLayer = new THREE.Group();
  effectLayer.name = "arena-animation-effects";
  const timelines: Timeline[] = [];
  let currentTime: number | undefined;

  function requireMonster(monsterId: string): THREE.Object3D {
    const monster = context.getMonster(monsterId);
    if (!monster) {
      throw new Error(`Cannot animate missing monster: ${monsterId}`);
    }
    return monster;
  }

  function anchorPosition(anchor: AnimationAnchor): THREE.Vector3 {
    switch (anchor.kind) {
      case "monster": {
        const position = requireMonster(anchor.monsterId).getWorldPosition(
          new THREE.Vector3(),
        );
        position.y += 0.8;
        return position;
      }
      case "side":
        return sidePosition(anchor.side);
      case "point":
        return new THREE.Vector3(
          anchor.position.x,
          anchor.position.y,
          anchor.position.z,
        );
    }
  }

  function schedule(
    duration: number,
    update: Timeline["update"],
    finish: Timeline["finish"],
  ): void {
    timelines.push({ duration, finish, startTime: currentTime, update });
  }

  function playSummon(monsterId: string): void {
    const monster = requireMonster(monsterId);
    const baseScale = monster.scale.clone();
    const position = monster.getWorldPosition(new THREE.Vector3());
    const effect = createBeam(position);
    effectLayer.add(effect.root);
    monster.visible = true;
    setHologramAnimationState(monster, {
      dissolve: 0,
      flash: 0,
      glitch: 0,
      reveal: 0,
    });

    schedule(
      1.35,
      (progress, elapsed) => {
        const reveal = smoothstep(0.08, 0.86, progress);
        const pulse = Math.sin(progress * Math.PI);
        effect.beam.material.opacity = pulse * 0.34;
        effect.beam.scale.x = 0.7 + pulse * 0.5;
        effect.beam.scale.z = effect.beam.scale.x;
        effect.particles.material.opacity = pulse * 0.82;
        effect.particles.rotation.y = elapsed * 2.2;
        effect.particles.position.y = progress * 0.75;
        monster.scale.copy(baseScale).multiplyScalar(0.92 + reveal * 0.08);
        setHologramAnimationState(monster, {
          flash: Math.max(0, 1 - Math.abs(progress - 0.72) * 12) * 0.28,
          reveal,
        });
      },
      () => {
        monster.scale.copy(baseScale);
        resetHologramAnimationState(monster);
        disposeEffect(effect.root);
      },
    );
  }

  function playAttack(attackerId: string, target: AnimationAnchor): void {
    const attacker = requireMonster(attackerId);
    const basePosition = attacker.position.clone();
    const targetPosition = anchorPosition(target);
    const worldPosition = attacker.getWorldPosition(new THREE.Vector3());
    const direction = targetPosition.clone().sub(worldPosition);
    direction.y = 0;
    const lungeDistance = Math.min(direction.length() * 0.45, 2.15);
    direction.normalize().multiplyScalar(lungeDistance);

    const flash = createFlash(targetPosition);
    effectLayer.add(flash);
    schedule(
      0.72,
      (progress, elapsed) => {
        const outbound = smoothstep(0, 0.56, progress);
        const inbound = smoothstep(0.56, 1, progress);
        const lunge = outbound * (1 - inbound);
        attacker.position.copy(basePosition).addScaledVector(direction, lunge);

        const impact = Math.max(0, 1 - Math.abs(progress - 0.56) * 13);
        flash.material.opacity = impact * 0.9;
        flash.scale.setScalar(0.1 + impact * 2.2);
        if (impact > 0) {
          const shake = impact * 0.045;
          context.camera.position.x += Math.sin(elapsed * 92) * shake;
          context.camera.position.y += Math.cos(elapsed * 77) * shake * 0.65;
        }
      },
      () => {
        attacker.position.copy(basePosition);
        disposeEffect(flash);
      },
    );
  }

  function playCombatLink(attackerId: string, target: AnimationAnchor): void {
    const from = requireMonster(attackerId).getWorldPosition(new THREE.Vector3());
    from.y += 0.8;
    const to = anchorPosition(target);
    const positions = new Float32Array(6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x7be6ff,
      depthWrite: false,
      opacity: 0,
      transparent: true,
    });
    const line = new THREE.Line(geometry, material);
    line.name = "combat-link";
    effectLayer.add(line);

    schedule(
      0.72,
      (progress) => {
        const end = from.clone().lerp(to, smoothstep(0, 0.42, progress));
        const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
        attribute.setXYZ(0, from.x, from.y, from.z);
        attribute.setXYZ(1, end.x, end.y, end.z);
        attribute.needsUpdate = true;
        material.opacity = smoothstep(0, 0.16, progress) * (1 - smoothstep(0.78, 1, progress));
      },
      () => disposeEffect(line),
    );
  }

  function playHit(monsterId: string, from?: AnimationAnchor): void {
    const monster = requireMonster(monsterId);
    const basePosition = monster.position.clone();
    const baseRotation = monster.rotation.clone();
    const worldPosition = monster.getWorldPosition(new THREE.Vector3());
    const away = from
      ? worldPosition.clone().sub(anchorPosition(from))
      : new THREE.Vector3(0.35, 0, 0.25);
    away.y = 0;
    away.normalize();

    schedule(
      0.48,
      (progress) => {
        const envelope = Math.sin(progress * Math.PI) * (1 - progress * 0.35);
        monster.position.copy(basePosition).addScaledVector(away, envelope * 0.28);
        monster.rotation.z =
          baseRotation.z + Math.sin(progress * Math.PI * 6) * envelope * 0.11;
        setHologramAnimationState(monster, {
          flash: Math.max(0, 1 - progress * 4.2),
        });
      },
      () => {
        monster.position.copy(basePosition);
        monster.rotation.copy(baseRotation);
        setHologramAnimationState(monster, { flash: 0 });
      },
    );
  }

  function playDeath(monsterId: string): void {
    const monster = requireMonster(monsterId);
    const basePosition = monster.position.clone();
    const baseRotation = monster.rotation.clone();
    monster.visible = true;

    schedule(
      1.05,
      (progress) => {
        const dissolve = smoothstep(0.08, 0.96, progress);
        monster.position.y = basePosition.y + progress * 0.65;
        monster.rotation.y =
          baseRotation.y + Math.sin(progress * Math.PI * 14) * progress * 0.045;
        setHologramAnimationState(monster, {
          dissolve,
          glitch: Math.sin(progress * Math.PI) * 0.9,
        });
      },
      () => {
        monster.visible = false;
        monster.position.copy(basePosition);
        monster.rotation.copy(baseRotation);
        resetHologramAnimationState(monster);
      },
    );
  }

  function playFusion(
    sourceIds: readonly [string, string],
    resultId: string,
    variant: "fusion" | "star3",
  ): void {
    const sources = sourceIds.map(requireMonster) as [
      THREE.Object3D,
      THREE.Object3D,
    ];
    const result = requireMonster(resultId);
    const sourcePositions = sources.map((source) => source.position.clone()) as [
      THREE.Vector3,
      THREE.Vector3,
    ];
    const center = result.position.clone();
    const resultScale = result.scale.clone();
    const resultRotation = result.rotation.clone();
    const resultShowcaseYaw = cameraFacingYaw(result, context.camera);
    const resultRotationDelta = showcaseYawDelta(
      resultShowcaseYaw,
      resultRotation.y,
    );
    const flash = createFlash(
      result.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0)),
    );
    effectLayer.add(flash);

    result.visible = true;
    result.scale.copy(resultScale).multiplyScalar(1.55);
    result.rotation.y = resultShowcaseYaw;
    setHologramAnimationState(result, { reveal: 0 });
    for (const source of sources) {
      source.visible = true;
      resetHologramAnimationState(source);
    }

    const duration = variant === "star3" ? 1.35 : 2.4;
    const turns = variant === "star3" ? 0.8 : 1.55;
    schedule(
      duration,
      (progress) => {
        const spiral = smoothstep(0.02, 0.6, progress);
        sources.forEach((source, index) => {
          const offset = sourcePositions[index].clone().sub(center);
          const radius = Math.hypot(offset.x, offset.z) * (1 - spiral);
          const startAngle = Math.atan2(offset.z, offset.x);
          const direction = index === 0 ? 1 : -1;
          const angle = startAngle + direction * turns * TAU * spiral;
          source.position.set(
            center.x + Math.cos(angle) * radius,
            THREE.MathUtils.lerp(
              sourcePositions[index].y,
              center.y,
              spiral,
            ) + Math.sin(spiral * Math.PI) * 0.85,
            center.z + Math.sin(angle) * radius,
          );
          setHologramAnimationState(source, {
            dissolve: smoothstep(0.4, 0.62, progress),
            glitch: smoothstep(0.32, 0.6, progress) * 0.75,
          });
          if (progress > 0.63) {
            source.visible = false;
          }
        });

        const flashEnvelope = Math.max(0, 1 - Math.abs(progress - 0.62) * 9);
        flash.material.opacity = flashEnvelope;
        flash.scale.setScalar(0.2 + flashEnvelope * 4.2);

        const reveal = smoothstep(0.6, 0.96, progress);
        const showcaseRotation = smoothstep(0.48, 1, progress);
        result.scale
          .copy(resultScale)
          .multiplyScalar(THREE.MathUtils.lerp(1.55, 1.35, reveal));
        result.rotation.y =
          resultShowcaseYaw + resultRotationDelta * showcaseRotation;
        setHologramAnimationState(result, {
          flash: flashEnvelope * 0.8,
          reveal,
        });
      },
      () => {
        sources.forEach((source, index) => {
          source.position.copy(sourcePositions[index]);
          source.visible = false;
          resetHologramAnimationState(source);
        });
        result.scale.copy(resultScale).multiplyScalar(1.35);
        result.rotation.copy(resultRotation);
        resetHologramAnimationState(result);
        disposeEffect(flash);
      },
    );
  }

  function playProjectile(
    source: AnimationAnchor,
    target: AnimationAnchor,
    color: THREE.ColorRepresentation,
    duration: number,
    size: number,
  ): void {
    const from = anchorPosition(source);
    const to = anchorPosition(target);
    const streak = createStreak(from, color, size);
    const flash = createFlash(to, color);
    effectLayer.add(streak.root, flash);

    schedule(
      duration,
      (progress) => {
        updateStreak(streak, from, to, progress);
        const impact = smoothstep(0.78, 1, progress);
        streak.head.material.opacity = 1 - impact;
        streak.line.material.opacity = 0.9 * (1 - impact);
        flash.material.opacity = Math.sin(impact * Math.PI) * 0.85;
        flash.scale.setScalar(0.05 + impact * 1.45);
      },
      () => {
        disposeEffect(streak.root);
        disposeEffect(flash);
      },
    );
  }

  function playDestroy(target: AnimationAnchor): void {
    const position = anchorPosition(target);
    const root = new THREE.Group();
    root.name = "destroy-shatter";
    root.position.copy(position);
    const shards: THREE.Mesh[] = [];
    const directions: THREE.Vector3[] = [];
    for (let index = 0; index < 18; index += 1) {
      const shard = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.07 + (index % 4) * 0.018),
        basicGlowMaterial(index % 2 === 0 ? DESTROY : WHITE, 0.9),
      );
      shards.push(shard);
      root.add(shard);
      const angle = (index / 18) * TAU;
      directions.push(
        new THREE.Vector3(
          Math.cos(angle),
          0.25 + ((index * 7) % 10) / 10,
          Math.sin(angle),
        ).normalize(),
      );
    }
    effectLayer.add(root);

    schedule(
      0.82,
      (progress) => {
        shards.forEach((shard, index) => {
          shard.position.copy(directions[index]).multiplyScalar(progress * 1.5);
          shard.rotation.set(
            progress * (index + 2),
            progress * (index + 1.5),
            progress * 3,
          );
          const material = shard.material as THREE.MeshBasicMaterial;
          material.opacity = 1 - smoothstep(0.45, 1, progress);
        });
      },
      () => disposeEffect(root),
    );
  }

  function playDraw(source: AnimationAnchor): void {
    const origin = anchorPosition(source);
    const root = new THREE.Group();
    root.name = "draw-flourish";
    root.position.copy(origin);
    const cards: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
    for (let index = 0; index < 5; index += 1) {
      const card = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.62),
        basicGlowMaterial(DRAW, 0),
      );
      cards.push(card);
      root.add(card);
    }
    root.lookAt(context.camera.position);
    effectLayer.add(root);

    schedule(
      0.9,
      (progress) => {
        const reveal = smoothstep(0, 0.3, progress);
        const fade = 1 - smoothstep(0.68, 1, progress);
        cards.forEach((card, index) => {
          const spread = index - 2;
          card.position.set(
            spread * 0.22 * reveal,
            progress * 1.25 + Math.abs(spread) * 0.04,
            -Math.abs(spread) * 0.025,
          );
          card.rotation.z = -spread * 0.12 * reveal;
          card.material.opacity = reveal * fade * 0.82;
        });
      },
      () => disposeEffect(root),
    );
  }

  function playCounterspell(target: AnimationAnchor): void {
    const position = anchorPosition(target);
    const root = new THREE.Group();
    root.name = "counterspell-ripple";
    root.position.copy(position);
    root.lookAt(context.camera.position);
    const rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
    for (let index = 0; index < 3; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.5, 48),
        basicGlowMaterial(BLUE, 0),
      );
      rings.push(ring);
      root.add(ring);
    }
    effectLayer.add(root);

    schedule(
      0.95,
      (progress) => {
        rings.forEach((ring, index) => {
          const local = clamp01(progress * 1.7 - index * 0.22);
          ring.scale.setScalar(0.25 + easeOutCubic(local) * 3.2);
          ring.material.opacity = Math.sin(local * Math.PI) * 0.72;
        });
      },
      () => disposeEffect(root),
    );
  }

  function playSpell(
    spell: SpellAnimation,
    source: AnimationAnchor,
    target?: AnimationAnchor,
  ): void {
    switch (spell) {
      case "bolt":
        if (!target) {
          throw new Error("Bolt animation requires a target");
        }
        playProjectile(source, target, BOLT, 0.62, 0.11);
        return;
      case "destroy":
        if (!target) {
          throw new Error("Destroy animation requires a target");
        }
        playDestroy(target);
        return;
      case "draw":
        playDraw(source);
        return;
      case "counterspell":
        playCounterspell(target ?? source);
        return;
    }
  }

  function dispatch(event: ArenaAnimationEvent): void {
    switch (event.type) {
      case "summon":
        playSummon(event.monsterId);
        return;
      case "combat-link":
        playCombatLink(event.attackerId, event.target);
        return;
      case "attack":
        playAttack(event.attackerId, event.target);
        return;
      case "hit":
        playHit(event.monsterId, event.from);
        return;
      case "death":
        playDeath(event.monsterId);
        return;
      case "fusion":
        playFusion(
          event.sourceIds,
          event.resultId,
          event.variant ?? "fusion",
        );
        return;
      case "spell":
        playSpell(event.spell, event.source, event.target);
        return;
      case "burst":
        playProjectile(event.source, event.target, BURST, 0.44, 0.075);
        return;
    }
  }

  function update(elapsedSeconds: number): void {
    currentTime = elapsedSeconds;
    for (let index = timelines.length - 1; index >= 0; index -= 1) {
      const timeline = timelines[index];
      timeline.startTime ??= elapsedSeconds;
      const elapsed = Math.max(elapsedSeconds - timeline.startTime, 0);
      const progress = clamp01(elapsed / timeline.duration);
      timeline.update(progress, elapsed);
      if (progress >= 1) {
        timeline.finish();
        timelines.splice(index, 1);
      }
    }
  }

  return {
    effectLayer,
    dispatch,
    update,
    getActiveCount: () => timelines.length,
  };
}
