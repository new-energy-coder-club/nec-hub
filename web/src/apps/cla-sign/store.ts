// CLA 签署页共享状态：协议版本、荣誉榜名单、当前签署记录（自原单文件脚本的全局量迁入）
import { reactive } from 'vue'
import { fetchJson } from '@shared/api'
import type { ClaSignature } from './agreement'

export const store = reactive({
  /** 协议版本（/api/cla 返回后覆盖，未加载前展示 1.0） */
  version: '1.0',
  signatures: [] as ClaSignature[],
  count: 0,
  listState: 'loading' as 'loading' | 'ok' | 'error',
  /** 签署成功 / 已签署的记录（驱动 PDF 证书面板） */
  currentSig: null as ClaSignature | null,
  /** currentSig 来源：true=此前已签署（登录态检查或重复提交），false=本次新签署 */
  alreadySigned: false,
})

export async function loadSigners() {
  try {
    const d = await fetchJson('/api/cla')
    store.version = d.agreement.version
    store.count = d.count
    store.signatures = d.signatures || []
    store.listState = 'ok'
  } catch {
    store.listState = 'error'
  }
}
