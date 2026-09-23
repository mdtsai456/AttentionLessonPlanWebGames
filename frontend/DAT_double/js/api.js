/**
 * DAT_double 資料庫 API 溝通模組
 */

// 指向本地 local_sqlite_server.py 後端埠號
const API_BASE_URL = "http://127.0.0.1:5002";
// const API_BASE_URL = "https://attention-lesson-plan-transfer-data.zeabur.app"; // 切換至中央伺服器時取消這行註解

/**
 * 產生符合 GUID 規範的 UUID v4 供雙人局 pairId 使用
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 送出單一學生的 Session 數據至 API (SQLite 存檔)
 */
export async function sendSessionToApi(payload) {
  const endpoint = `${API_BASE_URL}/api/sessions`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const resData = await response.json();
    if (response.ok) {
      console.log("✅ [DAT_double] 本地 SQLite 資料庫存檔成功:", resData);
      return { success: true, data: resData };
    } else {
      console.error("❌ [DAT_double] 存檔失敗 (HTTP " + response.status + "):", resData);
      return { success: false, error: resData };
    }
  } catch (err) {
    console.error("⚠️ [DAT_double] 本地 API 連線錯誤 (請確認 python local_sqlite_server.py 是否已啟動):", err);
    return { success: false, error: err };
  }
}