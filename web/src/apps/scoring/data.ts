// 数据层（全部源自 ASPIEC-DCB-framework.md v0.1.0，结构可扩展）

export interface ScaleMilestone {
  score: number
  grade: string
  note: string
  current: boolean
}

export interface ReviewRound {
  round: string
  score: number
  stage: string
  note: string
  current?: boolean
}

export interface Dimension {
  name: string
  rule: string
}

export interface ColorSwatch {
  label: string
  hex: string
}

export interface ColorLevel {
  level: string
  usage: string
  codes: string[]
  swatches: ColorSwatch[]
}

export interface Hotfix {
  title: string
  desc: string
  before: string
  after: string
}

export const STANDARD = {
  name: 'ASPIEC-DCB',
  version: 'v0.1.0',
  nature: 'NEC-PI5 终端视觉合规标准（社区内部标准）',
  reviewMode: 'A416::REVIEW',
  signature: 'Verified by NEC-PI5 · ASPIEC-DCB v0.1.0',
  targetScore: 9.6,
  targetNote: '色彩和谐度 + 字距舒适度极限打磨',
  applicableTo: '终端启动横幅 / 字符画类视觉作品',
}

// 评分标尺关键节点（§2）
export const SCALE_MILESTONES: ScaleMilestone[] = [
  { score: 6.0, grade: '工业级', note: '功能正确，视觉粗糙', current: false },
  { score: 9.0, grade: '专业标准', note: '画廊级候选，进入微雕阶段', current: false },
  { score: 9.3, grade: '博物馆级', note: '官方模板候选（当前最高记录）', current: true },
  { score: 9.6, grade: '终局目标', note: '色彩和谐度 + 字距舒适度极限打磨', current: false },
  { score: 10.0, grade: '满分', note: '—', current: false },
]

// 迭代轨迹：已留存评审轮次（§1）。追加新轮次时向数组尾部添加对象即可。
export const REVIEWS: ReviewRound[] = [
  { round: '锐评', score: 6.0, stage: '工业级 → 画廊级', note: '包豪斯三层：信息 / 展示 / 操作' },
  { round: '终局微雕', score: 9.0, stage: '专业标准', note: '剩余：色彩和谐 + 字距呼吸' },
  { round: '博物馆级', score: 9.3, stage: '官方标准终端模板候选', note: '当前最高记录 9.3/10', current: true },
]

// 六大评分维度（§3）——文档未留存分项得分，只记录规则
export const DIMENSIONS: Dimension[] = [
  { name: '信息架构', rule: '框体分层：标题 / 标语 / 技术栈不得挤在单层框内' },
  { name: '字距排版', rule: '单词内部禁插空格；词间距 2–3 字符' },
  { name: '垂直节奏', rule: '8px（半行）基准网格；关键区之间 1–1.5 行呼吸' },
  { name: '色彩和谐', rule: '禁冷暖两极并置（如青 81 + 纯白 255）；推荐同色系渐变' },
  { name: '提示符语义', rule: '不得出现双重 Prompt；说明行必须注释化' },
  { name: '视觉锚定', rule: '底部须有底线 / 签名锚定，禁止“悬空草稿感”' },
]

// 色彩规范 L1–L4（§5），hex 为 xterm-256 近似色
export const COLOR_LEVELS: ColorLevel[] = [
  { level: 'L1', usage: '主视觉 · NEC PI5 大字', codes: ['青 81（终局方案）', '橙 208（早期方案）'], swatches: [
    { label: 'xterm 81 青', hex: '#5FD7FF' }, { label: 'xterm 208 橙', hex: '#FF8700' } ] },
  { level: 'L2', usage: '信息框 · 标题 / 技术栈', codes: ['250', '245'], swatches: [
    { label: 'xterm 250', hex: '#BCBCBC' }, { label: 'xterm 245', hex: '#8A8A8A' } ] },
  { level: 'L3', usage: '操作提示 · 提示行', codes: ['242'], swatches: [
    { label: 'xterm 242', hex: '#6C6C6C' } ] },
  { level: 'L4', usage: '元数据签名 · DarrenPig · v0.1.0', codes: ['238 或斜体 + 240'], swatches: [
    { label: 'xterm 238', hex: '#444444' }, { label: 'xterm 240', hex: '#585858' } ] },
]

// Hotfix 执行范式（§7 三条示例）
export const HOTFIXES: Hotfix[] = [
  { title: '合并字距', desc: '删除字母间空格',
    before: 'A S P I E C', after: 'ASPIEC' },
  { title: '降级 PI5 白', desc: '纯白 255 过曝，降级为浅灰 251 或浅青 195',
    before: '\\x1b[38;5;255m', after: '\\x1b[38;5;251m 或 \\x1b[38;5;195m' },
  { title: '注释化提示行', desc: '禁止伪装成 Prompt，规范化为注释形式',
    before: '[A416::REVIEW] >', after: '# A416::REVIEW' },
]

export const BEST = REVIEWS[REVIEWS.length - 1]

export const GOV_BADGES = ['[AUTH:PI5]', '[MGMT:CLAW]', '[STD:ASPIEC]', '[DCB:ACTIVE]']
