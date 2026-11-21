export function isMobileOrLowEnd() {
  const coarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;
  const touchPoints =
    typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  const lowMemory =
    typeof navigator !== "undefined" &&
    typeof navigator.deviceMemory === "number" &&
    navigator.deviceMemory <= 4;
  const uaMobile =
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  return Boolean(coarsePointer || (touchPoints && lowMemory) || uaMobile);
}

export function getModelUrl(fileName) {
  if (fileName === "Room.glb") {
    return "/models/Room.glb";
  }
  return isMobileOrLowEnd()
    ? `/models/mobile/${fileName}`
    : `/models/${fileName}`;
}

export function disposeObject3D(root, scene) {
  if (!root) return;

  if (scene && root.parent === scene) {
    scene.remove(root);
  } else if (root.parent) {
    root.parent.remove(root);
  }

  root.traverse((obj) => {
    if (obj.geometry) {
      obj.geometry.dispose();
    }
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat) continue;
        for (const val of Object.values(mat)) {
          if (val && val.isTexture) {
            val.dispose();
          }
        }
        mat.dispose();
      }
    }
  });
}