# MES 飞书免登接入手册

> 目标：队员从飞书工作台点开「NEC 仓库作业台」时**自动知道是谁**，无需手动登录。
> 架构：MES 前端拿 auth code → **nec-hub Worker 的 `/auth/feishu`** 用 app_secret 兑换用户信息 → 返回姓名/open_id。
> 为什么走后端：app_secret 绝不能出现在 MES 前端代码里（静态站，任何人可见源码）。

## 流程图

```
飞书工作台点开 MES
  → feishu-sso.js 检测到飞书环境 & URL 无 code
  → 跳转 open.feishu.cn/authen/v1/authorize（飞书内无感，不弹授权框）
  → 携带 ?code=xxx 回到 MES 页面
  → POST code 到 nec-hub /auth/feishu
  → Worker：code → user_access_token → user_info
  → 返回 {name, open_id, avatar_url}，MES 写入 localStorage
  → 页面显示当前操作人，领用/工单/审计日志自动带名字
```

## 第一步 · 飞书开放平台配置（复用上架时建的自建应用）

1. 进入应用详情 → **「安全设置」→「重定向 URL」**，添加：
   ```
   https://mes.newenergycoder.club/home.html
   https://mes.newenergycoder.club/index.html   # 主工作台（v3.13.48 起已接入免登）
   ```
   （本地调试可加 `http://localhost:端口/home.html`）
2. 权限：基础免登**不需要额外申请 scope**，user_info 返回姓名/open_id 够用
   - 若以后要拿部门/工号，再加 `contact:user.department:readonly` 等并重新发版
3. 记下 App ID / App Secret

## 第二步 · nec-hub 配置密钥并部署

```bash
cd nec-hub
wrangler secret put FEISHU_APP_ID      # 粘贴 cli_ 开头的 App ID
wrangler secret put FEISHU_APP_SECRET
wrangler deploy                         # 绑好 hub.newenergycoder.club 后
```

本地自测（未配 secret 时应返回引导文案）：
```bash
curl -X POST http://localhost:8787/auth/feishu -H "content-type: application/json" -d '{"code":"test"}'
```

## 第三步 · MES 侧接入（416mes 仓库）

> ✅ 已完成（v3.13.48，2026-10-14）：`index.html` 主工作台与 `home.html` 门户均已接入 `feishu-sso.js`。主工作台会把免登成员自动设为当前操作人（手动切换后本会话不再自动覆盖）；下方步骤保留为历史接入记录。

1. 把 `integrations/mes/feishu-sso.js` 复制到 MES 站点目录（与 home.html 同级）
2. `home.html` 的 `</body>` 前加：

```html
<script src="./feishu-sso.js"></script>
<script>
  FeishuSSO.init({
    appId: "cli_xxxxxxxxxx",  // 换成真实 App ID
    authEndpoint: "https://hub.newenergycoder.club/auth/feishu",
    onLogin(user) {
      // 例：顶栏显示当前操作人
      const el = document.querySelector("#user-name");
      if (el) el.textContent = user.name;
      // 例：后续创建工单/领用时带上 user.name 作为操作人
      window.NEC_CURRENT_USER = user;
    },
    onError(err) {
      console.warn("飞书免登失败（不影响本地功能）：", err.message);
    },
  });
</script>
```

3. 普通浏览器打开时不会自动跳转；如需手动登录入口，加一个按钮：
   ```html
   <button onclick="FeishuSSO.login()">飞书登录</button>
   ```

## 与 MES 现有功能的结合点（建议）

| MES 功能 | 免登后可做的事 |
|---|---|
| 逐件入库/出库/换箱 | 操作人字段自动填 `user.name`，无需手选 |
| 库存工单 | 创建人/执行人自动记录 open_id |
| 操作记录（审计） | 每条日志绑定真实飞书身份 |
| 飞书多维表双向同步 | 同步记录里写操作人，飞书侧可回溯到具体队员 |

## 注意事项

- **auth code 一次性且 5 分钟过期**：兑换失败提示用户刷新重进即可
- **登录态存在 localStorage**：队员换浏览器/清缓存后，飞书内会自动重新无感登录
- **离线优先原则不变**：免登失败只影响"显示名字"，不影响 MES 任何本地功能
- **安全边界**：`/auth/feishu` 只返回 name/open_id/avatar 三个字段，不回传任何 token 给前端
