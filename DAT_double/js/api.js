/**
 * DAT_double 資料庫 API 溝通模組
 */

/**
 * 產生符合 GUID 規範的 UUID v4 供雙人局 pairId 使用
 */
export function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 送出單一學生的 Session 數據至 API
 */
export async function sendSessionToApi(payload, player) {
  try {
    const response = await window.WebGameApi.submitSession(payload, { player });

    const resData = await response.json();
    if (response.ok) {
      console.log("✅ [DAT_double] 成績存檔成功:", resData);
      return { success: true, data: resData };
    } else {
      console.error("❌ [DAT_double] 存檔失敗 (HTTP " + response.status + "):", resData);
      return { success: false, error: resData };
    }
  } catch (err) {
    console.error("⚠️ [DAT_double] 成績 API 連線錯誤:", err);
    return { success: false, error: err };
  }
}
