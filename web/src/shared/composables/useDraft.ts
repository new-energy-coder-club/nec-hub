// 草稿防抖保存：collect 采集快照，防抖写入 localStorage；
// hasContent 判定空内容（空时跳过写入，removeWhenEmpty 时改为删除旧草稿）

export interface UseDraftOptions<T> {
  collect: () => T
  hasContent?: (state: T) => boolean
  delay?: number
  removeWhenEmpty?: boolean
  onSaved?: (state: T) => void
}

export function useDraft<T>(key: string, opts: UseDraftOptions<T>) {
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancel() {
    if (timer) { clearTimeout(timer); timer = null }
  }

  function saveNow(manual = false) {
    const state = opts.collect()
    const has = opts.hasContent ? opts.hasContent(state) : true
    try {
      if (has || manual) {
        localStorage.setItem(key, JSON.stringify(state))
        opts.onSaved?.(state)
      } else if (opts.removeWhenEmpty) {
        localStorage.removeItem(key)
      }
    } catch { /* 隐私模式跳过 */ }
  }

  function schedule() {
    cancel()
    timer = setTimeout(() => { timer = null; saveNow(false) }, opts.delay ?? 600)
  }

  function read(): T | null {
    try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
  }

  function clear() {
    cancel()
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  }

  return { schedule, saveNow, read, clear, cancel }
}
