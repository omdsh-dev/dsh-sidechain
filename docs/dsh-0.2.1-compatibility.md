# DSH 0.2.1 适配记录与后续方案

## RC.4 当前适配

Sidechain 版本、包与插件清单的 `engines.dsh`、全部 DSH 依赖和锁文件同步到 `0.2.1-rc.4`，重新生成发布用 `lib/`。RC.4 的类型检查与真实运行未要求修改插件业务逻辑。旧 `0.2.1-rc.2` 插件会被 RC.4 的精确版本检查跳过，不能只升级宿主而保留旧插件。

### 实测环境与结果

2026-10-28 使用本机已安装的官方 `dsh 0.2.1-rc.4` 启动 Web profile；实际加载的 Session、Subagent 和 LLM 包均为 RC.4。旁边的 DSH 源码目录仍为 RC.3，本轮没有用它启动宿主，也没有修改 DSH。通过官方 `dsh plugin --profile web add <本地仓库>` 安装到独立 DSH home，无版本豁免。

可见 Chromium 149、Standard mode、官方真实 `deepseek-official / deepseek-flash` 完成以下路径，模型请求未替换或拦截：

- 父会话记录随机代号，`/btw` 从继承上下文正确回答，侧栏不提供续聊输入框。
- `/side` 通过真实 `read` 工具读取另一随机文件值，展示工具参数和结果；续聊正确回忆父代号与文件内容。
- 生成期间捕获尚未完成的真实文本，主输入框仍可用；完成后运行提示消失。`/side list` 正确显示两种命令身份，原生子代理入口可打开已完成的 `/btw`。
- 浏览器刷新与宿主冷重启后仍可读取历史；恢复的 `/btw` 保持只读，`/side` 继续回答。重启前后的父日志不含子文件内容、续聊答案或子代理通知，侧栏也未显示父方旧回答。
- 重启时启用 `readOnlyTools: [read, grep, glob]`，恢复与新建子会话的继承工具均被过滤，新子会话仍能读取文件；父会话保留 `write`、`bash`。真实模型未尝试未暴露的写入工具，未创建目标文件，因此本轮不宣称实测过执行守卫拒绝分支；该分支由现有单元测试覆盖。

默认配置下，`/btw` 与 `/side` 的首次模型响应分别记录 8,704 和 8,832 个 `cacheReadTokens`。启用工具白名单后的请求集合不同，不沿用这组缓存结论。

`pnpm check` 通过两个类型检查、127 项测试和 Host/Client 构建。上述浏览器路径未捕获插件异常；另记录到宿主 `/open-in-app/icon/filemanager` 的 HTTP 404，与 RC.2 实测相同。截图、一次性实验脚本和真实会话证据位于忽略入库的 `dist/rc4-real-model/`，包括 `side-tool-real.png`、`stream-real.png`、`cold-btw-real.png`、`final-real-browser.png`、`readonly-real.png` 和 `results.json`。

本轮未覆盖 macOS/Windows Electron、旧版会话迁移、附件交互、PTC 模式及 #11 的长历史场景。#5 的完成回合限制仍存在；本轮不改变既有 issue 状态。市场索引必须在源码提交后按发布流程重新生成，不能把旧 RC.2 提交声明为 RC.4。

## RC.2 历史适配

Sidechain 版本、`package.json` 的 `engines.dsh`、插件清单和全部 DSH 依赖同步到官方 `0.2.1-rc.2`；Cordis 为 `4.0.5`，Schemastery 为 `3.18.5`。浏览器验收使用本地 DSH 源码 `687f282e8625c6b8d11ff58211a90524be2e4317`，通过官方源码 CLI 的 Web profile 启动。未修改 DSH 源码。

### 接口迁移

