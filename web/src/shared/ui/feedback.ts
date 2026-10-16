// 内联提示与确认框：替代原生 alert/confirm（嵌入门户 iframe 时不弹原生对话框）。
// 命令式注入 document.body，各 MPA 入口与门户 Tab 无需挂载宿主组件。

const STYLE_ID = 'nec-feedback-style'

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.nec-fb-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:120;max-width:min(92vw,560px);background:#141B5E;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;line-height:1.6;white-space:pre-line;box-shadow:0 8px 30px rgba(11,16,51,.35);animation:nec-fb-in .18s ease-out}
@keyframes nec-fb-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.nec-fb-mask{position:fixed;inset:0;background:rgba(11,16,51,.45);z-index:110;display:flex;align-items:center;justify-content:center;padding:16px}
.nec-fb-box{background:#fff;border-radius:8px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(11,16,51,.3);padding:20px}
.nec-fb-msg{font-size:14px;line-height:1.7;color:#1f2430;white-space:pre-line;margin:0 0 16px}
.nec-fb-btns{display:flex;justify-content:flex-end;gap:10px}
.nec-fb-btn{padding:6px 16px;border-radius:6px;font-size:13px;cursor:pointer;border:1px solid #d6dae6;background:#fff;color:#5A6472}
.nec-fb-btn-primary{background:#141B5E;border-color:#141B5E;color:#fff}
`
  document.head.appendChild(style)
}

export function toast(message: string, ms = 4000) {
  ensureStyle()
  const el = document.createElement('div')
  el.className = 'nec-fb-toast'
  el.setAttribute('role', 'alert')
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), ms)
}

export function confirmDialog(message: string): Promise<boolean> {
  ensureStyle()
  return new Promise(resolve => {
    const mask = document.createElement('div')
    mask.className = 'nec-fb-mask'
    const box = document.createElement('div')
    box.className = 'nec-fb-box'
    box.setAttribute('role', 'dialog')
    const msg = document.createElement('p')
    msg.className = 'nec-fb-msg'
    msg.textContent = message
    const btns = document.createElement('div')
    btns.className = 'nec-fb-btns'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'nec-fb-btn'
    cancelBtn.textContent = '取消'
    const okBtn = document.createElement('button')
    okBtn.className = 'nec-fb-btn nec-fb-btn-primary'
    okBtn.textContent = '确定'
    const done = (v: boolean) => { mask.remove(); resolve(v) }
    cancelBtn.onclick = () => done(false)
    okBtn.onclick = () => done(true)
    mask.onclick = e => { if (e.target === mask) done(false) }
    btns.append(cancelBtn, okBtn)
    box.append(msg, btns)
    mask.appendChild(box)
    document.body.appendChild(mask)
    okBtn.focus()
  })
}
