/** DAT_double 的資料庫 API 通訊模組 */

/** 產生符合 GUID 規範的 UUID v4，用作雙人場次的 pairId。 */
export function generateUUID() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