- 新宿主优先读取包自身的 `engines.dsh`；构建校验它与包版本、插件清单版本及兼容声明一致。
- `SubagentStartRequest` 已移除 `persona`、`toolFilter`。fork 必须继承父 preset；插件将 `persona` 内容放进子会话第一条边界消息，保留行为指导而不替换 system persona。默认及空字符串配置均有验证，侧栏只显示用户问题。
- `readOnlyTools` 通过 `agent/created` 在第一轮执行前恢复到子作用域；`tools.restrict` 过滤继承工具，`tools.guard` 阻止包括子作用域工具在内的白名单外执行。仅 PTC `run_code` 传输入口保留，具体工具仍过守卫。卸载释放所有贡献，重载重新应用当前配置。
- 工具限制复用已有持久化子会话身份，不增加第二份注册表。损坏或不可写的身份文件会报错。外部执行或不继承历史的 provider 在创建前被拒绝，防止避开本地限制。

### 验证证据

使用可见 Chromium、真实 `deepseek-official / deepseek-flash`，未替换或拦截模型请求；实验采用独立 DSH home、工作目录和官方目录选择器 overlay。证据保存在忽略入库的 `dist/rc2-real-model/`。

已验证 `/btw` 继承随机父代号并只读，`/side` 由真实模型读取随机文件值、续聊回忆、刷新恢复、生成中部分输出、原生子代理历史入口，以及宿主冷重启后的历史和续聊。父日志没有子文件内容或子代理通知。默认配置下，两个子会话首请求分别记录到 8,576 和 8,704 个 `cacheReadTokens`，子会话没有新增替换 persona 的 system 消息。

冷启动时启用 `readOnlyTools: [read, grep, glob]`，恢复的侧会话继续回答；新侧会话成功读取文件，真实模型尝试调用 `write` 时收到 `not allowed by readOnlyTools`，目标文件未创建。父会话新请求仍保留 `write`、`bash`。宿主自己的 `subagent` 工具仍出现在子 schema 中，但插件的执行守卫会拒绝白名单外调用；这一分支另用真实工具注册表验证，包含后注册工具、重载、恢复、卸载及父/其他会话不受影响。模型实测没有发出 `subagent` 调用，不将它算作真实模型调用通过。

类型检查、插件测试及 Host/Client 构建已通过。记录到的浏览器验收没有插件异常；宿主仍有 `/open-in-app/icon/filemanager` 的 HTTP 404。此次未验证旧 alpha 会话迁移、Electron、完整附件交互、PTC 实际模型调用或长上下文/其他模型缓存；启用工具白名单会改变请求工具集合，默认配置的缓存结果不适用于该场景。

### Issue 状态边界

#9、#8 的既有关闭结论保留；RC.2 再次验证浏览器加载及默认 Flash 缓存命中。#3 没有旧失败数据可用于验证。#5 仍依赖宿主 fork 支持未闭合回合，按用户要求保持开放，本次不实现。

### 插件市场发布与安装验收

市场索引为 `https://omdsh-dev.github.io/dsh-sidechain/index.json`，通过 GitHub Pages 从 `master` 的 `docs/` 目录发布。索引只包含 `0.2.1-rc.2`，版本和兼容范围来自包清单，安装固定到源码提交 `9f956d8e1f6276f7c98d391f7590faf011d63c68`。旧 `0.6.x` Git 标签保留但不进入索引，避免 RC.2 市场把缺少兼容声明的 `0.6.2` 推荐成更新。

