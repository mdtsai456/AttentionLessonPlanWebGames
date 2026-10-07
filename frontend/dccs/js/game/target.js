// 目標物狀態與移動（SPEC 4.8b）。ageMs 供 Track 計算輸入相關時間。

/**
 * @param {{frame: object|null, content: object|null}} targetSpec 來自 Trial.target
 * @param {number} spawnZ CONFIG.Z_SPAWN
 * @returns {object} Target 實例
 */
export function createTarget(targetSpec, spawnZ) {
  return {
    frame: targetSpec.frame,
    content: targetSpec.content,
    z: spawnZ,
    ageMs: 0,
    passedShape: false,
    passedObject: false,
  };
}

/**
 * 沿賽道中央線向鏡頭移動一個時間步。
 * @param {object} target createTarget() 回傳的物件
 * @param {number} dt 秒
 * @param {number} speed CONFIG.TARGET_SPEED
 */
export function stepTarget(target, dt, speed) {
  target.z -= speed * dt;
  target.ageMs += dt * 1000;
}

/**
 * 目標是否已抵達（或超過）某個 z 平面（由遠而近，z 遞減，故用 <=）。
 * @param {object} target
 * @param {number} z
 * @returns {boolean}
 */
export function hasReachedZ(target, z) {
  return target.z <= z;
}
