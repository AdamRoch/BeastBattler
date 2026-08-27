import * as THREE from "three";

const INDICATOR_NAME = "summoning-sickness-indicator";

function disposeIndicator(indicator: THREE.Object3D): void {
  indicator.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

function createIndicator(monster: THREE.Object3D): THREE.Group {
  monster.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(monster);
  const monsterPosition = monster.getWorldPosition(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z, 0.72) * 0.46;
  const indicator = new THREE.Group();
  indicator.name = INDICATOR_NAME;
  indicator.position.y = bounds.max.y - monsterPosition.y + 0.18;
  indicator.userData.baseY = indicator.position.y;

  const material = new THREE.MeshBasicMaterial({
    color: 0xa5eaff,
    transparent: true,
    opacity: 0.48,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.018, 4, 24, Math.PI * 1.65),
    material,
  );
  ring.rotation.x = Math.PI / 2;
  indicator.add(ring);

  const trailingRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.72, 0.012, 4, 18, Math.PI * 0.72),
    material.clone(),
  );
  trailingRing.rotation.set(Math.PI / 2, 0.72, Math.PI * 0.92);
  trailingRing.position.y = 0.045;
  indicator.add(trailingRing);

  return indicator;
}

export function setSummoningSicknessIndicator(
  monster: THREE.Object3D,
  summoningSick: boolean,
): void {
  const existing = monster.getObjectByName(INDICATOR_NAME);
  if (summoningSick) {
    if (!existing) {
      monster.add(createIndicator(monster));
    }
    return;
  }

  if (existing) {
    existing.removeFromParent();
    disposeIndicator(existing);
  }
}

export function updateSummoningSicknessIndicator(
  monster: THREE.Object3D,
  elapsedSeconds: number,
): void {
  const indicator = monster.getObjectByName(INDICATOR_NAME);
  if (!indicator) {
    return;
  }

  const baseY = indicator.userData.baseY as number;
  indicator.rotation.y = elapsedSeconds * 0.72;
  indicator.position.y = baseY + Math.sin(elapsedSeconds * 1.8) * 0.035;
}

export function hasSummoningSicknessIndicator(monster: THREE.Object3D): boolean {
  return Boolean(monster.getObjectByName(INDICATOR_NAME));
}
