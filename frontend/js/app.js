import { API } from './api.js';

document.addEventListener("DOMContentLoaded", () => {
  let currentRole = "student";
  let currentMode = "single";

  const btnStudent = document.getElementById("btn-role-student");
  const btnTeacher = document.getElementById("btn-role-teacher");
  const btnSingle = document.getElementById("btn-mode-single");
  const btnDouble = document.getElementById("btn-mode-double");

  const modeSection = document.getElementById("mode-section");
  const studentInputs = document.getElementById("student-inputs");
  const teacherInputs = document.getElementById("teacher-inputs");
  const colStudent2 = document.getElementById("col-student-2");
  const lblStudent1 = document.getElementById("lbl-student-1");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const btnEnter = document.getElementById("btn-enter");

  const teacherAccount = document.getElementById("teacher-account");
  const teacherPassword = document.getElementById("teacher-password");

  const student1Account = document.getElementById("student1-account");
  const student1Password = document.getElementById("student1-password");
  const student2Account = document.getElementById("student2-account");
  const student2Password = document.getElementById("student2-password");

  function showError(message) {
    loginError.textContent = message;
    loginError.style.display = "block";
  }

  function clearError() {
    loginError.style.display = "none";
    loginError.textContent = "";
  }

  // 1. 切換身分：學生
  btnStudent.addEventListener("click", () => {
    currentRole = "student";
    btnStudent.className = "btn btn-pill active-green";
    btnTeacher.className = "btn btn-pill btn-inactive-blue";

    modeSection.style.display = "block";
    studentInputs.style.display = "block";
    teacherInputs.style.display = "none";
    clearError();

    // 隱藏欄位不能是 required，否則瀏覽器原生驗證會擋下 submit 卻沒有任何提示
    student1Account.required = true;
    student1Password.required = true;
    teacherAccount.required = false;
    teacherPassword.required = false;
  });

  // 2. 切換身分：老師
  btnTeacher.addEventListener("click", () => {
    currentRole = "teacher";
    btnTeacher.className = "btn btn-pill active-blue";
    btnStudent.className = "btn btn-pill btn-inactive";

    modeSection.style.display = "none";
    studentInputs.style.display = "none";
    teacherInputs.style.display = "block";
    clearError();

    student1Account.required = false;
    student1Password.required = false;
    teacherAccount.required = true;
    teacherPassword.required = true;
  });

  // 3. 切換模式：單人
  btnSingle.addEventListener("click", () => {
    currentMode = "single";
    btnSingle.className = "btn btn-pill active-green";
    btnDouble.className = "btn btn-pill btn-inactive";

    colStudent2.style.display = "none";
    lblStudent1.textContent = "學生";
    student2Account.required = false;
    student2Password.required = false;
  });

  // 4. 切換模式：雙人
  btnDouble.addEventListener("click", () => {
    currentMode = "double";
    btnDouble.className = "btn btn-pill active-green";
    btnSingle.className = "btn btn-pill btn-inactive";

    colStudent2.style.display = "flex";
    lblStudent1.textContent = "學生 1";
    student2Account.required = true;
    student2Password.required = true;
  });

  // 5. 送出：呼叫帳密登入端點
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    btnEnter.disabled = true;

    try {
      if (currentRole === "teacher") {
        await submitTeacherLogin();
      } else {
        await submitStudentLogin();
      }
    } finally {
      btnEnter.disabled = false;
    }
  });

  async function submitTeacherLogin() {
    const account = teacherAccount.value.trim();
    const password = teacherPassword.value;

    const result = await API.teacherLogin(account, password);
    if (!result) {
      showError("帳號或密碼錯誤，請再試一次。");
      return;
    }

    sessionStorage.clear();
    sessionStorage.setItem("user_role", "teacher");
    sessionStorage.setItem("token", result.token);
    sessionStorage.setItem("teacher_id", result.teacherId);
    sessionStorage.setItem("teacher_name", result.teacherName);
    sessionStorage.setItem("teacher_school", result.school);

    window.location.href = "dms.html";
  }

  async function submitStudentLogin() {
    const s1Account = student1Account.value.trim();
    const s1Password = student1Password.value;

    const result1 = await API.studentLogin(s1Account, s1Password);
    if (!result1) {
      showError(currentMode === "double" ? "學生 1 帳號或密碼錯誤。" : "帳號或密碼錯誤，請再試一次。");
      return;
    }

    let result2 = null;
    if (currentMode === "double") {
      const s2Account = student2Account.value.trim();
      const s2Password = student2Password.value;

      result2 = await API.studentLogin(s2Account, s2Password);
      if (!result2) {
        showError("學生 2 帳號或密碼錯誤。");
        return;
      }
    }

    sessionStorage.clear();
    sessionStorage.setItem("user_role", "student");
    sessionStorage.setItem("game_mode", currentMode);
    sessionStorage.setItem("token", result1.token);
    sessionStorage.setItem("student1_token", result1.token);
    sessionStorage.setItem("student1_key", result1.studentKey);
    sessionStorage.setItem("student1_school", result1.school);

    if (result2) {
      sessionStorage.setItem("student2_token", result2.token);
      sessionStorage.setItem("student2_key", result2.studentKey);
      sessionStorage.setItem("student2_school", result2.school);
    }

    window.location.href = "games.html";
  }
});
