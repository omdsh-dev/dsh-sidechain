# dsh-sidechain

DSH 侧会话插件。它通过 fork 当前会话创建隔离子会话，让用户在不中断主线程的情况下发起一次性问题或持续对话。

当前 Sidechain 版本为 `0.2.2-rc.1`，支持 DSH `0.2.2-rc.1`，并保留 `0.2.1-rc.2` 至 `0.2.1-rc.5` 的兼容性。Sidechain 的版本号始终与最新适配的目标 DSH 完全一致，包括预发布后缀；同一个插件包可以支持多个已验证的宿主版本，兼容范围由 `engines.dsh` 声明。

| 命令 | 用途 |
|---|---|
| `/btw <问题>` | 发起一次性侧问，适合快速确认信息 |
| `/side <问题>` | 创建可持续追问的侧会话 |
| `/side list` | 列出当前会话的直接子代理 |

侧会话继承主会话已经完成的回合作为参考上下文，但拥有独立的消息记录和执行过程。侧会话的提示、思考、工具调用和回答不会进入主会话的模型上下文。

## 功能

- `/btw` 在后台完成单轮问答，主会话可以继续使用。
- `/side` 创建可续聊线程，可直接在侧栏中发送后续消息。
- 输入 `/` 时，`/side` 与 `/btw` 使用 DSH 原生命令菜单，显示插件图标及系统语言对应的中文或英文名称和说明。
- 复用 DSH 原生右侧栏、子会话时间线、工具卡片、图片预览及流式显示。
- 新建侧会话自动打开原生标签页；主会话仍可编辑，不需要切换会话。
- 子会话历史持久化，重启 DSH 后仍可查看。
- 标签页、分栏、调宽、全屏及快捷键统一使用 DSH 原生行为。
- 内部运行说明默认折叠，可展开查看原文；模型上下文和持久化日志保持完整。

## 安装与卸载

依赖 DSH 提供的 `@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-subagent-fork-in-process`、`@deepseek-ai/dsh-session-projection` 和 `@deepseek-ai/dsh-commands`。默认 Web profile 已包含这些依赖。

### 从插件市场安装

在 DSH **插件 → 实验性插件 → 更多** 中启用**自定义插件市场**，打开**发现 → 添加索引源**，填入：

```text
https://omdsh-dev.github.io/dsh-sidechain/index.json
```

选择 **Sidechain 侧会话**，确认当前 DSH 在插件的兼容范围内后点击安装。索引中的 Git 来源固定到完整提交 SHA，发布包包含编译产物，无需为 Sidechain 授权安装构建脚本。

市场索引固定到已发布提交；若尚未列出与 DSH 配套的版本，可按下面的本地源码方式安装。切换版本时保留 DSH home 中的会话和 `sidechain-children.json`。

### 从命令行安装

使用包含 `0.2.2-rc.1` 适配的插件版本，并用 **0.2.2-rc.1** 或 **0.2.1-rc.2 至 0.2.1-rc.5** 的 CLI 安装或更新：

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-sidechain
```

安装后重启 DSH Web，并强制刷新浏览器。测试本地源码时，先运行 `pnpm install` 和 `pnpm build`，再安装本仓库的绝对路径：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-sidechain
```

Git 发布包自带 `lib/`，不执行 `prepare`。开发源码时需显式运行 `pnpm build`。

插件会向 Web profile 添加以下配置：

```yaml
- insert:
    - id: dsh-sidechain
      name: '@dsh-external/dsh-sidechain'
```

安装或更新插件代码后，重启 `dsh web` 并刷新页面。

Web 与 Desktop 使用同一 DSH 前端，命令菜单改动由插件提供，不需要修改 DSH 源码。使用 Desktop 时，请将插件安装到 `desktop` profile 并重启 Desktop；Web 和 Desktop 的 profile 相互独立。此改动已在 Web 版 DSH `0.2.1-rc.2` 至 `0.2.1-rc.5` 与 `0.2.2-rc.1` 验证，Desktop 包装器因本地缺少 Electron 运行环境而尚未进行实际运行验证。

