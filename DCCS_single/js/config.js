// 遊戲常數（SPEC 4.1）。
export const CONFIG = Object.freeze({
  // 投影設定只影響畫面，不影響成績。
  VANISHING_Y: 0.385,
  BASE_Y: 1.04,
  ROAD_CX: 0.5,
  ROAD_HALF_W: 0.344,
  CAM_DEPTH: 10.5,
  SPRITE_BASE: 0.205,
  // 僅供目標物使用。閥門選項維持線性透視。
  TARGET_PERSPECTIVE: 0.6,
  // 賽道
  Z_SPAWN: 38.0,
  Z_VALVE_SHAPE: 12.0,
  Z_VALVE_OBJECT: 4.0,
  TARGET_SPEED: 7.0,
  // 閥
  ROT_SEC_PER_SLOT: 0.30,
  SLOT_LANE_SPACING: 1.3,
  SLOT_RENDER_LIMIT: 4.0,
  // 場次
  // Track 依關卡數平均分配場次時間：360／6 = 60 秒。
  SESSION_SECONDS: 360,
  // 回饋
  TICK_FEEDBACK_SECONDS: 0.6,
  // HUD 分數條的滿格顯示基準。分數沒有固定上限。
  // 計分改為逐題計算後，一場的最高分由 112 降至約 56。此值由 60 減半，
  // 使分數條維持原來的填滿比例。計分規則變更時，須重新計算此值。
  SCORE_BAR_FULL: 30,
  // 迴圈
  FIXED_DT: 1 / 60,
  MAX_FRAME_DT: 0.25,
});
