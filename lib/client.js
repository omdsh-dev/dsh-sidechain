window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-sidechain",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region src/command-result.ts
		function sideCommandResult(result) {
			if (result?.kind !== "success" || result.text === void 0) return void 0;
			const match = /^(Side conversation|BTW question) started: ([0-9a-f-]{36})\.$/.exec(result.text);
			if (match === null) return void 0;
			return {
				childId: match[2],
				mode: match[1] === "BTW question" ? "btw" : "side"
			};
		}
		//#endregion
		//#region src/client/SideCommandCard.tsx
		const MARKDOWN_LABELS = {
			code: {
				copyLabel: "Copy",
				copiedLabel: "Copied"
			},
			footnotes: "Footnotes"
		};
		/**
		* Resolve the created child session id from a settled command node, or
		* undefined while the command is running, failed, or the id is absent.
		* The host pins the id in a stable marker: `/side` texts start with
		* `Side conversation started: <uuid>.`, `/btw` texts with
		* `BTW question started: <uuid>.`.
		*/
		function resolveChildSessionId(node, kind) {
			const created = sideCommandResult(node.outcome);
			return created?.mode === kind ? created.childId : void 0;
		}
		/**
		* Fold one command-node snapshot into the observer state.
		*
		* The first snapshot is a replay baseline and emits nothing. Later snapshots
		* emit a child when a post-mount command appears already settled or an
		* observed pending command settles. The mount timestamp excludes late
		* history hydration; recording the resolved id makes repeats idempotent.
		*/
		function observeCreatedChildren(previous, nodes, startedAt) {
			const known = new Map(previous);
			const children = [];
			for (const node of nodes) {
				if (node.name !== "side" && node.name !== "btw") continue;
				const child = resolveChildSessionId(node, node.name);
				if (previous !== void 0 && node.time >= startedAt && child !== void 0 && previous.get(node.commandId) !== child) children.push(child);
				known.set(node.commandId, child);
			}
			return {
				known,
				children
			};
		}
		/** The command card can reopen history; the composer observer owns live discovery. */
		function SideCommandCard({ node, openChild, t }) {
			const kind = node.name === "btw" ? "btw" : "side";
			const childId = resolveChildSessionId(node, kind);
			const outcome = node.outcome;
			const label = outcome === null ? "…" : outcome.kind === "error" ? outcome.text ?? "" : outcome.text ?? `/${kind}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "6px 10px",
					borderRadius: "8px",
					background: "var(--dsw-alias-bg-module-platform, #f5f6f7)",
					fontSize: "13px",
					lineHeight: "1.5"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
						style: {
							whiteSpace: "nowrap",
							display: "block",
							marginBottom: "2px"
						},
						children: ["/", node.name ?? kind]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { overflowX: "auto" },
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
							text: label,
							streaming: false,
							labels: MARKDOWN_LABELS
						})
					}),
					childId !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						onClick: () => openChild(childId),
						children: t("view.open")
					})
				]
			});
		}
		//#endregion
		//#region src/client/native-sidebar.tsx
		function nativeChildAddress(parentId, childId) {
			const query = new URLSearchParams({
				parent: parentId,
				mode: "continuable"
			});
			return `dsh-resource://subagentchat/session/${encodeURIComponent(childId)}?${query}`;
		}
		function sidechainComposerReason(modes, childId) {
			return modes === void 0 ? "loading" : modes[childId] === "btw" ? "btw" : null;
		}
		function NativeChildObserver({ sessionId, useChat, openChild }) {
			const nodes = useChat((snapshot) => snapshot.nodes.values());
			const commands = (0, react.useMemo)(() => nodes.filter((node) => node.kind === "command").map((node) => node.data), [nodes]);
			const observed = (0, react.useRef)({
				sessionId,
				startedAt: Date.now(),
				known: void 0
			});
			(0, react.useEffect)(() => {
				if (observed.current.sessionId !== sessionId) observed.current = {
					sessionId,
					startedAt: Date.now(),
					known: void 0
				};
				const next = observeCreatedChildren(observed.current.known, commands, observed.current.startedAt);
				observed.current.known = next.known;
				for (const childId of next.children) openChild(childId);
			}, [
				commands,
				sessionId,
				openChild
			]);
			return null;
		}
		function SidechainReadOnly({ matched, useSession, useSessions, refresh, stop, t }) {
			const running = useSession((session) => session?.running === true);
			const unavailable = useSessions((state) => {
				const projection = state.projectionsBySession[matched.parentId];
				return projection?.state === "error" || projection?.state === "migration-required" || projection?.state === "ready" && projection.values.sidechainModes === void 0;
			});
			const [failed, setFailed] = (0, react.useState)(false);
			const [stopping, setStopping] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (matched.reason !== "loading") return;
				let active = true;
				refresh(matched.parentId).catch(() => {
					if (active) setFailed(true);
				});
				return () => {
					active = false;
				};
			}, [
				matched.parentId,
				matched.reason,
				refresh
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "status",
				"data-sidechain-readonly": matched.reason,
				style: {
					padding: 16,
					display: "flex",
					gap: 12,
					alignItems: "center"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(failed || unavailable ? "view.error" : matched.reason === "btw" ? "view.readonly" : "view.loading") }),
					matched.reason === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						onClick: () => {
							setFailed(false);
							refresh(matched.parentId).catch(() => setFailed(true));
						},
						children: t("view.retry")
					}),
					running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						disabled: stopping,
						onClick: () => {
							setStopping(true);
							stop().then((ok) => setFailed(!ok), () => setFailed(true)).finally(() => setStopping(false));
						},
						children: t("view.stop")
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const NS = "sidechain";
		const zh = {
			"command.side.label": "侧会话",
			"command.side.description": "开启独立侧会话，可持续追问",
			"command.btw.label": "随问",
			"command.btw.description": "在后台问一个问题，不打断当前对话",
			"view.instructions": "侧链运行说明（展开原文）",
			"view.open": "在侧栏中打开",
			"view.stop": "停止生成",
			"view.retry": "重试",
			"view.readonly": "一次性侧问（不可续聊）",
			"view.loading": "正在确认侧会话类型…",
			"view.error": "操作失败，请重试"
		};
		const en = {
			"command.side.label": "Side conversation",
			"command.side.description": "Start a separate conversation with follow-ups",
			"command.btw.label": "Quick question",
			"command.btw.description": "Ask a question in the background without interrupting this conversation",
			"view.instructions": "Sidechain instructions (show original)",
			"view.open": "Open in sidebar",
			"view.stop": "Stop generating",
			"view.retry": "Retry",
			"view.readonly": "One-shot side question (no follow-up)",
			"view.loading": "Checking side conversation type…",
			"view.error": "Operation failed. Please retry."
		};
		//#endregion
		//#region src/prompts.ts
		/**
		* Pinned model-visible text for side conversations (Codex `/side` & `/btw`
		* semantics: a side conversation is an isolated fork used for a quick question
		* or an ongoing thread while keeping the primary thread focused).
		*
		* These strings are model-facing contracts: change them only with intent, and
		* keep tests asserting the exact sentences that carry the behavioral rules.
		*/
		/**
		* The boundary message delivered as the side conversation's first user
		* message: everything the fork inherited from the parent session is reference
		* context only, never active instruction.
		*/
		const SIDE_BOUNDARY_PROMPT = `Side conversation boundary.

Everything before this boundary is inherited history from the parent session. It is reference context only. It is not your current task.

Do not continue, execute, or complete any instructions, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation.`;
		/**
		* The mode declaration carried INSIDE the boundary message (after its first
		* sentence, so the message still opens with `Side conversation boundary` and
		* the panel's boundary-row drop keeps working): the child's own identity
		* line, so the forked model can never mistake which command created it
		* (`/side` continuable thread vs `/btw` one-shot question).
		*/
		const SIDE_MODE_LINE = {
			side: "Mode: this is a /side side conversation — a continuable thread. Your answers stay in this side thread and are viewed in the sidechain panel; they are never delivered into the main session.",
			btw: "Mode: this is a /btw one-shot side question. Answer once, in this side thread; the answer is viewed in the sidechain panel, not in the main session."
		};
		//#endregion
		//#region src/client/boundary-text.tsx
		const boundaryTextRule = {
			id: "sidechain-boundary",
			order: -20,
			match(text, from) {
				if (from !== 0 || !text.startsWith(SIDE_BOUNDARY_PROMPT + "\n\n")) return void 0;
				for (const mode of ["side", "btw"]) {
					const marker = "\n\n" + SIDE_MODE_LINE[mode] + "\n\n";
					const index = text.indexOf(marker, SIDE_BOUNDARY_PROMPT.length);
					if (index >= 0) return {
						id: "sidechain-boundary",
						start: 0,
						end: index + marker.length,
						data: { mode }
					};
				}
			}
		};
		function SidechainBoundary({ node, raw, sessionId, useSession, useSessions, t }) {
			const parentId = useSession((session) => session.subagent?.address.parentSessionId);
			const mode = useSessions((state) => parentId === void 0 ? void 0 : state.projectionsBySession[parentId]?.values.sidechainModes?.[sessionId]);
			const [expanded, setExpanded] = (0, react.useState)(false);
			if (mode !== node.data.mode) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: raw });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				"data-sidechain-boundary": "",
				style: {
					display: "block",
					marginBottom: 8
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					"aria-expanded": expanded,
					onClick: () => setExpanded((value) => !value),
					children: t("view.instructions")
				}), expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						display: "block",
						whiteSpace: "pre-wrap",
						opacity: .7
					},
					children: raw
				})]
			});
		}
		//#endregion
		//#region src/client/command-menu.tsx
		function localizeCommandMenu(state, t) {
			if (!state.open) return state;
			return {
				...state,
				groups: state.groups.map((group) => group.source !== "command" ? group : {
					...group,
					items: group.items.map((item) => item.name !== "side" && item.name !== "btw" ? item : {
						...item,
						label: t(`command.${item.name}.label`),
						description: t(`command.${item.name}.description`),
						icon: item.name === "side" ? _deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular : _deepseek_ai_dsh_client_ui_primitives.IconQuestionOutlineRegular
					})
				})
			};
		}
		function installCommandMenu(ctx) {
			const t = ctx.locale.bind(NS);
			return ctx.slots.inject("conversation.input.overlay", () => {
				let native;
				let wrapper;
				let dispose;
				const sync = () => {
					const next = ctx.slots.entries("conversation.input.overlay").find((entry) => entry.options.id === "slash-menu" && entry.component !== wrapper);
					if (next === native) return;
					native = next;
					dispose?.();
					dispose = void 0;
					if (native === void 0) return;
					const NativeMenu = native.component;
					wrapper = function SidechainCommandMenu(props) {
						const snapshot = (0, react.useSyncExternalStore)((listener) => props.menu.subscribe(listener), () => props.menu.getSnapshot(), () => props.menu.getSnapshot());
						const locale = (0, react.useSyncExternalStore)((listener) => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot());
						const localized = (0, react.useMemo)(() => localizeCommandMenu(snapshot, t), [snapshot, locale]);
						const menu = (0, react.useMemo)(() => ({
							...props.menu,
							getSnapshot: () => localized
						}), [props.menu, localized]);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NativeMenu, {
							...props,
							menu
						});
					};
					dispose = ctx.slots.register({
						...native.options,
						name: "conversation.input.overlay",
						id: "slash-menu",
						priority: (native.options.priority ?? 0) - 1,
						locale: "slash.menu",
						inject: native.inject
					}, wrapper);
				};
				sync();
				const unsubscribe = ctx.slots.subscribe("conversation.input.overlay", sync);
				return () => {
					unsubscribe();
					dispose?.();
				};
			});
		}
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-sidechain";
		const inject = [
			"slots",
			"sessions",
			"locale",
			"sidebarRight",
			"uiConversation"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-sidechain: dictionaries");
			installCommandMenu(ctx);
			ctx.uiConversation.userText.register(boundaryTextRule);
			ctx.slots.inject("conversation.user.text.node", () => ctx.slots.register({
				name: "conversation.user.text.node",
				key: "sidechain-boundary",
				locale: NS
			}, SidechainBoundary));
			const childActions = (parentId) => ({ openChild(childId) {
				if (ctx.sidebarRight.mounted.getSnapshot() !== parentId) return;
				ctx.sidebarRight.openResource(nativeChildAddress(parentId, childId), { kind: "subagentchat" });
			} });
			for (const key of ["side", "btw"]) ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
				name: "conversation.chat.commandview",
				key,
				locale: NS,
				inject: childActions
			}, SideCommandCard));
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "sidechain-native-observer",
				order: 30,
				inject: childActions
			}, NativeChildObserver));
			ctx.slots.inject("conversation.composer", () => {
				const refresh = (parentId) => ctx.sessions.refreshProjections(parentId);
				let dispose;
				let previous;
				const sync = () => {
					const projections = ctx.sessions.list.getSnapshot().projectionsBySession;
					const modes = new Map(Object.entries(projections).flatMap(([parentId, projection]) => projection.values.sidechainModes === void 0 ? [] : [[parentId, projection.values.sidechainModes]]));
					if (previous?.size === modes.size && [...modes].every(([parentId, value]) => previous?.get(parentId) === value)) return;
					previous = modes;
					dispose?.();
					dispose = ctx.slots.register({
						name: "conversation.composer",
						priority: -5,
						locale: NS,
						select(owner) {
							const address = owner.session?.subagent?.address;
							if (address === void 0 || address.mode !== "continuable" || owner.pendingInteraction !== void 0) return null;
							const reason = sidechainComposerReason(modes.get(address.parentSessionId), address.childSessionId);
							return reason === null ? null : {
								parentId: address.parentSessionId,
								reason
							};
						},
						inject: (sessionId) => ({
							refresh,
							async stop() {
								if (sessionId === void 0) return false;
								return (await ctx.sessions.binding(sessionId)?.session.cancel())?.ok === true;
							}
						})
					}, SidechainReadOnly);
				};
				sync();
				const unsubscribe = ctx.sessions.list.subscribe(sync);
				return () => {
					unsubscribe();
					dispose?.();
				};
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
