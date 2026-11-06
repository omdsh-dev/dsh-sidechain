# DSH Sidechain

[中文](README.md)

Sidechain lets you ask a quick question or start a separate conversation without interrupting your main DSH session.

## Commands

| Command | What it does |
| --- | --- |
| `/btw <question>` | Ask a one-off question in the background. The main conversation stays available. |
| `/side <question>` | Start a side conversation you can continue in its own thread. |
| `/side list` | List the current session's direct child conversations. |

Type `/` to find `/btw` and `/side` in DSH's native command menu. Their icons, names, and descriptions follow the DSH language setting.

Side conversations use the current session's completed history as context and keep their messages and tool activity in a separate thread. Both commands open the native DSH sidebar; multiple side conversations appear as tabs in the same sidebar. `/side` supports follow-up messages, while `/btw` is read-only in the Sidechain UI and intended for one-off questions.

## Install

### From the plugin market

In DSH Web or Desktop, enable **Custom plugin market** under **Plugins → Experimental plugins → More**, then open **Discover → Add index source** and enter:

```text
https://omdsh-dev.github.io/dsh-sidechain/index.json
```

This URL is for **Add index source**. If using the **Install plugin** input instead, enter `github:omdsh-dev/dsh-sidechain`.

Find **Sidechain**, check that your DSH version is supported, and install it. This project's index currently lists only the latest `0.2.2-rc.1`, which supports DSH `0.2.2-rc.1` and `0.2.1-rc.2` through `0.2.1-rc.5`.

You can also install Sidechain using the indexes provided by [DSH Market](https://dsh.market/) or [dshfind](https://dshfind.com/zh). Copy the index URL from either site into DSH's **Discover → Add index source**, then search for **Sidechain** and install it.

### From the command line

Install the plugin into the Web profile:

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-sidechain
```

To install into the Desktop profile, launch Desktop once to initialize it, fully quit the application, then run:

```sh
dsh plugin --profile desktop add github:omdsh-dev/dsh-sidechain
```

Restart the corresponding DSH Web or Desktop application after installing or updating.

To remove it (replace `web` with `desktop` for Desktop):

```sh
dsh plugin --profile web remove @dsh-external/dsh-sidechain
```

## Optional tool limits

By default, side conversations inherit the tools available to the DSH session. You can set an allow-list for side conversations:

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

Sidechain filters and blocks tool calls outside this list; the main session is unaffected. DSH sandbox and approval settings still apply.

## Notes

- Both `/side` and `/btw` require a question. Forks include completed turns only, not a turn that is still running.
- `/side list` lists all direct child conversations in the session, not only threads created by Sidechain.
- `/btw` is read-only in Sidechain's UI. DSH still stores it as a continuable child session, so other clients or direct API access may allow continuing it.
- Installation and use have been verified on Desktop. Desktop and Web use separate profiles; install the plugin separately for each.
