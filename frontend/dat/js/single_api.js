//待分離 single api
export async function saveGameDataToBackend(data) {
  const url = "http://127.0.0.1:5001/api/sessions";
  //const url = "https://attention-lesson-plan-transfer-data.zeabur.app/api/sessions";
  const s1Id = sessionStorage.getItem("student1_key") || "訪客學生";
  const grade = s1Id.split("_")[0];
  const caseId = s1Id.split("_")[1];
  const school = sessionStorage.getItem('student1_school') || 'KMU'; // ⚠️ 需嚴格符合 KMU 或 NTHU-01~07
  const currentDay = parseInt(sessionStorage.getItem('currentDay') || '1', 10);

  const payload = {
    lessonId: "1140908_DAT", //待確認
    data: {
      grade: grade,
      caseId: caseId,
      school: school,
      currentDay: currentDay,
      startTime: data.startTime,
      endTime: Date.now(),
      mode: "single",
      stats: [
        { apiname: "DAT_correct",  value: data.score },
        { apiname: "DAT_wrong",    value: data.wrong },
        { apiname: "DAT_accuracy", value: data.accuracy / 100 },
        { apiname: "DAT_duration", value: data.duration }, // 正確對應傳入的 duration
        { apiname: "DAT_stage",    value: data.stage }    // 正確對應傳入的 stage
      ]
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 201) {
      const result = await res.json();
      console.log('✅ [API 成功] 資料已成功寫入資料庫！Session ID:', result.sessionId);
    } else {
      const errData = await res.json().catch(() => ({}));
      console.error(`❌ [API 錯誤 ${res.status}]:`, errData.detail || '寫入失敗');
    }
  } catch (err) {
    console.error('❌ [API 網路連線異常]:', err);
  }
}