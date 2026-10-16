/**
 * 飞书多维表字段嗅探正则注册表
 *
 * 各模块「按候选正则找字段名」的候选清单集中在此：表头改名只需改这里。
 * 匹配工具 findFieldKey 从 feishu/bitable re-export（实现不变），调用方只 import 本文件。
 * 同一语义在不同表存在不同候选清单时分开登记（如 GOAL_TITLE / GOAL_TITLE_EXACT），保持各调用点原有口径。
 */

export { findFieldKey } from "../feishu/bitable";

// ---------- 队员名单 ----------
export const MEMBER_GROUP_PATTERNS = [/^组别/, /组别/, /小组/, /部门/, /group/i];

// ---------- 任务进度 ----------
export const TASK_STATUS_PATTERNS = [/^状态/, /状态/, /进度/, /status/i];
export const TASK_OWNER_PATTERNS = [/负责人/, /执行人/, /owner/i, /assignee/i];
export const TASK_TITLE_PATTERNS = [/^任务/, /任务/, /事项/, /标题/, /title/i];
/** 赛季目标模块任务表标题：额外带 ^标题 精确候选 */
export const TASK_TITLE_EXACT_PATTERNS = [/^任务/, /任务/, /事项/, /^标题/, /标题/, /title/i];
export const TASK_DEADLINE_PATTERNS = [/截止/, /deadline/i, /完成时间/, /日期/];
export const TASK_PRIORITY_PATTERNS = [/优先级/, /priority/i];
export const TASK_LEVEL_PATTERNS = [/层级/, /级别/, /^类型/, /分类/, /level/i];

// ---------- 物资台账 ----------
export const INVENTORY_NAME_PATTERNS = [/^物料/, /物料/, /物资/, /物品/, /品名/, /名称/, /name/i];
export const INVENTORY_QTY_PATTERNS = [/^数量/, /数量/, /库存/, /余量/, /现存/, /quantity/i, /^count$/i];
export const INVENTORY_LOCATION_PATTERNS = [/位置/, /库位/, /货架/, /仓库/, /location/i];

// ---------- 财务报销 ----------
export const FINANCE_AMOUNT_PATTERNS = [/报销金额/, /^金额/, /金额/, /费用/, /amount/i];
export const FINANCE_ITEM_PATTERNS = [/^事项/, /事项/, /用途/, /摘要/];
export const FINANCE_DATE_PATTERNS = [/报销时间/, /报销日期/, /^日期/, /日期/, /时间/, /^date/i];
export const FINANCE_APPLICANT_PATTERNS = [/^申请人$/, /申请人/, /报销人/, /经手人/, /提交人/];
/** 报销流程状态（待办聚合口径，含 流程 候选） */
export const FINANCE_FLOW_STATUS_PATTERNS = [/^状态/, /流程/, /进度/, /status/i];

// ---------- 赛季目标 ----------
export const GOAL_TITLE_PATTERNS = [/^目标/, /目标/, /title/i];
/** 赛季目标适配器标题：额外带 ^目标$ / ^标题 精确候选 */
export const GOAL_TITLE_EXACT_PATTERNS = [/^目标$/, /^目标/, /目标/, /^标题/, /标题/, /title/i];
export const GOAL_KR_PATTERNS = [/关键结果/, /^KR/i, /KR/];
export const GOAL_GROUP_PATTERNS = [/负责组/, /组别/, /小组/, /group/i];
export const GOAL_DEADLINE_PATTERNS = [/截止/, /deadline/i, /日期/];
export const GOAL_PROGRESS_PATTERNS = [/完成度/, /进度/, /progress/i];
export const GOAL_STATUS_PATTERNS = [/^状态/, /状态/, /status/i];
export const GOAL_SOURCE_PATTERNS = [/来源/, /source/i];
export const GOAL_NOTE_PATTERNS = [/备注/, /说明/, /note/i, /remark/i];
export const GOAL_SUBMITTER_PATTERNS = [/提交人/, /提交者/, /submitter/i];

// ---------- 本地审批底表 ----------
export const APPROVAL_STATUS_PATTERNS = [/^状态$/, /状态/, /进度/];
export const APPROVAL_ID_PATTERNS = [/^申请单号$/, /申请单号/, /单号/];
export const APPROVAL_APPLICANT_PATTERNS = [/^申请人$/, /申请人/, /报销人/];
export const COMPLIANCE_PUBLISH_AT_PATTERNS = [/计划发布时间/, /发布时间/];
export const OPEN_ID_PATTERNS = [/open_?id/i];

// ---------- 我的报销（reimburse/mine） ----------
export const REIMBURSE_OPEN_ID_PATTERNS = [/open[_ -]?id/i];
export const REIMBURSE_ID_PATTERNS = [/^申请单号/, /申请单号/, /单号/];
export const REIMBURSE_STATUS_PATTERNS = [/^状态/, /状态/];
export const REIMBURSE_SUBMIT_TIME_PATTERNS = [/^提交时间/, /提交时间/];
export const REIMBURSE_APPROVER_PATTERNS = [/^审批人$/, /审批人/, /审核人/];
export const REIMBURSE_COMMENT_PATTERNS = [/审批意见/, /^意见/, /意见/];