首次真实安装暴露 pnpm `11.28.5` 的 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`：DSH RC.2 将它显示为通用失败，没有可用的构建授权按钮。因此 Git 发布包改为携带生成的 `lib/` 并移除 `prepare`；`pnpm build:market` 重新构建并检查产物与已提交内容一致，再生成索引。无需修改 DSH 或让用户手工放行安装脚本。

公开索引返回 HTTP 200、没有重定向，通过官方 `parseMarketIndex` 校验。全新隔离 Web profile 的可见 Chromium 从该 HTTPS 索引进入版本页、确认完整 Git SHA、下载并启用插件；实际依赖位于 profile 的独立 pnpm 安装目录，锁文件指向上述提交，没有源码链接或构建脚本授权配置。市场卡片展示名称、图标、双语描述、作者、主页和源码链接，只推荐 RC.2。

安装后的真实 `deepseek-official / deepseek-flash` 已验证父会话、`/btw` 继承随机代号且侧栏只读、`/side` 调用 `read` 读取随机文件、续聊回忆两项内容、刷新后重新选择线程并恢复历史。父日志不含子文件内容或子代理通知。子会话首次请求分别命中 8,576 和 8,704 个缓存 token，没有记录到未捕获的浏览器脚本错误。证据位于忽略入库的 `dist/market-install/`；本轮未重复 Electron、旧版会话迁移和其他模型验证。

以下为 alpha.2 阶段的历史记录，模型用量和验证结论仅属于当时的基线。

## alpha.2 历史基线与完成范围

- Sidechain：默认 `master` 分支，版本 `0.2.1-alpha.2`，与所适配的 DSH 一致。
- DSH：源码 `d743267388641bc76f17c45ce8b4c231aed1d32c`，版本 `0.2.1-alpha.2`。
- 本机 PATH 中的 `dsh` 仍报告 `0.2.0-rc.2`；验证使用新版源码 CLI 启动的独立 Web 实例。
- `pnpm check` 通过：两个类型检查、122 项测试及 Host/Client 构建。

本次完成新版本接口适配，不实现未闭合回合继承或缓存策略改造。现有用户的 DSH home、配置和会话未用于实验。适配已推送至默认分支，GitHub #9 与 #8 已附验证说明并关闭；#8 按默认 Flash 模型范围验收。尚未创建 release 或发布 npm 包。

## 关键适配

| 边界 | 当前实现 |
| --- | --- |
| 创建子会话 | `startActivation`，`delivery: 'caller'`，创建前登记子会话身份 |
| 目录与状态 | `projectionsBySession` 的 `subagentCatalog`，运行状态取 Session summary |
| 流式内容 | 展开 follow 快照中的 `assistantStream.activeAttempt`；临时片段不进入持久历史缓存，提交后的消息替换临时内容 |
| 工具结果 | 使用新版扁平 `message.toolCallId/content/isError` |
| 续聊与附件 | 官方 `SubagentPromptRequest`、显式 `delivery: 'queue'`、命令 `input.attachments` |
| 浏览器加载 | 当前平台图标和模块表；客户端仅保留 React、React DOM、JSX runtime、UI primitives 的运行时外部导入 |
| 父会话隔离 | 冷恢复后继续拦截已登记子会话的 `agent-message` 与 settlement 通知 |

新版 DSH 的本地 activation 一律创建 `continuable` 会话。插件的 `/btw` 仍作为单次问题展示，但这不是宿主权限保证：原生子代理入口和其他 API 调用方可以继续该子会话。

为区分“宿主是否支持续聊”和“由哪个插件命令创建”，增加 `sidechainModes` 投影。唯一原始事实仍是已有 `command/done` 成功记录；目录标签不是身份依据。投影由 DSH 负责持久缓存、失效和重放，插件不另存一份模式注册表。真正的继承标记 `session/end-seed { inherited: true }` 清除继承的命令身份，普通恢复标记不会清除。浏览器实测发现了这两个标记的区别，已有对应回归用例。

## 实际浏览器验证

使用 Playwright 启动可见 Chromium 149.0.7827.55（`headless: false`），打开新版源码 DSH Web 并加载本地 Sidechain。使用现有环境中的 DeepSeek 凭据和官方 `deepseek-official / deepseek-flash` 路由，界面模型名为 DeepSeek-V4.1-Flash。模型请求未拦截或替换。启用官方 browse-picker overlay，使用隔离 DSH home 和实验工作目录。

真实模型已验证：

1. 先在父会话完成一轮随机代号记录；`/btw` 不重复提供代号，仍正确回答，且完成后侧栏无输入框。
2. `/side` 正确继承父代号，由真实模型调用 `read` 读取 `sample.txt` 中的另一随机值；UI 可展开实际工具参数和结果。
3. 第二轮不调用工具，正确复述父代号和文件内容；浏览器刷新后仍能读取此前对话。
4. 模型生成约 180 词回答时，在结尾尚未出现、仍显示 `Deep diving...` 的时刻捕获实际部分输出；随后正常完成。
5. 停止并重新启动源码 Host，重新打开 `/btw` 仍只读；`/side` 可续聊并正确回忆原始代号和文件值。
6. 检查重启前后父会话持久日志，不含子会话文件值、续聊回答或子代理通知。
7. DSH 原生子代理导航也能打开已完成的 `/btw` 历史。

本地截图、一次性脚本、去除继承部分后的模型用量记录和会话证据位于 `dist/real-model-smoke/`，不入库。主要截图：`btw-real.png`、`side-tool-real.png`、`side-followup-real.png`、`stream-real.png`、`native-btw-real.png`、`cold-btw-real.png`、`final-real-browser.png`。`results.json` 记录各项验收和实际模型用量。

先前 `dist/compat-smoke/` 中的 headless 浏览器验证使用确定性 SSE 模型，覆盖拖拽调宽、深浅主题、快捷键、`/side list` 和 `BTW:` 标题碰撞等交互；这些记录与本轮真实模型证据分开保留。

浏览器无未捕获 JS 异常或插件模块错误；仍有宿主 `/open-in-app/icon/filemanager` 的 HTTP 404。真实模型的父首轮发生一次 `TRANSPORT` 错误，宿主自动重试后成功；后续子会话请求均成功。未测试长上下文缓存对照实验、旧版会话迁移、桌面 Electron 以及图片/文件附件的完整交互。

## 四个 issue 的处理结论

| Issue | 最新版本结论 | 建议 |
| --- | --- | --- |
| [#9 模块表与 connection.api](https://github.com/omdsh-dev/dsh-sidechain/issues/9) | 已关闭；当前版本使用 `ctx.remote`，真实浏览器验证了加载、历史和发送 | 升级 DSH 与默认分支 Sidechain 至配套版本；不宣称旧版 DSH 也兼容 |
| [#3 完成后历史读取失败](https://github.com/omdsh-dev/dsh-sidechain/issues/3) | 当前源码、当前格式的新会话，在插件和原生入口都未复现；冷恢复验证通过 | 保留旧版问题的证据边界，不把新会话通过当作旧数据已修复 |
| [#8 persona 破坏缓存前缀](https://github.com/omdsh-dev/dsh-sidechain/issues/8) | 按 Flash 范围关闭；当前默认 `deepseek-flash` 支持宿主追加 system 更新，保留默认 persona 的两个子会话首次请求均命中 8,448 个缓存 token | 优先复用宿主模型能力；其他路由与超长上下文的结果仍需分别验证 |
| [#5 缺少未闭合回合](https://github.com/omdsh-dev/dsh-sidechain/issues/5) | 新版 fork provider 仍截取最后一个 `turn/end`；没有自动解决 | 在宿主复用精确事件切点和现有 fork 修复原语 |

### #9：把真实加载合同作为发布边界

推荐固定支持一个 DSH 版本，并以完整用户路径验收：冷启动加载客户端、创建子会话、读取流式及已完成内容、续聊、再重启读取。同一次验证记录源码版本、实际浏览器错误和插件构建版本。

本次已经完成这条路径。发布时携带同样的实测证据，避免用 Host 无报错或 bundle HTTP 200 推断客户端兼容；无需恢复已删除的模块或增加多版本动态猜测。

### #3：统一地址读取，保留失败原因

当前 Session Controller 的 `sourceFor()` 已通过 `sessionQuery.observeSession()` 读取运行中或持久化 Session，再验证父子地址。插件继续使用同一 `SessionAddress` 和 `follow/page`，不另写旧版专用历史读取器。

后续有具体旧数据复现时，先保留失败阶段及官方错误身份：地址校验、格式迁移、读取、解码。当前插件将这些失败折叠为 `null`，UI 只能提示“无法加载”；可让读取结果保留官方错误，错误状态展示简短原因与重试。若根因是宿主迁移或损坏日志，应在其语义归属处修复，插件不跳过校验或悄悄显示空历史。

验收应使用一个去敏后的真实失败会话，分别经原生入口和插件入口读取；现有成功样例不能替代它。

### #8：先复用宿主的追加式 system 更新

真实浏览器验证改变了此 issue 在默认模型上的判断。当前 `deepseek-flash` 声明 `systemPromptUpdate: 'in-history'` 和 `toolUpdate: 'addition-only'`；Agent Loop 根据实际 `prepareCall()` 的能力，在连续请求序列中追加改变后的 system 提示，而不重写已有头部。Sidechain 默认 persona 仍覆盖子会话的有效 persona，但不必因此破坏已有历史前缀。

本轮父请求使用 8,480 个未缓存输入 token。保持默认插件配置时，`/btw` 首次请求为 1,728 个未缓存输入 token、8,448 个 `cacheReadTokens`；`/side` 首次请求为 1,745 个未缓存输入 token、8,448 个 `cacheReadTokens`。另核对两个子会话：继承的 22 条父事件逐条不变，首个子 system 更新为 `surfaceOp: 'append'`，工具 schema 与父请求相同。续聊也记录到缓存命中。这证明本轮默认路由确实复用了前缀，但短会话结果不代表长上下文或全部模型配置已解决。

因此，默认路由先沿用宿主已有能力，无需插件增加一套缓存策略或模型请求编译器。对未声明追加式更新能力的路由，已有 `persona: ''` 可作为对照；若需要改变默认策略，再把 persona 中必要的侧会话约束移到 fork 后唯一的边界消息，保持父模型路由、system 前缀、工具 schema 和历史原样。实际工具权限仍由宿主策略控制，不能用提示词替代。

下一步在同一模型和固定长上下文上，比较默认 persona 与 `persona: ''` 的首轮 `cacheReadTokens`、输入费用和首 token 延迟，同时核对请求前缀。工具 allow-list、保留工具的 schema 变更、压缩导致的新请求序列，以及服务端缓存寿命都应独立记录；不能仅凭配置名承诺命中。模型能力的判断继续由宿主 `prepareCall()` 负责。

### #5：精确事件切点，复用宿主 fork 原语

新版已有可用基础：`packages/core/session/src/fork.ts` 的 `buildForkSeed(events, boundary)` 复制精确前缀，插入继承边界，并为未闭合工具、step、turn 生成 fork 专用结束记录。普通 Session Controller fork 已使用它。

缺口在 subagent 链路：`packages/subagent/subagent-fork-in-process/src/index.ts` 仍只取完成回合；`packages/subagent/subagent/src/manager.ts` 将 `inheritedEventCount` 设置成整个 `seed.length`。直接把 `buildForkSeed()` 的结果塞入现有 provider，会把边界标记和合成结束记录也算作继承前缀，与 Session 的校验和语义冲突。

推荐在宿主扩展现有 `ContinuableCreateSpec`，让 provider 同时返回 seed 与精确 `inheritedEventCount`，并允许指定捕获的父事件切点。使用一次捕获的不可变视图，合成的结束记录只属于 child，不修改正在执行的 parent；冷恢复使用已存 seed，不重新截取父会话。

若暂时不改宿主，插件可在保持当前合法 fork seed 的基础上，将同一捕获切点之后的已提交事件转换成只读参考段，追加到边界消息中。必须保留用户请求、完成/未完成工具状态与事件顺序，不能把进行中的调用写成成功结果。该退路需要额外转换和限长规则，优先级低于复用宿主原语。

验收集中在三个场景：父首轮尚未结束、父工具调用未返回、创建期间父会话继续追加事件。每个场景检查 child 看见准确的已提交前缀、parent 完全不变、child 可恢复续聊。尚未提交的流式 token 不属于这项历史继承合同。

## 推荐后续顺序

默认分支已包含本次兼容版本，#9 与 #8（Flash 范围）已关闭。主要功能改造优先推进 #5 的宿主 fork 边界扩展；#3 保留开放，等待旧数据复现。缓存方面可继续补长上下文及其他模型路由的对照，暂不添加新策略。两项增强共用一个基础：不可变的父会话快照，加上子会话自己的边界后缀。
