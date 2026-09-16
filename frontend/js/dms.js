import { API } from './api.js';

// 2026-09-11：帳密登入上線後，身份在登入頁就確定了（見 docs/adr/0004）。
// 這頁不再有「選場域→選老師」兩層下拉，也拿掉「學生自查模式」——
// 學生現在有自己的登入+遊戲大廳（games.html），不會用這頁。
// 未登入（沒有 token）一律導回登入頁。

const token = sessionStorage.getItem('token');
const teacherName = sessionStorage.getItem('teacher_name');
const teacherSchool = sessionStorage.getItem('teacher_school');

if (!token || sessionStorage.getItem('user_role') !== 'teacher') {
  window.location.href = 'index.html';
}

const studentSelect = document.getElementById('select-student');
const btnLogout = document.getElementById('btn-logout');
const emptyState = document.getElementById('empty-state');
const reportView = document.getElementById('report-view');

document.getElementById('view-teacher-name').textContent = `${teacherName || '--'} 老師`;
document.getElementById('view-teacher-school').textContent = teacherSchool || '--';

btnLogout.addEventListener('click', async () => {
  await API.logout();
  sessionStorage.clear();
  window.location.href = 'index.html';
});

async function init() {
  try {
    const data = await API.getMyStudents();
    renderStudentOptions(data.students);
  } catch (e) {
    studentSelect.innerHTML = '<option value="">載入學生名冊失敗，請重新登入</option>';
  }
}

function renderStudentOptions(students) {
  if (!students || students.length === 0) {
    studentSelect.innerHTML = '<option value="">目前場域尚無學生名冊</option>';
    return;
  }
  studentSelect.innerHTML = '<option value="">-- 選擇學生個案 --</option>';
  students.forEach((st) => {
    studentSelect.innerHTML += `<option value="${st.studentKey}">個案 ${st.studentKey} (已測 ${st.sessionCount} 場)</option>`;
  });
  studentSelect.disabled = false;
}

// 選擇學生後：載入報表
studentSelect.addEventListener('change', async () => {
  const studentKey = studentSelect.value;
  if (!studentKey) {
    emptyState.style.display = 'block';
    reportView.style.display = 'none';
    return;
  }

  try {
    const report = await API.getStudentReport(studentKey, teacherSchool);
    renderDashboard(report);
  } catch (err) {
    alert('載入評測報告失敗，請確認後端服務是否已啟動');
  }
});

// 渲染 Dashboard 畫面
function renderDashboard(report) {
  emptyState.style.display = 'none';
  reportView.style.display = 'block';

  document.getElementById('view-student-key').innerText = `受試個案：${report.studentKey}`;
  document.getElementById('view-school-name').innerText = `所屬場域：${teacherSchool || report.school}`;
  document.getElementById('view-total-sessions').innerText = report.totalSessions;

  const lastRecord = report.records && report.records[0];
  document.getElementById('view-last-played').innerText = lastRecord ? lastRecord.startTime : '尚無評測紀錄';

  // 渲染 summaryByGame (區分 single / double)
  const summaryGrid = document.getElementById('summary-grid');
  summaryGrid.innerHTML = '';

  if (!report.summaryByGame || report.summaryByGame.length === 0) {
    summaryGrid.innerHTML = '<p style="color:#94a3b8;">尚無任何遊戲彙總資料</p>';
  } else {
    report.summaryByGame.forEach((item) => {
      const isSingle = item.mode.toLowerCase() === 'single';
      const accPercent = (item.avgAccuracy * 100).toFixed(0);
      const durationSec = Math.round(item.totalDuration / 1000);

      summaryGrid.innerHTML += `
        <div class="game-summary-card ${isSingle ? 'single' : 'double'}">
          <div class="card-head">
            <span>${item.gameType}</span>
            <span class="mode-tag ${isSingle ? 'single' : 'double'}">${item.mode.toUpperCase()}</span>
          </div>
          <p style="font-size: 0.8rem; color: #64748b; margin-bottom: 6px;">場次：${item.sessionCount} 次</p>
          <div style="font-size: 1.15rem; font-weight: bold; color: #1e3a8a; margin-bottom: 4px;">
            正確率：${accPercent}%
          </div>
          <div style="font-size: 0.78rem; color: #475569;">
            對/錯：${item.totalCorrect} / ${item.totalWrong} | 總耗時：${durationSec}s
          </div>
        </div>
      `;
    });
  }

  // 渲染 records 明細表格
  const recordsTbody = document.getElementById('records-tbody');
  recordsTbody.innerHTML = '';

  if (!report.records || report.records.length === 0) {
    recordsTbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">尚無施測紀錄</td></tr>';
  } else {
    report.records.forEach((rec) => {
      const stats = rec.stats || {};
      const acc = stats.accuracy !== undefined ? `${(stats.accuracy * 100).toFixed(0)}%` : '--';
      const duration = stats.duration !== undefined ? `${Math.round(stats.duration / 1000)}s` : '--';

      recordsTbody.innerHTML += `
        <tr>
          <td>Day ${rec.currentDay}</td>
          <td><strong>${rec.gameType}</strong></td>
          <td><span class="mode-tag ${rec.mode}">${rec.mode}</span></td>
          <td><strong>${acc}</strong></td>
          <td>${stats.correctCount ?? '--'} / ${stats.wrongCount ?? '--'}</td>
          <td>${duration}</td>
          <td>${stats.stage ?? '--'}</td>
          <td style="color:#64748b;">${rec.startTime}</td>
        </tr>
      `;
    });
  }
}

init();
