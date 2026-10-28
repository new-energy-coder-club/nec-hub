/**
 * env.REGISTRY 键空间注册表。TTL 只记归属，实际过期参数仍由读写调用点负责。
 *
 * 配置（无 TTL）：flows:config、dashboard:config、apps:index、skills:index、docs:registry；
 * drawing-review:config、hardware-review:config、contract-approval:config、season-goals:config；
 * validate:rules、home:<openId>、home:group:<group>、user-prefs:<module>:<actorId>。
 * 缓存：dashboard:cache:<table> / repos:cache:v2 / todos:<openId> / my-tasks:<openId>
 * 使用 value 内 cachedAt（逻辑 TTL 分别 30m / 1h / 5m / 5m，无 KV 自动过期）；
 * feishu:app_access_token / feishu:tenant_access_token 使用 value 内 expireAt；
 * role:<openId> 60s，todo:tbl:<type> 5m；repos:cache 为待清理旧缓存；
 * drawing-review:cache:dashboard / hardware-review:cache:dashboard 仅作配置变更失效键。
 * 会话：session:<sid> 7d；oauth:state:<state> 10m；
 * feishu:user_token:<openId> 随 refresh_token 寿命（默认 30d）。
 * 状态（无 TTL，除非另注）：approval:map:<appId> / approval:inv:<appId>:<action> 90d；
 * approval:esc:<appId> 为距自动取消剩余时间（未启用取消则 30d）；sla:lastRun、notify:failed 7d；
 * serial:<prefix>:<year>、contract-no:<year>、domains:rec:<subdomain>、domains:index（迁移旧键）；
 * cla:sig:<github>、cla:oid:<openId>；rl:cla:<ip> 1h；cron:guard:<name>、cron:last:<cron> 30d；
 * prd:status 无 TTL，prd:last_commit、prd:recent_commits 30d；
 * validate:report:latest、validate:report:weekly-prev、weekly:snapshot、weekly:last；
 * drawing-review:alert:blockers。user-prefs:<actorId> 仅为 drawing 迁移期只读旧键。
 */

export const KV_PREFIXES = {
  session: "session:",
  domainRecord: "domains:rec:",
  claSignature: "cla:sig:",
} as const;

export const KV_KEYS = {
  session: (sid: string) => `${KV_PREFIXES.session}${sid}`,
  oauthState: (state: string) => `oauth:state:${state}`,
  feishuUserToken: (openId: string) => `feishu:user_token:${openId}`,
  feishuAppAccessToken: "feishu:app_access_token",
  feishuTenantAccessToken: "feishu:tenant_access_token",
  flowsConfig: "flows:config",
  dashboardConfig: "dashboard:config",
  dashboardCache: (table: string) => `dashboard:cache:${table}`,
  appsIndex: "apps:index",
  skillsIndex: "skills:index",
  docsRegistry: "docs:registry",
  homeUser: (openId: string) => `home:${openId}`,
  homeGroup: (group: string) => `home:group:${group}`,
  userPrefs: (module: string, actorId: string) => `user-prefs:${module}:${actorId}`,
  legacyUserPrefs: (actorId: string) => `user-prefs:${actorId}`,
  reposCache: "repos:cache:v2",
  legacyReposCache: "repos:cache",
  validateReport: "validate:report:latest",
  validateRules: "validate:rules",
  validateWeeklySnapshot: "validate:report:weekly-prev",
  weeklySnapshot: "weekly:snapshot",
  weeklyLast: "weekly:last",
  todoTable: (type: string) => `todo:tbl:${type}`,
  todos: (openId: string) => `todos:${openId}`,
  myTasks: (openId: string) => `my-tasks:${openId}`,
  approvalMap: (appId: string) => `approval:map:${appId}`,
  approvalEscalation: (appId: string) => `approval:esc:${appId}`,
  approvalInventoryMark: (appId: string, action: string) => `approval:inv:${appId}:${action}`,
  cronGuard: (name: string) => `cron:guard:${name}`,
  cronLast: (cron: string) => `cron:last:${cron}`,
  prdStatus: "prd:status",
  prdLastCommit: "prd:last_commit",
  prdRecentCommits: "prd:recent_commits",
  slaLastRun: "sla:lastRun",
  role: (openId: string) => `role:${openId}`,
  notifyFailed: "notify:failed",
  announceLog: "announce:log",
  domainsIndex: "domains:index",
  domainRecord: (subdomain: string) => `${KV_PREFIXES.domainRecord}${subdomain}`,
  claSignature: (github: string) => `${KV_PREFIXES.claSignature}${github}`,
  claOpenId: (openId: string) => `cla:oid:${openId}`,
  claRateLimit: (ip: string) => `rl:cla:${ip}`,
  drawingReviewConfig: "drawing-review:config",
  drawingReviewDashboardCache: "drawing-review:cache:dashboard",
  drawingReviewAlertBlockers: "drawing-review:alert:blockers",
  hardwareReviewConfig: "hardware-review:config",
  hardwareReviewDashboardCache: "hardware-review:cache:dashboard",
  contractApprovalConfig: "contract-approval:config",
  seasonGoalsConfig: "season-goals:config",
  serial: (prefix: string, year: string | number) => `serial:${prefix}:${year}`,
  contractNumber: (year: string | number) => `contract-no:${year}`,
} as const;
