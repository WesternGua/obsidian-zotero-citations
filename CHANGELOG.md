# Changelog

本文件记录 Zotero Citations 插件的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [0.2.5] - 2026-05-13

### 修复

- 按最新 Community Review 报告完成设置页与代码规范修复：
  - 设置页标题不再包含插件名；
  - 移除未使用常量与未使用导入；
  - 调整若干 UI 文案为 sentence case。
- 完成 TypeScript/ESLint 严格规则对齐：
  - 移除 `require()` 风格导入，统一为 ESM 导入；
  - 清理 `any` 相关的 unsafe assignment / call / member access / argument 警告；
  - 修复 Promise 使用规范（`void` 标注、事件回调中异步调用方式等）。
- 对齐文内引用（In-text）实现与导出链路：
  - Obsidian 内仍可作为插件管理引用统一刷新与编辑；
  - Word 导出时文内引用按正文文本输出，不转成脚注。

### 发布

- 更新 release 资产并重新发布，包含 `main.js`、`manifest.json`、`styles.css`。
- 继续使用 GitHub artifact attestation 工作流为发布资产提供 provenance。

---

## [0.2.4] - 2026-05-13

### 新增

- 新增第三种引用模式：**文内模式（In-text）**，与脚注/尾注并列。
- 文内模式支持直接插入作者-年份正文引用，同时保留 Zotero 元数据以支持后续刷新与样式切换。

### 改进

- 文内模式在 Obsidian 编辑器中改为“脚注结构承载 + 文内文本渲染”，实现：
  - 编辑与管理侧可继续统一识别为插件管理引用；
  - 阅读侧不会暴露 `<!-- zotero... -->` 元数据标记。
- 文内引用加入完整兼容链路：插入、编辑定位符、刷新、批量换样式、与脚注/尾注互转、解除链接。
- Word 导出链路新增预处理：文内模式导出为**正文作者-年份文本**，不再以脚注形式进入 `.docx`。

### 文档

- 更新 `README.md` 与 `README_zh.md`，补充三模式说明以及文内模式导出行为。

### 修复

- 继续修复 Obsidian Community 审核反馈中的 TypeScript 类型安全告警（`settings.ts`、`ZoteroAPI.ts`）
- 优化 `ReferenceDocGenerator` 的实现与依赖，消除代码混淆/动态脚本相关误报
- 补充与稳定 release provenance 流程，确保发布资产可验证

---

## [0.2.3] - 2026-05-13

### 改进

- README 结构调整：`README.md` 现在为英文主文档，并在顶部提供中文文档入口；中文说明迁移到 `README_zh.md`
- 兼容社区审查建议：移除 `styles.css` 中的 `!important` 与 `:has()` 选择器，降低样式覆盖副作用与性能风险
- 弹窗/悬浮层兼容性改进：搜索与导出模态框、脚注悬浮层的定时器与窗口引用改为可兼容 popout 场景的实现
- 前端 DOM 构建规范对齐：搜索结果渲染与脚注标记创建改为 Obsidian 友好写法（`createDiv` / `createSpan` 风格）

### 修复

- 解决社区审查中指出的若干未使用符号与类型噪音问题（如设置模块未使用导入）
- 构建链补充 `pnpm.onlyBuiltDependencies`（`esbuild`），避免受限环境下安装阶段因 build script 审批失败

---

## [0.2.2] - 2026-05-12

### 修复

- 修复设置页「Zotero 连接状态」误报未连接的问题：改为多策略探测（插件 API、Connector Ping、Better BibTeX 端点）
- 修复设置页 CSL 样式列表无法像「修改引用格式」面板一样刷新动态 Zotero 样式的问题
- 修复高亮文本内 `[^n]` 在部分写法下不跟随高亮显示的问题（如 `==你好吧[^1]。`）

### 改进

- 设置页新增「刷新样式列表」按钮与提示文案，支持在设置中直接重载 Zotero 样式

---

## [0.2.1] - 2026-05-03

### 改进

- 对齐 Obsidian 官方插件规范：命令名、README、发布说明与实际行为同步，不再依赖手工命令前缀
- 将静态内联样式迁移到 `styles.css`，并把状态颜色改为 Obsidian 主题变量
- 构建产物改为生产模式压缩，GitHub Release 说明同步要求附带 `styles.css`

### 修复

- 扩充 README 披露说明，补充本地回环通信、临时文件、`pandoc` / `sqlite3` / `osascript` 等外部访问说明
- 改用 Obsidian `Platform` / `FileSystemAdapter` API，减少与官方规范不符的运行时用法
- 仓库不再跟踪 `main.js`，源码仓库与本地运行目录职责更清晰

---

## [0.2.0] - 2026-05-03

### 新增

- **动态 CSL 样式读取**：文档首选项窗口自动扫描 Zotero 已安装的 CSL 样式文件，附带搜索框和刷新按钮
- **标题栏按钮独立控制**：6 个标题栏快捷图标可在设置中单独开关
- **参考书目格式化**：插入参考书目时自动添加一级标题和引用块包裹

### 改进

- 命令面板中所有命令统一添加 `Zotero Citations:` 前缀，便于搜索
- Word 导出参考书目段落取消缩进、两端对齐
- Modal 标题与关闭按钮对齐（减少顶部空白）

### 修复

- 修复 `toolbarButtons` 设置在首次加载时可能为 `undefined` 的问题

---

## [0.1.0] - 2026-04-28

### 初始发布

- Zotero 引用插入（原生选择器 + 插件内搜索面板）
- 脚注/尾注双模式
- Word 风格脚注上标显示与悬停预览
- 定位符（页码/段落）编辑
- CSL 样式切换
- 参考书目生成
- Pandoc Word 导出
- 解除引用链接
- 标题栏快捷操作图标
