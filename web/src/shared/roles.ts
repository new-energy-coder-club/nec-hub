/**
 * 前端角色判定口径：与后端 src/auth/role.ts 的 ROLES 对应（展示侧开关用，真正鉴权以后端为准）。
 * 各常量保持既有调用点的原有语义，仅做集中管理。
 */

/** 队长/组长：管理入口展示（对应后端 ROLES.LEADER） */
export const LEADER_ROLE_RE = /队长|组长/

/** 队长/财务：报销全员台账可见（对应后端 ROLES.FINANCE_MANAGER） */
export const FINANCE_MANAGER_ROLE_RE = /队长|财务/

export const hasRole = (role: string | null | undefined, re: RegExp): boolean => !!role && re.test(role)