### 卸载

```sh
dsh plugin --profile web remove @dsh-external/dsh-sidechain
```

该命令会同时移除 profile 依赖和插件配置层。完成后重启 `dsh web` 并刷新页面。

## 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `providerName` | `fork` | 继承父历史、支持本地 continuable 会话的 fork provider |
| `persona` | 内置侧会话 persona | 追加到首条边界消息的行为约束；空字符串表示不追加；子会话继承父方 system persona |
| `readOnlyTools` | 未设置 | 可选工具 allow-list，例如 `['read', 'grep', 'glob']`；隐藏不允许的继承工具，并在执行入口拒绝白名单外的工具 |

DSH 自 RC.2 起已删除 subagent 启动参数中的 `persona` 和 `toolFilter`。插件保留上述配置入口：`persona` 作为子会话自己的用户消息持久化，不覆盖父方 system prompt；`readOnlyTools` 在侧会话创建、恢复及插件重新加载时应用当前配置，不依赖模型遵守提示词。旧子会话 descriptor 中的历史限制仍由 DSH 恢复，并与当前工具限制取交集。工具名称无效时创建失败；空列表与未设置均表示不增加限制。

宿主在子会话本地注册的工具可能仍显示在 schema 中，例如 `subagent`，但白名单外的调用会被执行守卫拒绝。PTC 的 `run_code` 传输入口保留，其调用的具体工具仍受白名单约束。

侧会话身份继续保存在 `DSH_HOME/sidechain-children.json`，用于恢复工具限制和父收件箱隔离。请保留此文件；文件损坏或不可写会明确报错，避免静默丢失保护。

配置示例：

```yaml
- insert:
    - id: dsh-sidechain
      name: '@dsh-external/dsh-sidechain'
      config:
        providerName: fork
        readOnlyTools:
          - read
          - grep
          - glob
```

## 使用

一次性侧问：

```text
/btw 这个目录下哪个文件最大？
```

命令立即返回，DSH 原生右侧栏自动打开子会话并显示执行过程和答案。`/btw` 没有追问输入框；运行时提供停止按钮。

持续侧会话：

```text
/side 分析一下当前插件的事件流
```

原生侧栏会打开新线程。在线程底部使用 DSH 原生输入框继续对话，发送、排队、转向和停止沿用宿主交互。

查看子代理列表：

```text
/side list
```

`/side` 和 `/btw` 都必须提供问题。

## 原生侧栏

Sidechain 不再提供独立浮层、列表、聊天渲染器或输入框。创建命令会自动打开 DSH 原生子会话标签页；历史命令卡片的“在侧栏中打开”按钮和会话标题栏的原生子代理菜单都能重新打开线程。重复打开同一线程复用原生标签页。

选择一个线程后，原生时间线显示：

- 用户消息与模型回答
- 上下文注入与模型思考
- 工具调用、结果和错误
- Markdown、代码块、表格与公式

`/side` 使用原生输入框持续对话；`/btw` 显示只读说明，等待命令身份加载时也不会先开放输入。原生主视图打开 BTW 时同样适用。待处理的权限确认仍由 DSH 显示。

侧栏打开不切换主会话。后台会话的命令完成不会把子会话打开到另一个父会话的侧栏。关闭、分栏、全屏和重新打开均由 DSH 管理，刷新和重启后沿用宿主的标签页恢复。原来的 Sidechain 按钮、手动刷新和 `Ctrl/Cmd+Shift+E` 独立快捷键已移除。

子会话继承的父历史按 DSH 原生规则展示，当前没有单独的“全部继承历史”折叠区。Sidechain 只折叠可识别的内部边界及 persona 说明，保留问题正文、图片和展开原文入口；复制及持久化仍使用完整原始消息。

## 会话隔离

