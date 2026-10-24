# 子应用目录与内嵌约定

NEC HUB 的子应用是 Vite MPA（多页应用）入口，同时也可以作为 Vue 组件嵌入门户 Tab。一个子应用通常涉及下面三层目录，修改时先分清源码和产物。

## 三层目录职责

| 目录 | 职责 | 维护方式 |
| --- | --- | --- |
| `web/apps/<name>/index.html` | Vite MPA 的 HTML 入口模板，通过 `/src/apps/<name>/main.ts` 加载应用。 | 手工维护；新增子应用时添加。 |
| `web/src/apps/<name>/` | 真正的 Vue、TypeScript、样式和其他源码。`main.ts` 负责独立页挂载，页面组件同时供门户复用。 | 手工维护；日常开发主要在这里。 |
| `public/apps/<name>/` | Vite 构建后由 Worker 托管的页面和静态资源。 | 构建产物不要手改，也不要把生成的 hash 文件当源码提交。 |

仓库已忽略 `public/portal-assets/`、门户生成的 `public/index.html` 以及各子应用生成的 `public/apps/*/index.html`。从仓库根目录运行 `npm run build:web` 即可重新生成这些文件。

`mech-review-6014` 是静态资源的例外：`public/apps/mech-review-6014/` 下由 git 跟踪的 `minutes.md`、DXF、CSV、SVG、PNG 等附件是手工维护的资料，不是可以随意清理的构建产物；其 `index.html` 仍由 Vite 生成。

## 新增子应用

1. 在 `web/apps/<name>/index.html` 放入入口模板，并将模块脚本指向 `/src/apps/<name>/main.ts`。
2. 在 `web/src/apps/<name>/` 编写 `main.ts`、页面组件和样式。独立页入口挂载到模板中的 `#app`。
3. 运行根目录的 `npm run build:web`。Vite 会自动发现 `web/apps/*/index.html`，不需要为普通子应用修改 `web/vite.config.ts`；构建结果输出到 `public/`。
4. 如果还需要门户 Tab，在门户中直接引入同一页面组件并注册 Tab；不要为了内嵌再复制一份页面或添加 iframe。

`task-schedule/animated.html` 是现有的额外独立静态页入口，不影响普通子应用的自动发现规则。

## 独立页与门户 Tab

- **独立页**：访问 `/apps/<name>/`。`main.ts` 只在 URL 明确带有 `?embedded=1` 时向根组件传入 `embedded=true`；不使用 `window.parent` 或其他 iframe 嗅探。未带参数时保持完整独立页页头和导航。
- **门户 Tab**：门户直接渲染 Vue 组件，例如 `<ExampleApp embedded />`。此时 `embedded` 由 prop 传入，用于隐藏独立页页头、切换紧凑布局等；不依赖 URL，也不经过 iframe 或 `postMessage`。
- **登录初始化**：支持 `skipAuthBoot` 的组件，在门户中可用 `skip-auth-boot`（Vue 模板写法）跳过子应用自己的登录引导，因为门户已经统一执行 `bootAuth`。独立页不要传这个参数，让子应用按自身逻辑初始化登录态。`embedded` 只控制展示，不代表已经完成登录。

新增组件时应保持这两种形态都能工作：独立页负责挂载和自身启动逻辑，门户复用组件并负责门户级的登录态与导航。
