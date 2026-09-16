// 成績送出端點的解析（單人與雙人共用同一套規則）。
//
// 瀏覽器端 JS 沒有真正的環境變數，這裡沿用中介平台前端（frontend/js/api.js）
// 已經在用的兩層機制，讓同一份程式碼在本機／正式站都不用改：
//
//   1. 部署或除錯時，在載入本檔案「之前」設定全域變數：
//      - `window.DCCS_SUBMIT_URL`：整支端點覆寫（最優先）。例如用
//        `backend/serve.py` 做離線落地時設成 '/api/results'。
//      - `window.API_BASE_URL`：只換 API 前綴，端點仍是 `<base>/sessions`。
//   2. 兩者都沒設時，依目前頁面的 hostname 自動判斷：本機開發
//      （localhost／127.0.0.1）指向同 hostname 的後端 5001 port；
//      其他情況一律指向正式部署的 Zeabur。
//
// 這樣本機測試不會把成績灌進正式庫——以前雙人版把正式站網址寫死在
// double.js，就是踩這個坑。

const DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const DEV_API_PORT = '5001';
const PROD_API_BASE_URL =
  'https://attention-lesson-plan-transfer-data.zeabur.app/api';

/** 中介平台 API 的前綴（不含結尾斜線）。 */
export function resolveApiBase() {
  const override =
    typeof window !== 'undefined' ? window.API_BASE_URL : null;
  if (override) return String(override).replace(/\/+$/, '');

  const { hostname, protocol } = window.location;
  if (DEV_HOSTNAMES.has(hostname)) {
    return `${protocol}//${hostname}:${DEV_API_PORT}/api`;
  }
  return PROD_API_BASE_URL;
}

/**
 * 成績要 POST 到哪裡。優先序：
 * window.DCCS_SUBMIT_URL > window.API_BASE_URL + '/sessions' > 依 hostname 推導。
 * @returns {string}
 */
export function resolveSubmitUrl() {
  const override =
    typeof window !== 'undefined' ? window.DCCS_SUBMIT_URL : null;
  if (override) return String(override);

  return `${resolveApiBase()}/sessions`;
}
