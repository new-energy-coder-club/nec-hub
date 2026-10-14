// 飞书登录态会话（FE-01）：OAuth 跳转登录 + 会话 Cookie + 角色徽章（自 index.html 内嵌脚本抽出）
// 注意：本模块与 main.js / tabs/* 存在循环 import，仅函数体内运行时使用对方导出（ES Module 活绑定，安全）
import { esc } from "./api.js";
import { parseHashTab, applyHashRoute, getPendingHashTab, setPendingHashTab, loadTodos, loadMyTasks } from "../main.js";
import { loadHome, loadHomeActivity } from "../tabs/home.js";
import { loadDashboard, loadValidateHealth } from "../tabs/dashboard.js";
import { updateDrawingReviewGate } from "../tabs/drawing-review.js";
import { updateHardwareReviewGate } from "../tabs/hardware-review.js";
import { updateContractApprovalGate } from "../tabs/contract-approval.js";

// Hero 版式：全尺寸只给未登录访客的首次访问；登录用户与已见过的回访一律压缩成品牌细条
function applyHeroMode() {
  const hero = document.querySelector(".hero");
  if (!hero) return;
  const seen = localStorage.getItem("nec_hero_seen") === "1";
  const compact = ME.authenticated || seen;
  hero.classList.toggle("compact", compact);
  if (!compact) localStorage.setItem("nec_hero_seen", "1");
}

// ===== 飞书登录态（FE-01）：OAuth 跳转登录 + 会话 Cookie + 角色徽章 =====
let HUB_CONFIG = { loginEnabled: false, feishuAppId: null };
let ME = { authenticated: false, user: null };

async function bootAuth() {
  try { HUB_CONFIG = await (await fetch("/api/config")).json(); } catch {}
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (code) {
    const state = params.get("state");
    const saved = sessionStorage.getItem("nec_oauth_state");
    history.replaceState(null, "", location.pathname + location.hash);
    if (state && saved && state !== saved) {
      alert("登录校验失败（state 不匹配），请重试");
    } else {
      try {
        const resp = await fetch("/auth/feishu", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || ("HTTP " + resp.status));
      } catch (e) {
        alert("飞书登录失败：" + (e.message || e));
      }
    }
    sessionStorage.removeItem("nec_oauth_state");
  }
  await refreshMe();
  applyHeroMode();
  renderUserBox();
  loadDashboard(); // 财务区可见性随登录角色变化
  loadValidateHealth();
  loadTodos(); // FE-09 待办条（未登录/无待办自动隐藏）
  loadHome(); // FE-06/07 我的首页（未登录渲染默认布局）
  loadHomeActivity(); // 团队动态窄条（最近 git 提交）
  // OAuth 往返后恢复暂存的深链目标；同时重放所有登录门控 Tab 的 pendingHash（ST-02）
  const returnTab = sessionStorage.getItem("nec_login_return_tab");
  if (returnTab) {
    sessionStorage.removeItem("nec_login_return_tab");
    if (!parseHashTab()) setPendingHashTab(returnTab);
  }
  applyHashRoute();
}

async function refreshMe() {
  try { ME = await (await fetch("/api/whoami")).json(); }
  catch { ME = { authenticated: false, user: null }; }
}

function renderUserBox() {
  const box = document.getElementById("user-box");
  if (ME.authenticated && ME.user) {
    const u = ME.user;
    // 角色徽标补充权限说明（external 等非常规角色用户常不知道边界）
    const ROLE_TIPS = { external: "外部协作者：可查看公开数据，审批/报销等功能需队长开通" };
    const roleTip = ROLE_TIPS[u.role] || "";
    box.innerHTML = `
      ${u.avatar_url ? `<img src="${esc(u.avatar_url)}" class="w-6 h-6 rounded-full" alt=""/>` : ""}
      <span class="font-medium" style="color:var(--nec-navy)">${esc(u.name)}</span>
      <span class="px-1.5 py-0.5 rounded text-[10px] text-white"${roleTip ? ` title="${esc(roleTip)}" style="background:var(--nec-cyan);cursor:help"` : ` style="background:var(--nec-cyan)"`}>${esc(u.role || "队员")}</span>
      ${u.group ? `<span class="text-gray-400 hidden sm:inline">${esc(u.group)}</span>` : ""}
      <button onclick="logout()" class="text-gray-400 hover:text-gray-600 ml-1">登出</button>`;
  } else if (HUB_CONFIG.loginEnabled) {
    // “记住上次登录”：登录成功后后端写入非 HttpOnly 的 nec_last_login Cookie（30 天，仅展示信息）
    const last = getLastLogin();
    const hint = last && last.name ? `
      ${last.avatar_url ? `<img src="${esc(last.avatar_url)}" class="w-6 h-6 rounded-full opacity-70" alt=""/>` : ""}
      <span class="text-xs text-gray-400" title="${esc(last.at ? new Date(last.at).toLocaleString("zh-CN") : "")}">上次登录：${esc(last.name)}</span>` : "";
    box.innerHTML = `${hint}<button onclick="startLogin()" class="px-3 py-1 rounded text-white" style="background:var(--nec-navy)">${last && last.name ? "以 " + esc(last.name) + " 继续登录" : "飞书登录"}</button>`;
  } else {
    box.innerHTML = "";
  }
  updateDrawingReviewGate();
  updateHardwareReviewGate();
  updateContractApprovalGate();
}

// Cookie 名转义正则为常量：避免每次 readCookie 调用重建
const COOKIE_NAME_ESC_RE = /[.*+?^${}()|[\]\\]/g;
function readCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(COOKIE_NAME_ESC_RE, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function getLastLogin() {
  try {
    const raw = readCookie("nec_last_login");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function startLogin() {
  const state = crypto.randomUUID();
  sessionStorage.setItem("nec_oauth_state", state);
  // OAuth 往返会丢 hash：把暂存的深链目标带入 sessionStorage，登录回来后由 bootAuth 重放
  const pending = getPendingHashTab();
  if (pending) sessionStorage.setItem("nec_login_return_tab", pending);
  const redirect = location.origin + location.pathname;
  // scope：task:task:read 读任务 + task:tasklist:read 读清单 + mail:user_mailbox.message:send 邮件通道发信（G-05）；
  // scope 变化后老用户需重新授权一次，"我的任务"/邮件发信才能绑定
  location.href = "https://open.feishu.cn/open-apis/authen/v1/authorize?app_id="
    + encodeURIComponent(HUB_CONFIG.feishuAppId)
    + "&redirect_uri=" + encodeURIComponent(redirect)
    + "&state=" + state
    + "&scope=" + encodeURIComponent("task:task:read task:tasklist:read mail:user_mailbox.message:send");
}

async function logout() {
  await fetch("/auth/logout", { method: "POST" }).catch(() => {});
  ME = { authenticated: false, user: null };
  applyHeroMode();
  renderUserBox();
  loadDashboard();
  loadValidateHealth();
  loadTodos();
  loadHome();
  loadMyTasks();
}

export { HUB_CONFIG, ME, bootAuth, refreshMe, renderUserBox, applyHeroMode, readCookie, getLastLogin, startLogin, logout };

// 内联事件处理器（HTML onclick）需要全局可见
Object.assign(window, { startLogin, logout });
