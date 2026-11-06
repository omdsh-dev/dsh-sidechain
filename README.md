# DSH Sidechain

[English](README.en.md)

Sidechain 让你在不中断 DSH 主对话的情况下快速侧问，或开启一个可持续追问的独立会话。

## 命令

| 命令 | 用途 |
| --- | --- |
| `/btw <问题>` | 在后台发起一次性侧问，主对话可以继续使用。 |
| `/side <问题>` | 开启可在独立线程中继续交流的侧会话。 |
| `/side list` | 查看当前会话的直接子会话。 |

输入 `/` 可在 DSH 原生命令菜单中找到 `/btw` 和 `/side`；图标、名称和说明会跟随 DSH 的系统语言显示。

侧会话会继承主会话已完成的历史作为参考，并将消息和工具活动保存在独立线程中，不写入主对话。两个命令都会在 DSH 原生侧栏中打开；多个侧会话显示为同一侧栏中的标签。`/side` 可以继续追问，`/btw` 则以只读的一次性问答为设计目标。

## 安装

### 从插件市场安装

在 DSH Web 的 **插件 → 实验性插件 → 更多** 中启用**自定义插件市场**，然后打开**发现 → 添加索引源**并填入：

```text
https://omdsh-dev.github.io/dsh-sidechain/index.json
```

找到 **Sidechain 侧会话**，确认 DSH 版本满足兼容范围后安装。当前市场只发布最新的 `0.2.2-rc.1`，支持 DSH `0.2.2-rc.1` 和 `0.2.1-rc.2` 至 `0.2.1-rc.5`。

### 从命令行安装

将插件安装到 Web profile：

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-sidechain
```

安装或更新后重启 DSH Web。当前支持 DSH `0.2.2-rc.1` 和 `0.2.1-rc.2` 至 `0.2.1-rc.5`。

卸载命令：

```sh
dsh plugin --profile web remove @dsh-external/dsh-sidechain
```

## 可选工具限制

默认情况下，侧会话继承 DSH 当前会话可用的工具。你可以通过插件配置为侧会话设置工具白名单：

```yaml
- insert:
    - id: dsh-sidechain
      name: '@dsh-external/dsh-sidechain'
      config:
        readOnlyTools:
          - read
          - grep
          - glob
```

白名单外的工具调用会被插件拦截，不影响主会话。DSH 的沙箱和审批策略仍然生效。

## 注意事项

- `/side` 和 `/btw` 都需要提供问题；fork 只继承已完成的对话回合，不包含正在生成的内容。
- `/side list` 会列出当前会话的所有直接子会话，不限于 Sidechain 创建的线程。
- `/btw` 在 Sidechain 界面中只读；DSH 底层仍将它保存为可续聊的子会话，其他客户端或直接 API 调用仍可能继续该会话。
- Desktop 使用独立 profile。虽然它与 Web 共用 DSH 前端，本版本尚未在 Desktop 上实测。
