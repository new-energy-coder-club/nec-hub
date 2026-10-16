// 状态映射：map 命中返回配置项，未命中走 fallback（兜底展示原始状态）

export function useStatusMeta<T>(map: Record<string, T>, fallback: (status: string) => T) {
  const meta = (status: string): T => map[status] ?? fallback(status)
  return { map, meta }
}