fork 只继承父会话已经完成的回合。继承内容仅作为参考，boundary 之后的消息才是侧会话的当前任务。

每个侧会话拥有独立日志。侧会话的消息、工具活动和回答留在子会话中，不会作为用户消息或子代理通知进入主会话。主会话只保留创建侧会话的命令结果。

默认 persona 允许非破坏性探索，不会主动修改文件、请求提权、创建子代理或向父会话报告。用户在侧会话中明确要求修改时，实际权限仍由 DSH 的 sandbox 和工具配置决定。

## 限制

- fork 不包含父会话正在进行的回合。
- 当前支持的 DSH 版本将新建本地子会话统一存为 `continuable`。本插件从父会话已有命令结果投影出 `/btw` 身份，在原生侧栏与主视图均保持只读；这不是宿主层的不可续聊权限，其他客户端或直接 API 调用仍可能续聊。需要正常追问时使用 `/side`。
- `/side list` 和 DSH 原生子代理菜单列出当前会话的全部直接子代理，不限于本插件创建的线程。
- `/side` 必须带首个问题；当前 subagent API 不支持创建后等待首次输入的空线程。
- 多版本兼容指同一个插件包可运行于各个受支持宿主，不代表可以用旧版 DSH 打开新版宿主写入的会话数据。共享 DSH home 的宿主降级未验证；兼容范围外的后续版本需另行验证。

## 开发

```sh
pnpm install
pnpm check
```

`pnpm check` 依次执行类型检查、测试和构建。开发依赖固定到 DSH `0.2.2-rc.1`，可直接从 npm registry 安装；DSH peer dependencies 与宿主兼容范围保持一致。

插件版本跟随最新适配的目标 DSH，不独立递增。宿主兼容范围以 `package.json` 的 `engines.dsh` 为准，当前为 `>=0.2.1-rc.2 <=0.2.1-rc.5 || 0.2.2-rc.1`；不自动包含两段之间的版本或后续版本。构建时校验包版本与目标 DSH 开发依赖一致，并校验插件清单的版本、兼容范围分别与包清单一致。市场索引从已提交的包清单派生版本和兼容范围。

### 发布插件市场

GitHub Pages 从 `master` 的 `docs/` 发布索引。完成适配后运行 `pnpm build`，将源码与生成的 `lib/` 一起提交；随后运行 `pnpm build:market`，再提交生成的 `docs/index.json`、`docs/icon.svg` 并推送 `master`。Pages 随推送自动更新，无需额外的 Actions 工作流。

`pnpm build:market` 先重新构建并检查 `lib/` 与已提交产物一致，再由 `scripts/build-market.mjs` 从当前 Git 提交读取包清单、语言文件和图标；版本、兼容范围、发布时间和安装 SHA 均派生自同一提交。生成文件不手工编辑；每次发布代码时重新生成，确保索引固定到该次发布的源码。

索引仅列当前版本，不扫描历史标签，避免旧独立版本号 `0.6.x` 被市场误判为推荐更新。旧 Git 标签保留，npm 发布不是安装前提。

浏览器通过 `ctx.sidebarRight.openResource()` 打开原生 `subagentchat` 资源，Session 的持有、释放、事件订阅、图片与续聊由 DSH 管理。Sidechain 只保留命令卡片、实时创建观察器、BTW composer 扩展及内部说明的 UserText 扩展。`sidechainModes` 投影只从已有 `command/done` 记录推导命令身份，不根据可变标题猜测类型，也不另存一份身份记录。首次启动使用 `delivery: 'caller'`，持久化的父收件箱过滤继续保护冷启动后的续聊。

原生 UI 重构与实测见 [原生侧栏验证记录](docs/native-sidebar-ui.md)。此前验证见 [DSH 0.2.2 适配记录](docs/dsh-0.2.2-compatibility.md)；旧版验证与四个 issue 的历史处理结论见 [DSH 0.2.1 适配记录](docs/dsh-0.2.1-compatibility.md)。
