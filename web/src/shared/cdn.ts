// OCR / 渲染依赖的 CDN 按需加载：jsdelivr 主站在部分网络下被重置，默认走 fastly 镜像，失败再回退主站
export const CDN_FASTLY = 'https://fastly.jsdelivr.net/npm'
export const CDN_JSDELIVR = 'https://cdn.jsdelivr.net/npm'

export const TESS_OPTS = {
  workerPath: CDN_FASTLY + '/tesseract.js@5/dist/worker.min.js',
  corePath: CDN_FASTLY + '/tesseract.js-core@5',
  langPath: 'https://tessdata.projectnaptha.com/4.0.0',
}

export function injectScript(url: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = url
    s.onload = () => res()
    s.onerror = () => { s.remove(); rej(new Error(url)) }
    document.head.appendChild(s)
  })
}

let _tessLoading: Promise<any> | null = null
export function loadTesseract(): Promise<any> {
  const w = window as any
  if (w.Tesseract) return Promise.resolve(w.Tesseract)
  if (!_tessLoading) {
    _tessLoading = injectScript(CDN_FASTLY + '/tesseract.js@5/dist/tesseract.min.js')
      .catch(() => injectScript(CDN_JSDELIVR + '/tesseract.js@5/dist/tesseract.min.js'))
      .then(() => w.Tesseract)
      .catch(() => { _tessLoading = null; throw new Error('识别引擎加载失败（网络）') })
  }
  return _tessLoading
}

let _pdfLoading: Promise<any> | null = null
export function loadPdfJs(): Promise<any> {
  const w = window as any
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib)
  if (!_pdfLoading) {
    _pdfLoading = injectScript(CDN_FASTLY + '/pdfjs-dist@3.11.174/build/pdf.min.js')
      .catch(() => injectScript(CDN_JSDELIVR + '/pdfjs-dist@3.11.174/build/pdf.min.js'))
      .then(() => {
        w.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN_FASTLY + '/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
        return w.pdfjsLib
      })
      .catch(() => { _pdfLoading = null; throw new Error('PDF 解析组件加载失败（网络）') })
  }
  return _pdfLoading
}

let _markedLoading: Promise<void> | null = null
export function loadMarked(): Promise<void> {
  const w = window as any
  if (w.marked) return Promise.resolve()
  if (!_markedLoading) {
    _markedLoading = injectScript(CDN_FASTLY + '/marked@12.0.2/lib/marked.umd.js')
      .catch(() => injectScript(CDN_JSDELIVR + '/marked@12.0.2/lib/marked.umd.js'))
  }
  return _markedLoading
}
