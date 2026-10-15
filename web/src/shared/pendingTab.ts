// 目标 Tab 暂不可见（如未登录时的图纸评审）时暂存，登录门控放开后由 applyHashRoute 重放（ST-02）
// 独立成模块以避免 useAuth ↔ useTabs 循环依赖
export const pendingHash = { tab: null as string | null }
