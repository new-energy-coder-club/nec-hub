// 共享基础：ORIGIN / esc / apiDr / CDN 注入工具（自 index.html 内嵌脚本抽出，多 Tab 共用）
export const ORIGIN = location.origin;

// 转义表与正则提升为常量：esc 在每次列表渲染中被逐项调用，避免每次调用重建正则与映射对象
const ESC_RE = /[&<>"']/g;
const ESC_MAP = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
export function esc(s) {
  return String(s ?? "").replace(ESC_RE, c => ESC_MAP[c]);
}

// 图纸评审 API：非 2xx 抛出带后端 error 消息的 Error
export async function apiDr(path, options = {}) {
  const res = await fetch("/api/drawing-review" + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// OCR/文档渲染依赖的 CDN：jsdelivr 主站在部分网络下被重置，默认走 fastly 镜像，失败再回退主站
export const CDN_FASTLY = 'https://fastly.jsdelivr.net/npm';
export const CDN_JSDELIVR = 'https://cdn.jsdelivr.net/npm';

export function injectScript(url) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = res;
    s.onerror = () => { s.remove(); rej(new Error(url)); };
    document.head.appendChild(s);
  });
}
