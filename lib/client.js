window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-sidechain",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
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
		/** The command card is presentation only; the panel host owns live discovery. */
		function SideCommandCard({ node }) {
			const kind = node.name === "btw" ? "btw" : "side";
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
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
					style: {
						whiteSpace: "nowrap",
						display: "block",
						marginBottom: "2px"
					},
					children: ["/", node.name ?? kind]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: { overflowX: "auto" },
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
						text: label,
						streaming: false,
						labels: MARKDOWN_LABELS
					})
				})]
			});
		}
		//#endregion
		//#region src/client/panel-state.ts
		let open = false;
		let selected;
		let selectedMode;
		const listeners = /* @__PURE__ */ new Set();
		function emit() {
			for (const listener of [...listeners]) listener();
		}
		/** Whether the sidechain panel is currently open. */
		function isSidechainPanelOpen() {
			return open;
		}
		/** The child currently selected for the embedded transcript view, if any. */
		function selectedChildId() {
			return selected;
		}
		/** The mode of the currently selected child, when known from its command. */
		function selectedChildMode() {
			return selectedMode;
		}
		/** Open the panel (no-op when already open). */
		function openSidechainPanel() {
			if (open) return;
			open = true;
			emit();
		}
		/** Close the panel (no-op when already closed). */
		function closeSidechainPanel() {
			if (!open && selected === void 0) return;
			open = false;
			selected = void 0;
			selectedMode = void 0;
			emit();
		}
		/** Flip the panel between open and closed (closing also clears the selection). */
		function toggleSidechainPanel() {
			if (open) closeSidechainPanel();
			else openSidechainPanel();
		}
		/**
		* Reveal the panel with one child selected for the embedded transcript view.
		* @param childSessionId - the child to show; undefined returns to the list.
		*/
		function revealChild(childSessionId, mode) {
			open = true;
			if (selected === childSessionId && (mode === void 0 || selectedMode === mode)) return;
			selected = childSessionId;
			selectedMode = mode;
			emit();
		}
		/** Select a child (or clear the selection) without changing the panel state. */
		function selectChild(childSessionId) {
			if (selected === childSessionId) return;
			selected = childSessionId;
			selectedMode = void 0;
			emit();
		}
		/**
		* Subscribe to visibility/selection transitions.
		* @param listener - called on every change.
		* @returns the disposer removing the subscription.
		*/
		function subscribeSidechainPanel(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		/** localStorage key for the user's last dragged width. */
		const WIDTH_STORAGE_KEY = "dsh.sidechain.width";
		/**
		* Ceiling for a dragged panel width: 55% of the viewport, never beyond the
		* hard cap — the panel must never cover the whole conversation.
		* @param viewportWidth - current `window.innerWidth`.
		* @returns the maximum allowed panel width in px.
		*/
		function panelMaxWidth(viewportWidth) {
			return Math.min(720, Math.floor(viewportWidth * .55));
		}
		/**
		* Clamp a candidate panel width into the allowed band.
		* @param width - raw candidate (drag arithmetic can overshoot).
		* @param viewportWidth - current viewport width.
		* @returns the clamped width, at least {@link PANEL_MIN_WIDTH}.
		*/
		function clampPanelWidth(width, viewportWidth) {
			return Math.min(Math.max(Math.floor(width), 320), panelMaxWidth(viewportWidth));
		}
		/**
		* Read the persisted panel width. Storage is best-effort: an absent or
		* malformed value (or no localStorage at all) falls back to undefined.
		* @returns the stored width when it survives the structural check, else undefined.
		*/
		function readPanelWidth() {
			try {
				const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
				if (raw === null) return void 0;
				const value = Number.parseInt(raw, 10);
				if (!Number.isFinite(value) || value < 320) return void 0;
				return value;
			} catch {
				return;
			}
		}
		/**
		* Persist a panel width (best-effort — storage failures are silent, the
		* panel still works at the in-memory width).
		* @param width - the width to store.
		*/
		function writePanelWidth(width) {
			try {
				localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.floor(width)));
			} catch {}
		}
		//#endregion
		//#region src/client/child-activity.ts
		/**
		* Resolve a child's live activity without treating missing data as running.
		*
		* Precedence:
		* 1. A session summary running bit is the most reliable signal (the host
		*    pushes it on session frames). When present, it is authoritative.
		* 2. Otherwise the catalog entry's activity is used.
		* 3. A catalog that finished loading and is missing the child means the
		*    child is no longer in the parent's membership feed: `inactive`.
		* 4. Anything else (catalog not fetched, loading, or errored) is `unknown`.
		*
		* The `unknown` state must never drive a poll loop or a waiting hint; both
		* conditions require an explicit `running`.
		*
		* @param input - the available activity signals.
		* @returns the resolved activity.
		*/
		function resolveChildActivity(input) {
			if (input.summaryRunning !== void 0) return input.summaryRunning ? "running" : "inactive";
			if (input.catalogActivity !== void 0) return input.catalogActivity;
			if (input.catalogState === "ready") return "inactive";
			return "unknown";
		}
		//#endregion
		//#region src/client/sidechain-file-mentions.ts
		/** The trailing path segment (handles both separators). */
		function basenameOf(path) {
			const parts = path.split(/[/\\]/);
			return parts[parts.length - 1] ?? path;
		}
		/**
		* Resolve a workspace-relative path into the Host-facing absolute spelling,
		* mirroring the runtime's `resolveWorkspacePath` (kept local so this module
		* stays value-import-free and node-testable): absolute and Windows-style
		* paths pass through; relative paths join onto the session cwd.
		*/
		function resolveAgainstCwd(cwd, path) {
			if (path.startsWith("/") || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\")) return path;
			if (cwd === void 0 || cwd === "") return path;
			return `${cwd.replace(/[/\\]+$/, "")}/${path.replace(/^[/\\]+/, "")}`;
		}
		/** The single produced path whose basename is exactly `value`, else undefined. */
		function onlyPathWithBasename(paths, value) {
			const matches = paths.filter((path) => basenameOf(path) === value);
			return matches.length === 1 ? matches[0] : void 0;
		}
		/**
		* Build a transcript-scoped file-mention resolver.
		*
		* Produced locations are absolute; model prose usually names the file
		* relative to the session cwd (or just its basename). A token matches when
		* it equals a produced path exactly, equals the produced path relative to
		* the cwd, or equals the basename of exactly one produced path.
		* @param produced - produced file paths (first-seen order, unique).
		* @param cwd - the child session's workspace root (match + path base).
		* @param openPath - host opener for absolute paths.
		* @returns the resolver.
		*/
		function fileMentionsFor(produced, cwd, openPath) {
			const byAbsolute = new Set(produced);
			const byCwdRelative = new Set(produced.map((path) => relativeTo(cwd, path)).filter((path) => path !== void 0));
			return { resolve(value) {
				const path = byAbsolute.has(value) ? value : byCwdRelative.has(value) ? value : onlyPathWithBasename(produced, value);
				if (path === void 0) return void 0;
				const target = resolveAgainstCwd(cwd, path);
				if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(target)) return void 0;
				return {
					open: () => {
						openPath(target);
					},
					label: basenameOf(path),
					title: target
				};
			} };
		}
		/** The produced path spelled relative to the cwd, when it lives under it. */
		function relativeTo(cwd, path) {
			if (cwd === void 0 || cwd === "") return void 0;
			const base = cwd.replace(/[/\\]+$/, "") + "/";
			if (!path.startsWith(base)) return void 0;
			return path.slice(base.length);
		}
		//#endregion
		//#region src/client/sidechain-activity.ts
		/** Read one activity round and publish successful non-empty lines after containing sibling failures. */
		async function readActivityRound(rows, read, publish) {
			await Promise.allSettled(rows.map(async (row) => {
				const line = await read(row);
				if (line !== null) publish(row, line);
			}));
		}
		/** Argument fields that summarize each known tool best (first-wins priority). */
		const TOOL_ARG_FIELDS = {
			bash: "command",
			terminal: "command",
			grep: "pattern",
			glob: "pattern",
			read: "path",
			str_replace_editor: "command",
			edit: "file_path",
			subagent: "description"
		};
		/** Maximum code points kept in one salient argument preview. */
		const TOOL_ARG_MAX = 60;
		/** Maximum code points kept in one assistant-text activity line. */
		const ACTIVITY_TEXT_MAX = 140;
		/** Collapse whitespace to single spaces and cap the code-point length. */
		function collapse(text, max) {
			const normalized = text.trim().replace(/\s+/g, " ");
			const chars = [...normalized];
			if (chars.length <= max) return normalized;
			return chars.slice(0, max).join("") + "…";
		}
		/**
		* The single most informative argument of one tool call: a per-tool field
		* priority (bash → command, grep → pattern, …), falling back to the first
		* field of the parsed arguments, then to the raw string. The panel never
		* dumps full arguments into a one-line row preview.
		* @param name - tool name.
		* @param argumentsRaw - raw JSON arguments from the tool call.
		* @returns the collapsed preview, or undefined when there are no arguments.
		*/
		function salientToolArg(name, argumentsRaw) {
			if (argumentsRaw === void 0) return void 0;
			let value;
			try {
				value = JSON.parse(argumentsRaw);
			} catch {
				return collapse(argumentsRaw, TOOL_ARG_MAX);
			}
			if (value === null || typeof value !== "object") return collapse(String(value), TOOL_ARG_MAX);
			const record = value;
			const pick = TOOL_ARG_FIELDS[name];
			let chosen;
			if (pick !== void 0 && record[pick] !== void 0) chosen = record[pick];
			else for (const key of Object.keys(record)) {
				chosen = record[key];
				break;
			}
			if (chosen === void 0) return void 0;
			return collapse(typeof chosen === "string" ? chosen : JSON.stringify(chosen), TOOL_ARG_MAX);
		}
		/**
		* One live activity line for a running child: the latest assistant text when
		* present, else the last (non-failed) tool call summary. Failed calls never
		* speak for the child.
		* @param rows - the child's compact transcript rows (tail window).
		* @returns the line text, or undefined when the window carries nothing.
		*/
		function lastActivity(rows) {
			let text;
			let tool;
			for (let i = rows.length - 1; i >= 0; i--) {
				const row = rows[i];
				if (row === void 0) continue;
				if (text === void 0 && row.kind === "assistant") {
					const collapsed = collapse(row.text, ACTIVITY_TEXT_MAX);
					if (collapsed !== "") text = collapsed;
				} else if (tool === void 0 && row.kind === "tool" && !row.failed) {
					const args = salientToolArg(row.name, row.detail?.arguments);
					tool = `🔧 ${row.name}${args !== void 0 ? ` · ${args}` : ""}`;
				}
				if (text !== void 0 && tool !== void 0) break;
			}
			return text ?? tool;
		}
		//#endregion
		//#region node_modules/.pnpm/@deepseek-ai+dsh-util-values@0.2.1-rc.2_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-util-values/lib/index.js
		/**
		* Lazily scanned view of one JSON object's top-level fields, built from text
		* that may still be streaming or from an already parsed object. Nothing is
		* scanned until a reader asks; the view remembers every question it answered
		* and reports changed answers when the owner refreshes for publication.
		* Used for model tool-call arguments: a row reads the fields it
		* cares about at whatever granularity it displays, at every stage of the call.
		* @module @deepseek-ai/dsh-util-values/src/partial-json
		*/
		const SIMPLE_ESCAPES = {
			"\"": "\"",
			"\\": "\\",
			"/": "/",
			b: "\b",
			f: "\f",
			n: "\n",
			r: "\r",
			t: "	"
		};
		const CONTENT_ESCAPE = /[\\\u0000-\u001f]/u;
		function isWhitespace(c) {
			return c === " " || c === "\n" || c === "\r" || c === "	";
		}
		function isHex(c) {
			return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
		}
		(class PartialArguments {
			/** The view of a call with no arguments available. */
			static EMPTY = PartialArguments.fromObject({});
			/**
			* View finished argument text without scanning it until a reader asks.
			* @param text - the complete argument JSON text.
			* @returns a sealed view.
			*/
			static fromText(text) {
				const view = new PartialArguments();
				view.append(text);
				view.sealed = true;
				return view;
			}
			/**
			* View an already parsed argument payload, such as a PTC dispatch object.
			* @param value - the parsed argument value.
			* @returns a sealed view; a non-object payload has no fields.
			*/
			static fromObject(value) {
				const view = new PartialArguments();
				view.object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
				view.sealed = true;
				return view;
			}
			/**
			* The source: text so far or a parsed object, plus whether it can still grow.
			* These are the only enumerable fields, so two views over the same source
			* compare equal structurally however far each has been read.
			*/
			chunks = [];
			object;
			sealed = false;
			#ends = [];
			#size = 0;
			#consumed = 0;
			#mode = "root";
			#escape = false;
			#keyStart = 0;
			#keyEscaped = false;
			#key = "";
			#current = null;
			#nestedEnds = [];
			#nestedInString = false;
			#invalidAt;
			#invalidValue = false;
			#entries = /* @__PURE__ */ new Map();
			#order = [];
			#reads = /* @__PURE__ */ new Map();
			/** Whether this view rejects further appends; does not scan text or register reads. */
			get isSealed() {
				return this.sealed;
			}
			/** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
			get invalid() {
				this.scan();
				return this.#mode === "invalid" || this.#invalidValue;
			}
			/**
			* Retain streamed argument text without scanning or comparing observed answers.
			* @param fragment - the text following every fragment appended before.
			*/
			append(fragment) {
				if (this.sealed) throw new Error("PartialArguments: cannot append to a sealed view");
				if (fragment.length === 0) return;
				this.chunks.push(fragment);
				this.#size += fragment.length;
				this.#ends.push(this.#size);
			}
			/**
			* Reconcile a streamed prefix with authoritative complete text without joining the fragments.
			* @param text - the final argument text, which replaces missing or conflicting deltas.
			* @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
			*/
			settle(text) {
				if (this.object !== void 0 || text.length !== this.#size) return PartialArguments.fromText(text);
				let offset = 0;
				for (const chunk of this.chunks) {
					if (!text.startsWith(chunk, offset)) return PartialArguments.fromText(text);
					offset += chunk.length;
				}
				this.chunks = text.length === 0 ? [] : [text];
				this.#ends = text.length === 0 ? [] : [text.length];
				this.sealed = true;
				return this;
			}
			/**
			* Compare observed answers and advance their publication baseline. Unread views remain unscanned.
			* @returns whether any observed answer changed since its first read or the preceding refresh.
			*/
			refresh() {
				if (this.#reads.size === 0) return false;
				this.scan();
				let changed = false;
				let completions = false;
				for (const read of this.#reads.values()) {
					if (read.completion) {
						completions = true;
						continue;
					}
					changed = this.refreshRead(read) || changed;
				}
				if (completions) {
					for (const read of this.#reads.values()) if (read.completion) changed = this.refreshRead(read) || changed;
				}
				if (this.sealed) this.#reads.clear();
				return changed;
			}
			refreshRead(read) {
				const now = read.answer();
				if (Object.is(now, read.last)) return false;
				read.last = now;
				return true;
			}
			/**
			* Check whether no further fields can arrive.
			* @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
			*/
			closed() {
				return this.remember("closed", "", () => this.closedNow());
			}
			/**
			* List discovered fields in first-appearance order.
			* @returns top-level keys seen so far, in first-appearance order.
			*/
			keys() {
				return this.remember("keys", "", () => this.keysNow(), (keys) => keys.length);
			}
			/**
			* Check whether a top-level field has appeared.
			* @param key - argument name.
			* @returns whether the field has appeared (a string opened or another value began).
			*/
			has(key) {
				return this.remember("has", key, () => this.hasNow(key));
			}
			/**
			* Check whether a field's closing delimiter has arrived, without validating its contents.
			* @param key - argument name.
			* @returns whether its delimiter arrived and no content reader has reported an error for this value.
			*/
			complete(key) {
				return this.remember("complete", key, () => this.completeNow(key));
			}
			/**
			* Read string length without materializing its text.
			* @param key - argument name.
			* @param options - change granularity for a streaming string.
			* @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
			*/
			stringLength(key, options) {
				const step = Math.max(1, Math.floor(options?.step ?? 1));
				const offset = options?.offset ?? 0;
				return this.remember(`length:${step}:${offset}`, key, () => this.lengthNow(key), (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step));
			}
			/**
			* Check a string against a decoded UTF-16 length limit without materializing it.
			* @param key - argument name.
			* @param maxLength - decoded UTF-16 limit, floored to at least zero.
			* @returns whether the string is longer than the limit; false when absent or not a string.
			*/
			stringExceeds(key, maxLength) {
				const limit = Math.max(0, Math.floor(maxLength));
				return this.remember(`exceeds:${limit}`, key, () => (this.lengthNow(key, limit + 1) ?? 0) > limit);
			}
			/**
			* Read a decoded string, including a streaming prefix.
			* @param key - argument name.
			* @returns the string field's decoded text so far; undefined when absent or not a string.
			*/
			text(key) {
				return this.remember("text", key, () => this.textNow(key));
			}
			/**
			* Read at most the first decoded UTF-16 units of a string.
			* @param key - argument name.
			* @param maxLength - maximum decoded UTF-16 length, floored to at least one.
			* @returns the bounded string prefix; undefined when absent or not a string.
			*/
			textPrefix(key, maxLength) {
				const limit = Math.max(1, Math.floor(maxLength));
				return this.remember(`prefix:${limit}`, key, () => this.textPrefixNow(key, limit));
			}
			/**
			* Read a completed non-string argument.
			* @param key - argument name.
			* @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
			*/
			value(key) {
				return this.remember("value", key, () => this.valueNow(key));
			}
			/** Answer a question and, on a streaming view, remember it for change detection. */
			remember(kind, key, read, comparison) {
				this.scan();
				const result = read();
				if (!this.sealed) {
					const id = `${kind}/${key}`;
					if (!this.#reads.has(id)) this.#reads.set(id, {
						completion: kind === "complete",
						answer: comparison === void 0 ? read : () => comparison(read()),
						last: comparison === void 0 ? result : comparison(result)
					});
				}
				return result;
			}
			closedNow() {
				return this.sealed || this.#mode === "closed" || this.#mode === "invalid";
			}
			keysNow() {
				return this.object === void 0 ? this.#order : Object.keys(this.object);
			}
			hasNow(key) {
				return this.object === void 0 ? this.#entries.has(key) : Object.hasOwn(this.object, key);
			}
			completeNow(key) {
				if (this.object !== void 0) return Object.hasOwn(this.object, key);
				const entry = this.#entries.get(key);
				return entry !== void 0 && entry.end >= 0 && (entry.kind === "string" ? entry.invalidAt === void 0 : !entry.invalid);
			}
			lengthNow(key, limit = Number.POSITIVE_INFINITY) {
				if (this.object !== void 0) {
					const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
					return typeof field === "string" ? field.length : void 0;
				}
				const entry = this.#entries.get(key);
				if (entry?.kind !== "string") return void 0;
				if (entry.text !== void 0 && entry.text.at === entry.end) return entry.text.length;
				const read = entry.length ??= {
					at: entry.start,
					length: 0,
					text: ""
				};
				this.readString(entry, read, limit, false);
				return read.length;
			}
			textNow(key) {
				if (this.object !== void 0) {
					const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
					return typeof field === "string" ? field : void 0;
				}
				const entry = this.#entries.get(key);
				if (entry?.kind !== "string") return void 0;
				if (entry.text === void 0 && entry.end >= 0 && entry.needsDecoding && entry.invalidAt === void 0) {
					let text;
					try {
						text = JSON.parse(`"${this.slice(entry.start, entry.end)}"`);
					} catch (_error) {}
					if (text !== void 0) entry.text = {
						at: entry.end,
						length: text.length,
						text
					};
				}
				const read = entry.text ??= {
					at: entry.start,
					length: 0,
					text: ""
				};
				this.readString(entry, read, Number.POSITIVE_INFINITY, true);
				return read.text;
			}
			textPrefixNow(key, maxLength) {
				if (this.object !== void 0) {
					const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
					return typeof field === "string" ? field.slice(0, maxLength) : void 0;
				}
				const entry = this.#entries.get(key);
				if (entry?.kind !== "string") return void 0;
				const prefixes = entry.prefixes ??= /* @__PURE__ */ new Map();
				let read = prefixes.get(maxLength);
				if (read === void 0) {
					read = {
						at: entry.start,
						length: 0,
						text: ""
					};
					prefixes.set(maxLength, read);
				}
				this.readString(entry, read, maxLength, true);
				return read.text;
			}
			valueNow(key) {
				if (this.object !== void 0) {
					if (!Object.hasOwn(this.object, key)) return void 0;
					const field = this.object[key];
					return typeof field === "string" ? void 0 : field;
				}
				const entry = this.#entries.get(key);
				if (entry?.kind !== "value" || entry.end < 0 || entry.invalid) return void 0;
				if (entry.parsed === void 0) try {
					entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
				} catch (_error) {
					entry.invalid = true;
					this.#invalidValue = true;
				}
				return entry.parsed;
			}
			chunkAt(at) {
				let low = 0;
				let high = this.#ends.length;
				while (low < high) {
					const mid = low + high >>> 1;
					if (this.#ends[mid] <= at) low = mid + 1;
					else high = mid;
				}
				return low;
			}
			/** Materialize only a requested range, never the cumulative source. */
			slice(start, end) {
				if (start >= end) return "";
				const first = this.chunkAt(start);
				const last = this.chunkAt(end - 1);
				const base = first === 0 ? 0 : this.#ends[first - 1];
				if (first === last) return this.chunks[first].slice(start - base, end - base);
				const parts = [this.chunks[first].slice(start - base)];
				for (let i = first + 1; i < last; i++) parts.push(this.chunks[i]);
				parts.push(this.chunks[last].slice(0, end - this.#ends[last - 1]));
				return parts.join("");
			}
			readString(entry, read, limit, materialize) {
				const end = Math.min(entry.end < 0 ? this.#consumed : entry.end, entry.invalidAt ?? Number.POSITIVE_INFINITY, this.#invalidAt ?? Number.POSITIVE_INFINITY);
				if (!entry.needsDecoding) {
					const length = Math.min(end - read.at, limit - read.length);
					if (length <= 0) return;
					if (materialize) read.text += this.slice(read.at, read.at + length);
					read.at += length;
					read.length += length;
					return;
				}
				let chunkIndex = this.chunkAt(read.at);
				while (read.at < end && read.length < limit) {
					const base = chunkIndex === 0 ? 0 : this.#ends[chunkIndex - 1];
					const chunk = this.chunks[chunkIndex];
					const remaining = chunk.slice(read.at - base, Math.min(chunk.length, end - base));
					const boundary = remaining.search(CONTENT_ESCAPE);
					const length = Math.min(boundary < 0 ? remaining.length : boundary, limit - read.length);
					if (length > 0) {
						if (materialize) read.text += remaining.slice(0, length);
						read.at += length;
						read.length += length;
						if (read.at === base + chunk.length) chunkIndex++;
						continue;
					}
					const type = remaining.length > 1 ? remaining[1] : read.at + 1 < end ? this.chunks[chunkIndex + 1][0] : void 0;
					let decoded;
					let width = 2;
					if (remaining[0] === "\\" && type === void 0 && entry.end < 0) return;
					if (remaining[0] === "\\" && type === "u") {
						const hex = this.slice(read.at + 2, Math.min(end, read.at + 6));
						let valid = true;
						for (let i = 0; i < hex.length; i++) if (!isHex(hex[i])) valid = false;
						if (valid) {
							if (hex.length < 4 && entry.end < 0) return;
							if (hex.length === 4) decoded = String.fromCharCode(Number.parseInt(hex, 16));
						}
						width = 6;
					} else if (remaining[0] === "\\" && type !== void 0) decoded = SIMPLE_ESCAPES[type];
					if (decoded === void 0) {
						entry.invalidAt = read.at;
						this.#invalidValue = true;
						return;
					}
					if (materialize) read.text += decoded;
					read.length++;
					read.at += width;
					while (chunkIndex < this.chunks.length && read.at >= this.#ends[chunkIndex]) chunkIndex++;
				}
			}
			/** Locate new field ranges without decoding or parsing their contents. */
			scan() {
				if (this.object !== void 0 || this.#consumed === this.#size) return;
				for (let i = this.chunkAt(this.#consumed); i < this.chunks.length && this.#invalidAt === void 0; i++) {
					const pending = this.chunks[i];
					const base = i === 0 ? 0 : this.#ends[i - 1];
					for (let index = this.#consumed - base; index < pending.length && this.#mode !== "invalid"; index++) {
						if (this.#mode === "string" || this.#mode === "nested" && this.#nestedInString) {
							const end = this.stringBoundary(pending, index);
							this.#consumed += end - index;
							index = end;
							if (index === pending.length) break;
						}
						this.step(pending[index], this.#consumed);
						this.#consumed++;
					}
				}
			}
			/** Only raw quotes and their preceding backslash runs can terminate a string. */
			stringBoundary(fragment, start) {
				let at = start;
				while (true) {
					const quote = fragment.indexOf("\"", at);
					const end = quote < 0 ? fragment.length : quote;
					if (this.#mode === "string") {
						const entry = this.#current;
						if (!entry.needsDecoding && CONTENT_ESCAPE.test(fragment.slice(at, end))) entry.needsDecoding = true;
					}
					let slashStart = end;
					while (slashStart > at && fragment[slashStart - 1] === "\\") slashStart--;
					const escaped = (end - slashStart) % 2 === 1 !== (slashStart === at && this.#escape);
					this.#escape = quote < 0 && escaped;
					if (quote < 0 || !escaped) return end;
					at = quote + 1;
				}
			}
			step(c, at) {
				switch (this.#mode) {
					case "root":
						if (isWhitespace(c)) return;
						if (c === "{") {
							this.#mode = "key-or-end";
							return;
						}
						this.fail();
						return;
					case "key-or-end":
						if (isWhitespace(c)) return;
						if (c === "}") {
							this.#mode = "closed";
							return;
						}
						if (c === "\"") {
							this.beginKey(at);
							return;
						}
						this.fail();
						return;
					case "key-only":
						if (isWhitespace(c)) return;
						if (c === "\"") {
							this.beginKey(at);
							return;
						}
						this.fail();
						return;
					case "key":
						this.stepKey(c, at);
						return;
					case "colon":
						if (isWhitespace(c)) return;
						if (c === ":") {
							this.#mode = "value";
							return;
						}
						this.fail();
						return;
					case "value":
						this.beginValue(c, at);
						return;
					case "string": {
						const entry = this.#current;
						entry.end = at;
						this.#current = null;
						this.#mode = "comma-or-end";
						return;
					}
					case "scalar":
						this.stepScalar(c, at);
						return;
					case "nested":
						this.stepNested(c, at);
						return;
					case "comma-or-end":
						if (isWhitespace(c)) return;
						if (c === ",") {
							this.#mode = "key-only";
							return;
						}
						if (c === "}") {
							this.#mode = "closed";
							return;
						}
						this.fail();
						return;
					case "closed":
						if (isWhitespace(c)) return;
						this.fail();
						return;
					/* v8 ignore next 2 -- scan() stops stepping once the view is invalid. */
					case "invalid": return;
					/* v8 ignore next 2 -- Every scanner mode has a handler above. */
					default: assertNever(this.#mode);
				}
			}
			fail() {
				this.#invalidAt = this.#consumed;
				this.#mode = "invalid";
				this.#current = null;
			}
			beginKey(at) {
				this.#mode = "key";
				this.#keyStart = at + 1;
				this.#keyEscaped = false;
				this.#escape = false;
			}
			stepKey(c, at) {
				if (c < " ") {
					this.fail();
					return;
				}
				if (this.#escape) {
					this.#escape = false;
					return;
				}
				if (c === "\\") {
					this.#escape = true;
					this.#keyEscaped = true;
					return;
				}
				if (c !== "\"") return;
				const raw = this.slice(this.#keyStart, at);
				if (this.#keyEscaped) try {
					this.#key = JSON.parse(`"${raw}"`);
				} catch (_error) {
					this.fail();
					return;
				}
				else this.#key = raw;
				this.#mode = "colon";
			}
			open(entry) {
				if (!this.#entries.has(this.#key)) this.#order.push(this.#key);
				this.#entries.set(this.#key, entry);
				this.#current = entry;
			}
			beginValue(c, at) {
				if (isWhitespace(c)) return;
				if (c === "\"") {
					this.open({
						kind: "string",
						start: at + 1,
						end: -1,
						needsDecoding: false,
						invalidAt: void 0,
						length: void 0,
						text: void 0,
						prefixes: void 0
					});
					this.#escape = false;
					this.#mode = "string";
					return;
				}
				if (c === "}" || c === "," || c === ":" || c === "]") {
					this.fail();
					return;
				}
				this.open({
					kind: "value",
					start: at,
					end: -1,
					parsed: void 0,
					invalid: false
				});
				if (c === "{" || c === "[") {
					this.#mode = "nested";
					this.#nestedEnds = [c === "{" ? "}" : "]"];
					this.#nestedInString = false;
					this.#escape = false;
					return;
				}
				this.#mode = "scalar";
			}
			stepScalar(c, at) {
				if (c !== "," && c !== "}" && !isWhitespace(c)) return;
				this.closeValue(at);
				this.#mode = c === "," ? "key-only" : c === "}" ? "closed" : "comma-or-end";
			}
			stepNested(c, at) {
				if (this.#nestedInString) {
					this.#nestedInString = false;
					return;
				}
				if (c === "\"") {
					this.#nestedInString = true;
					return;
				}
				if (c === "{" || c === "[") {
					this.#nestedEnds.push(c === "{" ? "}" : "]");
					return;
				}
				if (c === "}" || c === "]") {
					if (this.#nestedEnds.pop() !== c) {
						this.fail();
						return;
					}
					if (this.#nestedEnds.length === 0) {
						this.closeValue(at + 1);
						this.#mode = "comma-or-end";
					}
				}
			}
			closeValue(end) {
				const entry = this.#current;
				entry.end = end;
				this.#current = null;
			}
		});
		/** Duplicate-install-safe JSON and immutable-value helpers. @module @deepseek-ai/dsh-util-values */
		/**
		* Mark an unreachable closed-union branch.
		* @param value - impossible value; an unhandled typed variant fails at the call site.
		* @param context - optional switch-site label included in the failure message.
		* @returns never; a runtime value that escaped its type always throws.
		*/
		function assertNever(value, context) {
			const rendered = JSON.stringify(value) ?? String(value);
			throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
		}
		/** Whether a realm-owned intrinsic prototype has a native constructor matching this engine's representation. */
		function hasIntrinsicConstructor(prototype, name) {
			const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
			if (typeof constructor !== "function") return false;
			try {
				return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name === "Array" ? Array : Object);
			} catch {
				return false;
			}
		}
		/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
		function isIntrinsicObjectPrototype(value) {
			return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
		}
		/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
		function hasPlainArrayPrototype(value) {
			const prototype = Object.getPrototypeOf(value);
			if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
			const objectPrototype = Object.getPrototypeOf(prototype);
			return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
		}
		/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
		function hasPlainObjectPrototype(value) {
			const prototype = Object.getPrototypeOf(value);
			return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
		}
		/** Return every JSON-visible object key, or reject own data JSON would discard. */
		function enumerableStringKeys(value) {
			const keys = Reflect.ownKeys(value);
			if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
			return keys;
		}
		/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */
		function walkJsonValue(value, detach) {
			const ancestors = /* @__PURE__ */ new Set();
			let root;
			const assign = (destination, item) => {
				if (destination === void 0) return;
				if (destination.kind === "root") root = item;
				else if (destination.kind === "array") destination.target[destination.index] = item;
				else Object.defineProperty(destination.target, destination.key, {
					value: item,
					enumerable: true,
					configurable: true,
					writable: true
				});
			};
			const tasks = [{
				kind: "visit",
				value,
				...detach ? { destination: { kind: "root" } } : {}
			}];
			for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
				if (task.kind === "leave") {
					ancestors.delete(task.source);
					continue;
				}
				if (task.kind === "array-item") {
					if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;
					tasks.push({
						kind: "visit",
						value: task.source[task.index],
						...task.target === void 0 ? {} : { destination: {
							kind: "array",
							target: task.target,
							index: task.index
						} }
					});
					continue;
				}
				if (task.kind === "object-property") {
					tasks.push({
						kind: "visit",
						value: task.source[task.key],
						...task.target === void 0 ? {} : { destination: {
							kind: "object",
							target: task.target,
							key: task.key
						} }
					});
					continue;
				}
				const current = task.value;
				if (current === null) {
					assign(task.destination, null);
					continue;
				}
				if (typeof current === "boolean" || typeof current === "string") {
					assign(task.destination, current);
					continue;
				}
				if (typeof current === "number") {
					if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;
					assign(task.destination, current);
					continue;
				}
				if (typeof current !== "object") return void 0;
				if (ancestors.has(current)) return void 0;
				if (Array.isArray(current)) {
					if (!hasPlainArrayPrototype(current)) return void 0;
					const length = current.length;
					if (Reflect.ownKeys(current).length !== length + 1) return void 0;
					const target = detach ? [] : void 0;
					if (target !== void 0) assign(task.destination, target);
					ancestors.add(current);
					tasks.push({
						kind: "leave",
						source: current
					});
					for (let index = length - 1; index >= 0; index--) tasks.push({
						kind: "array-item",
						source: current,
						index,
						...target === void 0 ? {} : { target }
					});
					continue;
				}
				if (!hasPlainObjectPrototype(current)) return void 0;
				const keys = enumerableStringKeys(current);
				if (keys === void 0) return void 0;
				const target = detach ? {} : void 0;
				if (target !== void 0) assign(task.destination, target);
				ancestors.add(current);
				tasks.push({
					kind: "leave",
					source: current
				});
				for (let index = keys.length - 1; index >= 0; index--) {
					const key = keys[index];
					/* v8 ignore next -- the loop is bounded by the captured key count. */
					if (key === void 0) return void 0;
					tasks.push({
						kind: "object-property",
						source: current,
						key,
						...target === void 0 ? {} : { target }
					});
				}
			}
			return detach ? root : true;
		}
		/**
		* Validate and detach lossless JSON in one read per property.
		* @param value - candidate value to validate and detach.
		* @returns the detached snapshot, or `undefined` when the value is not losslessly JSON-serializable.
		*/
		function snapshotJsonValue(value) {
			return walkJsonValue(value, true);
		}
		/**
		* Deep-freeze an object graph in place while leaving live AbortSignal objects mutable.
		* @param value - value to freeze.
		* @returns the same value after every reachable enumerable child is frozen.
		*/
		function deepFreeze(value) {
			const seen = /* @__PURE__ */ new WeakSet();
			const pending = [{
				kind: "visit",
				node: value
			}];
			while (pending.length > 0) {
				const task = pending.pop();
				/* v8 ignore next -- the loop condition guarantees one pending task. */
				if (task === void 0) continue;
				if (task.kind === "property") {
					pending.push({
						kind: "visit",
						node: task.source[task.key]
					});
					continue;
				}
				const node = task.node;
				if (node === null || typeof node !== "object") continue;
				if (node instanceof AbortSignal) continue;
				if (seen.has(node)) continue;
				seen.add(node);
				Object.freeze(node);
				const keys = Object.keys(node);
				for (let index = keys.length - 1; index >= 0; index--) {
					const key = keys[index];
					/* v8 ignore next -- the loop is bounded by the captured key count. */
					if (key === void 0) continue;
					pending.push({
						kind: "property",
						source: node,
						key
					});
				}
			}
			return value;
		}
		//#endregion
		//#region node_modules/.pnpm/@deepseek-ai+dsh-llm@0.2.1-rc.2_@deepseek-ai+cordis@4.0.5/node_modules/@deepseek-ai/dsh-llm/lib/types/assistant-stream.js
		/**
		* Lossless compact representation of one model-stream attempt, plus record-level
		* readers that answer common consumer questions without materializing members.
		* Readers trust the static record type; expandAssistantStream is the validating
		* path for records read at a durable boundary.
		*/
		function safeTime(value) {
			if (!Number.isSafeInteger(value)) throw new TypeError(`Assistant stream time must be a safe integer, got ${String(value)}`);
			return value;
		}
		function safeIndex(value, label) {
			if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`${label} index must be a non-negative safe integer`);
			return value;
		}
		function snapshotChunk(chunk) {
			const snapshot = snapshotJsonValue(chunk);
			if (snapshot === void 0) throw new TypeError("Assistant stream chunk must be losslessly JSON-serializable");
			return snapshot;
		}
		/**
		* Expand compact records into the exact timed chunk sequence.
		* @param stream - compact records from one durable Assistant settlement.
		* @returns detached timed chunks with every original delta boundary preserved.
		* @throws {TypeError} when a record or reconstructed timestamp is invalid.
		*/
		function expandAssistantStream(stream) {
			const chunks = [];
			for (const candidate of stream) {
				const record = validateRecord(candidate);
				if (record.type === "chunk") {
					chunks.push({
						time: record.time,
						chunk: record.chunk
					});
					continue;
				}
				const members = record.type === "tool-call-chunks" ? record.args : record.texts;
				let time = record.time0;
				for (let index = 0; index < members.length; index += 1) {
					if (index > 0) time += record.dt[index - 1];
					let chunk;
					if (record.type === "text-chunks") chunk = {
						type: "text-delta",
						index: record.index,
						text: members[index]
					};
					else if (record.type === "reasoning-chunks") chunk = {
						type: "reasoning-delta",
						index: record.index,
						text: members[index]
					};
					else chunk = {
						type: "tool-call-delta",
						index: record.index,
						id: record.id,
						...Object.hasOwn(record, "name") ? { name: record.name } : {},
						argumentsDelta: members[index]
					};
					chunks.push({
						time,
						chunk
					});
				}
			}
			return chunks;
		}
		function validateRecord(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Assistant stream record must be an object");
			const record = value;
			switch (record.type) {
				case "text-chunks":
				case "reasoning-chunks": {
					exactKeys(record, [
						"type",
						"time0",
						"index",
						"dt",
						"texts"
					], record.type);
					const texts = stringArray(record.texts, `${record.type} texts`);
					if (texts.length === 0) throw new TypeError(`${record.type} texts must be non-empty`);
					validateRun(record, texts.length, record.type);
					return record;
				}
				case "tool-call-chunks": {
					exactKeys(record, Object.hasOwn(record, "name") ? [
						"type",
						"time0",
						"index",
						"dt",
						"id",
						"name",
						"args"
					] : [
						"type",
						"time0",
						"index",
						"dt",
						"id",
						"args"
					], record.type);
					const args = stringArray(record.args, "tool-call-chunks args");
					if (args.length === 0) throw new TypeError("tool-call-chunks args must be non-empty");
					if (typeof record.id !== "string" || record.id.length === 0) throw new TypeError("tool-call-chunks id must be a non-empty string");
					if (record.name !== void 0 && (typeof record.name !== "string" || record.name.length === 0)) throw new TypeError("tool-call-chunks name must be a non-empty string");
					validateRun(record, args.length, record.type);
					return record;
				}
				case "chunk": {
					exactKeys(record, [
						"type",
						"time",
						"chunk"
					], "chunk");
					const time = safeTime(record.time);
					if (typeof record.chunk !== "object" || record.chunk === null || Array.isArray(record.chunk)) throw new TypeError("Assistant stream raw chunk must be a lossless JSON object");
					let chunk;
					try {
						chunk = snapshotChunk(record.chunk);
					} catch (error) {
						throw new TypeError("Assistant stream raw chunk must be a lossless JSON object", { cause: error });
					}
					return deepFreeze({
						type: "chunk",
						time,
						chunk
					});
				}
				default: throw new TypeError(`Unsupported Assistant stream record ${JSON.stringify(record.type)}`);
			}
		}
		function validateRun(record, members, label) {
			safeTime(record.time0);
			safeIndex(record.index, label);
			if (!Array.isArray(record.dt) || record.dt.some((value) => !Number.isSafeInteger(value))) throw new TypeError(`${label} dt must contain safe integers`);
			if (record.dt.length !== members - 1) throw new TypeError(`${label} dt length must be one less than its members`);
			let time = record.time0;
			for (const gap of record.dt) {
				time += gap;
				if (!Number.isSafeInteger(time)) throw new TypeError(`${label} member times must stay safe integers`);
			}
		}
		function stringArray(value, label) {
			if (!Array.isArray(value) || value.some((member) => typeof member !== "string")) throw new TypeError(`${label} must be a string array`);
			return value;
		}
		function exactKeys(record, keys, label) {
			if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) throw new TypeError(`${label} Assistant stream record must contain exactly ${keys.join(", ")}`);
		}
		/** The fork boundary prompt's first line (marker for the side boundary message). */
		const BOUNDARY_PREFIX = "Side conversation boundary";
		/**
		* Strip the internal side-conversation boundary envelope off an opening user
		* message, returning just the user's own question. The boundary message is
		* built by {@link sidePrompt} as: boundary prompt + mode line + question.
		* When the message is not a boundary (no `Mode:` line present) it is treated
		* as a pure internal envelope and dropped (`null`).
		*/
		function stripSideBoundary(text) {
			if (!text.startsWith(BOUNDARY_PREFIX)) return text;
			const modeIndex = text.indexOf("\nMode:");
			if (modeIndex < 0) return null;
			const afterMode = text.indexOf("\n", modeIndex + 1);
			if (afterMode < 0) return null;
			const rest = text.slice(afterMode + 1).trim();
			return rest === "" ? null : rest;
		}
		/**
		* Extract the visible text of a content block list: `text` blocks verbatim,
		* joined by blank lines; everything else (reasoning, tool blocks) contributes
		* nothing. An empty result reads `…` so rows never render blank.
		* @param blocks - model-facing content blocks.
		* @returns the joined visible text.
		*/
		function blockText(blocks) {
			const text = blocks.map((block) => block.type === "text" ? block.text : "").filter((part) => part !== "").join("\n\n");
			return text === "" ? "…" : text;
		}
		function imageRefs(blocks) {
			return blocks.flatMap((block) => block.type === "image" ? [block.attachment] : []);
		}
		function transcriptImages(refs) {
			return refs.map((attachment) => ({ attachment }));
		}
		function rowText(blocks, images) {
			const text = blockText(blocks);
			return images.length > 0 && text === "…" ? "" : text;
		}
		/** Index of the last `session/end-seed` event (fork seed marker), or -1. */
		function lastSeedEnd(events) {
			for (let i = events.length - 1; i >= 0; i--) if (events[i]?.type === "session/end-seed") return i;
			return -1;
		}
		function isSideBoundaryEvent(event) {
			return event.type === "user/message" && event.data.content.some((block) => block.type === "text" && block.text.startsWith(BOUNDARY_PREFIX));
		}
		/** Seed marker immediately before the child's first boundary prompt, or the
		* latest marker for legacy logs without a boundary. */
		function transcriptSeedEnd(events) {
			const boundary = events.findIndex(isSideBoundaryEvent);
			if (boundary >= 0) {
				for (let i = boundary - 1; i >= 0; i--) if (events[i]?.type === "session/end-seed") return i;
				return -1;
			}
			return lastSeedEnd(events);
		}
		/**
		* Map a session log's history rows onto compact transcript rows: the
		* inherited fork seed is cut at the first boundary's preceding
		* `session/end-seed`, the boundary prompt is dropped, `assistant/chunk` text deltas accumulate into a
		* streaming row per step (superseded by the assembled `assistant/message`),
		* and tool invocations render one expandable line each — raw arguments and
		* paired result content ride the row as detail; a failing `tool/result` marks it.
		* @param entries - expanded alpha history events in seq order.
		* @returns display rows in log order.
		*/
		function transcriptRows(entries) {
			const events = entries.map((entry) => entry.event);
			const seedEnd = transcriptSeedEnd(events);
			const rows = [];
			/** (turn, step, block, kind) key → index of its accumulating stream row. */
			const streamRows = /* @__PURE__ */ new Map();
			/** tool callId → index of its tool row in `rows` (result pairing). */
			const callRows = /* @__PURE__ */ new Map();
			for (let i = 0; i < events.length; i++) {
				if (i <= seedEnd) continue;
				const event = events[i];
				switch (event.type) {
					case "user/message": {
						const refs = imageRefs(event.data.content);
						const text = rowText(event.data.content, refs);
						const images = refs.length === 0 ? {} : { images: transcriptImages(refs) };
						const stripped = stripSideBoundary(text);
						if (stripped === null) break;
						const displayText = stripped === text ? text : stripped;
						const source = event.data.source;
						const sourceKind = typeof source === "object" && source !== null ? source["kind"] : void 0;
						if (sourceKind === void 0 || sourceKind === "user") rows.push({
							kind: "user",
							seq: event.seq,
							text: displayText,
							...images
						});
						else rows.push({
							kind: "context",
							seq: event.seq,
							text: displayText,
							source: typeof sourceKind === "string" ? sourceKind : null,
							recall: sourceKind === "recall" || sourceKind === "context-recall",
							...images
						});
						break;
					}
					case "assistant/live-chunk": {
						const chunk = event.data.chunk;
						if (chunk.type !== "text-delta" && chunk.type !== "reasoning-delta" || chunk.text === "") break;
						const kind = chunk.type === "text-delta" ? "assistant" : "reasoning";
						const key = `${event.data.turn}:${event.data.step}:${chunk.index}:${kind}`;
						const existing = streamRows.get(key);
						if (existing !== void 0) {
							const row = rows[existing];
							if (row !== void 0 && row.kind === kind) rows[existing] = {
								...row,
								text: row.text + chunk.text
							};
						} else {
							streamRows.set(key, rows.length);
							rows.push({
								kind,
								seq: event.seq,
								text: chunk.text
							});
						}
						break;
					}
					case "assistant/message": {
						const prefix = `${event.data.turn}:${event.data.step}:`;
						const streamed = [...streamRows.entries()].filter(([key]) => key.startsWith(prefix)).map(([, index]) => index);
						for (const key of [...streamRows.keys()]) if (key.startsWith(prefix)) streamRows.delete(key);
						const settled = event.data.message.content.flatMap((block) => {
							if (block.type === "reasoning" && block.text !== "") return [{
								kind: "reasoning",
								seq: event.seq,
								text: block.text
							}];
							if (block.type === "text" && block.text !== "") return [{
								kind: "assistant",
								seq: event.seq,
								text: block.text
							}];
							return [];
						});
						const refs = imageRefs(event.data.message.content);
						if (refs.length > 0) {
							const images = transcriptImages(refs);
							const assistant = settled.findIndex((row) => row.kind === "assistant");
							if (assistant >= 0) {
								const row = settled[assistant];
								if (row !== void 0 && row.kind === "assistant") settled[assistant] = {
									...row,
									images
								};
							} else settled.push({
								kind: "assistant",
								seq: event.seq,
								text: "",
								images
							});
						}
						if (settled.length === 0 && event.data.message.content.length === 0) settled.push({
							kind: "assistant",
							seq: event.seq,
							text: "…"
						});
						if (streamed.length === 0) rows.push(...settled);
						else rows.splice(Math.min(...streamed), streamed.length, ...settled);
						break;
					}
					case "tool/call": {
						const data = event.data;
						callRows.set(data.callId, rows.length);
						rows.push({
							kind: "tool",
							seq: event.seq,
							name: data.name,
							failed: false,
							detail: { arguments: data.arguments }
						});
						break;
					}
					case "tool/result": {
						const data = event.data;
						const callId = data.message.toolCallId;
						const index = callId === void 0 ? void 0 : callRows.get(callId);
						const error = data.error;
						const failed = error !== void 0 || data.message.isError === true;
						if (index !== void 0) {
							const row = rows[index];
							if (row !== void 0 && row.kind === "tool") rows[index] = {
								...row,
								failed,
								detail: {
									...row.detail,
									...data.message.content.length === 0 ? {} : { result: data.message.content },
									...data.meta === void 0 ? {} : { meta: data.meta },
									...error === void 0 ? {} : { error }
								}
							};
						} else if (failed) rows.push({
							kind: "tool",
							seq: event.seq,
							name: "tool",
							failed: true,
							...error === void 0 ? {} : { detail: { error } }
						});
						break;
					}
					case "turn/end":
						if (event.data.reason.kind !== "error") break;
						rows.push({
							kind: "error",
							seq: event.seq,
							text: event.data.reason.error.message
						});
				}
			}
			return rows;
		}
		/**
		* Files the child's tool calls report having created or changed, by render
		* intent rather than tool name — the same policy as the main chat's
		* ui-deliverables: a diff card, or a generic card whose `kind` is `edit`
		* (the shape `str_replace_editor`'s insert presents). Reads, deletes, and
		* plain terminal runs produce nothing. Paths keep first-seen order and
		* appear once.
		* @param entries - expanded alpha history events.
		* @returns produced file paths.
		*/
		function producedPaths(entries) {
			const seedEnd = transcriptSeedEnd(entries.map((entry) => entry.event));
			const failedCallIds = /* @__PURE__ */ new Set();
			for (let i = seedEnd + 1; i < entries.length; i++) {
				const event = entries[i]?.event;
				if (event === void 0 || event.type !== "tool/result") continue;
				const message = event.data.message;
				const callId = message.toolCallId;
				if (callId === void 0) continue;
				if (event.data.error !== void 0 || message.isError === true) failedCallIds.add(callId);
			}
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			for (let i = seedEnd + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.event.type !== "tool/call" || failedCallIds.has(entry.event.data.callId)) continue;
				if (!/(write|edit|replace|patch|create)/i.test(entry.event.data.name)) continue;
				try {
					const args = JSON.parse(entry.event.data.arguments);
					for (const key of [
						"file_path",
						"filePath",
						"path"
					]) {
						const path = args[key];
						if (typeof path === "string" && !seen.has(path)) {
							seen.add(path);
							paths.push(path);
						}
					}
				} catch {}
			}
			return paths;
		}
		/** One-line summary of alpha tool-result content. */
		function resultViewSummary(content) {
			return content.length === 0 ? void 0 : blockText(content);
		}
		/**
		* Union two produced-file vocabularies, keeping first-seen order. The panel
		* accumulates across polls so a produced path remains usable after its call
		* row slides out of the current tail window.
		* @param previous - the accumulated vocabulary (may be empty on first fetch).
		* @param next - the current window's vocabulary.
		* @returns the union in first-seen order.
		*/
		function mergeProduced(previous, next) {
			const seen = new Set(previous);
			return [...previous, ...next.filter((path) => !seen.has(path))];
		}
		/**
		* Fetch a child's transcript.
		*
		* Reads through alpha's `session.follow`/`session.page` Remote methods without
		* activating the child or changing the current session.
		*
		* The child's log starts with the entire inherited parent history (fork
		* seed), which can be tens of thousands of chunk events. A single large tail
		* window would ship the inherited seed on every poll, so the reader pages
		* backwards in small windows until a window contains the seed boundary,
		* then cuts there. Later reads fetch one tail page and merge those events into
		* the cached child transcript, retaining earlier rounds.
		* @param sessions - alpha's generated Session Remote surface.
		* @param address - durable parent/child address (only the child id is used).
		* @returns display rows plus the produced-file vocabulary, or null on
		*   transport/business failure.
		*/
		async function fetchTranscript(sessions, address) {
			const entries = await fetchSeedCutEntries(sessions, address, 8);
			if (entries === null) return null;
			const previous = transcriptEntryCache.get(address.childSessionId) ?? [];
			const bySeq = new Map(previous.map((entry) => [entry.event.seq, entry]));
			for (const entry of entries) if (entry.event.type !== "assistant/live-chunk") bySeq.set(entry.event.seq, entry);
			const transcript = [...bySeq.values()].sort((a, b) => a.event.seq - b.event.seq);
			transcriptEntryCache.set(address.childSessionId, transcript);
			const live = entries.filter((entry) => entry.event.type === "assistant/live-chunk");
			return {
				rows: await hydrateTranscriptImages(sessions, address.childSessionId, transcriptRows([...transcript, ...live])),
				produced: producedPaths(transcript)
			};
		}
		/**
		* Fetch one running child's live activity line (latest assistant text or
		* last tool call) from a light seed-cut tail page — the list-row preview
		* poll, kept much cheaper than the full transcript page (no produced
		* vocabulary, fewer pages).
		* @param sessions - the api client's sessions surface.
		* @param address - durable parent/child address (only the child id is used).
		* @returns the activity line, or null on transport/business failure or an
		*   empty tail.
		*/
		async function fetchActivity(sessions, address) {
			const entries = await fetchSeedCutEntries(sessions, address, 6, 4);
			if (entries === null) return null;
			return lastActivity(transcriptRows(entries)) ?? null;
		}
		/**
		* Per-child seed-boundary cache: the seq of the marker before the child's
		* first boundary. Once the first walk locates it, every later read needs at
		* most ONE page and the dense inherited seed is never re-downloaded.
		*/
		const seedBoundaryCache = /* @__PURE__ */ new Map();
		/** Child-owned history accumulated from cheap tail polls. */
		const transcriptEntryCache = /* @__PURE__ */ new Map();
		const imageUrlCache = /* @__PURE__ */ new Map();
		async function hydrateTranscriptImages(sessions, childSessionId, rows) {
			const refs = /* @__PURE__ */ new Map();
			for (const row of rows) for (const image of "images" in row ? row.images ?? [] : []) refs.set(String(image.attachment.attachmentId), image.attachment);
			if (refs.size === 0) return [...rows];
			await Promise.all([...refs].map(async ([id, ref]) => {
				if (imageUrlCache.has(id)) return;
				try {
					const response = await sessions.attachment({
						sessionId: childSessionId,
						attachmentId: ref.attachmentId
					});
					if (!response.ok) {
						imageUrlCache.set(id, null);
						return;
					}
					const data = response.value.data;
					imageUrlCache.set(id, data.startsWith("data:") ? data : `data:${ref.mediaType};base64,${data}`);
				} catch {
					imageUrlCache.set(id, null);
				}
			}));
			return rows.map((row) => {
				if (!("images" in row) || row.images === void 0) return row;
				return {
					...row,
					images: row.images.map((image) => {
						const url = imageUrlCache.get(String(image.attachment.attachmentId));
						return {
							...image,
							...typeof url === "string" ? { url } : {}
						};
					})
				};
			});
		}
		/**
		* Page a child's log backwards from the tail in small windows until a window
		* contains the first boundary prompt, then return everything after the seed
		* marker before that prompt — the child's own conversation only.
		*
		* The host pages strictly backward (`beforeSeq` is an exclusive upper bound),
		* so there is no "start after the boundary" fetch: the first read walks back
		* until a window contains the boundary. Later reads fetch one tail window and
		* cut with the cached seed marker. Overlap between pages is deduped by
		* sequence, so an inclusive `beforeSeq` contract on the host is harmless.
		* @param sessions - the api client's sessions surface.
		* @param childSessionId - the child whose own conversation to read.
		* @param pageMessages - messages per backward page.
		* @param pageCap - optional backward-page cap for lightweight callers. The
		*   transcript read omits it and continues until the seed boundary.
		* @returns the seed-cut entries, or null on transport/business failure.
		*/
		async function fetchSeedCutEntries(sessions, childAddress, pageMessages, pageCap) {
			const childSessionId = childAddress.childSessionId;
			const cachedBoundary = seedBoundaryCache.get(childSessionId);
			const collected = [];
			let beforeSeq;
			let boundarySeq = cachedBoundary;
			const address = {
				kind: "subagent",
				parentSessionId: childAddress.parentSessionId,
				childSessionId,
				mode: childAddress.mode
			};
			let throughSeq;
			const live = [];
			try {
				for (let page = 0; page < (pageCap ?? Number.POSITIVE_INFINITY); page++) {
					let records;
					let hasMore;
					if (throughSeq === void 0) {
						const iterator = sessions.follow({
							address,
							maxMessages: pageMessages,
							assistantStream: true
						})[Symbol.asyncIterator]();
						const first = await iterator.next();
						await iterator.return?.();
						if (first.done || first.value.type !== "snapshot") return null;
						const snapshot = first.value;
						throughSeq = snapshot.cursor;
						records = snapshot.records;
						hasMore = snapshot.hasMore;
						const active = snapshot.assistantStream?.activeAttempt;
						if (active !== void 0) for (const { time, chunk } of expandAssistantStream(active.stream)) live.push({ event: {
							type: "assistant/live-chunk",
							seq: snapshot.cursor + 1,
							time,
							data: {
								attemptId: active.attemptId,
								turn: active.turn,
								step: active.step,
								chunk
							}
						} });
					} else {
						const response = await sessions.page({
							address,
							throughSeq,
							maxMessages: pageMessages,
							...beforeSeq === void 0 ? {} : { beforeSeq }
						});
						if (!response.ok) return null;
						records = response.value.records;
						hasMore = response.value.hasMore;
					}
					const events = expandHistoryRecords(records);
					if (events.length === 0) break;
					const olderThan = collected.length > 0 ? collected[0].event.seq : void 0;
					const fresh = olderThan === void 0 ? events : events.filter((entry) => entry.event.seq < olderThan);
					if (boundarySeq !== void 0) {
						const boundary = boundarySeq;
						collected.unshift(...fresh.filter((entry) => entry.event.seq > boundary));
						break;
					}
					const boundaryIndex = fresh.findIndex((entry) => isSideBoundaryEvent(entry.event));
					if (boundaryIndex >= 0) {
						for (let i = boundaryIndex - 1; i >= 0; i--) {
							if (fresh[i]?.event.type !== "session/end-seed") continue;
							boundarySeq = fresh[i].event.seq;
							seedBoundaryCache.set(childSessionId, boundarySeq);
							break;
						}
						collected.unshift(...fresh);
						break;
					}
					const seedEnd = lastSeedEnd(fresh.map((entry) => entry.event));
					if (seedEnd >= 0 && hasMore === false) {
						boundarySeq = fresh[seedEnd].event.seq;
						seedBoundaryCache.set(childSessionId, boundarySeq);
						collected.unshift(...fresh.slice(seedEnd + 1));
						break;
					}
					collected.unshift(...fresh);
					if (!hasMore) break;
					if (fresh.length === 0) break;
					beforeSeq = fresh[0].event.seq;
				}
			} catch {
				return null;
			}
			return [...collected, ...live];
		}
		/** Read durable events from the Remote journal envelopes. */
		function expandHistoryRecords(records) {
			return records.map((record) => ({ event: record.event }));
		}
		/**
		* Deliver one human message to a continuable child through its exact
		* direct-parent address (the same non-activating transport the runtime's
		* catalog navigation uses).
		* @param subagents - the api client's subagents surface.
		* @param address - continuable parent/child address.
		* @param text - the message body (one text block).
		* @returns whether the prompt was accepted.
		*/
		async function sendPrompt(subagents, address, text) {
			try {
				return (await subagents.prompt({
					requestId: crypto.randomUUID(),
					...address,
					delivery: "queue",
					content: [{
						type: "text",
						text
					}]
				})).ok === true;
			} catch {
				return false;
			}
		}
		//#endregion
		//#region src/client/SidechainPanel.tsx
		/**
		* Sidechain right panel (browser half): a floating right-edge sidebar listing
		* the current session's `/side` and `/btw` subagent children, with an
		* embedded conversation view — selecting a child renders its transcript
		* (and a composer for continuable threads) INSIDE the panel while the main
		* session stays untouched.
		*
		* Panel chrome: the width is drag-resizable from the left edge (rAF-batched
		* direct DOM writes, one store commit on pointer-up, persisted to
		* localStorage, double-click resets), an expand toggle widens it to ~75vw,
		* and Ctrl/Cmd+Shift+E toggles the whole panel. Running rows show a live
		* activity line — the child's latest text or last tool call — polled from a
		* light tail page every 3s while the panel is open and the document visible,
		* with a shimmer sweep on the running label (installed once via
		* panel-style.ts, reduced-motion safe).
		*
		* Data rides the alpha Session Controller's live subagent catalog —
		* `sessions.list` rows under `projectionsBySession` — for membership, and Session
		* Remote history for conversation content (no activation, no navigation).
		* While the selected child is running, a poll reads its transcript tail (the
		* host serves the live child's in-memory snapshot) and the transcript layer
		* accumulates it with prior rounds, so a `/side` or `/btw` run streams into
		* the panel near-live; the final state lands when the catalog reports the
		* child inactive.
		*
		* The panel deliberately never attaches the child session client-side (no
		* `sessions.binding` / session-face subscription): instantiating a session
		* that is never opened leaves it in the runtime's cold state, whose live
		* event frames are dropped — the transcript would only ever refresh on
		* unrelated state flips — and the extra scope minting interferes with the
		* runtime's session staging. Polling keeps the panel a pure RPC consumer.
		*
		* The visibility + selection store is module-scoped (`panel-state.ts`),
		* shared by the composer-mounted panel host and the header toggle. The host
		* discovers successful live `/side` and `/btw` commands even when blank
		* session chrome suppresses the command cards.
		*/
		/**
		* Resolve the catalog into display rows: child entries carry their durable
		* label when present, falling back to the session title and then id.
		* @param catalog - the parent's catalog snapshot (absent while never fetched).
		* @param summaries - session list rows, used as the label fallback source.
		* @returns flat display rows in catalog order.
		*/
		function sidechainRows(catalog, summaries) {
			if (catalog === void 0) return [];
			return (catalog.values.subagentCatalog ?? []).map((entry) => {
				if (entry.mode === "external") return {
					kind: "diagnostic",
					id: entry.id,
					reason: "unsupported"
				};
				const command = catalog.values.sidechainModes?.[entry.id];
				return {
					kind: "child",
					id: entry.id,
					mode: entry.mode,
					...command === void 0 ? {} : { command },
					activity: summaries[entry.id]?.running === true ? "running" : "inactive",
					label: entry.label ?? summaries[entry.id]?.title ?? entry.id
				};
			});
		}
		/** Number of child rows currently running (the header badge value). */
		function runningCount(rows) {
			return rows.filter((row) => row.kind === "child" && row.activity === "running").length;
		}
		/** Localized diagnostic copy, explicit key cases keep the dictionary typed. */
		function diagnosticText(reason, t) {
			switch (reason) {
				case "corrupt": return t("diagnostic.corrupt");
				case "unsupported": return t("diagnostic.unsupported");
				case "unavailable": return t("diagnostic.unavailable");
			}
		}
		/**
		* Shared token-level palette. DSH web themes the shell through its design
		* tokens (`--dsw-alias-*` / `--dsw-specific-*`, declared on `body` and
		* overridden under `body[data-ds-dark-theme]` by the host's theme plugin),
		* so consuming those tokens makes the panel follow the active theme with no
		* theme JS of our own. Every token carries a light-mode literal fallback so
		* older hosts that do not inject the token stylesheet still render the
		* panel's light appearance.
		*/
		const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
		const C = {
			/** Primary text (light #0f1115 / dark #f9fafb). */
			text1: "var(--dsw-alias-label-primary, #0f1115)",
			/** Secondary text (light #61666b / dark #cfd3d6). */
			text2: "var(--dsw-alias-label-secondary, #61666b)",
			/** Tertiary text (light #81858c / dark #adb2b8). */
			text3: "var(--dsw-alias-label-tertiary, #81858c)",
			/** Solid neutral surface for active chips (light #f1f3f5 / dark #353638). */
			surface2: "var(--dsw-alias-interactive-bg-hover-solid, #f1f3f5)",
			/** Hover wash (light rgba(38,49,81,0.06) / dark rgba(255,255,255,0.08)). */
			hover: "var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 81, 0.06))",
			/** Hairline borders (light rgba(0,0,0,0.10) / dark rgba(255,255,255,0.12)). */
			border: "var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))",
			/** Primary fill for badges and send button — the in-chat primary action
			*  fill, DeepSeek blue in both themes (matching the host composer). */
			primary: "var(--dsw-alias-button-info-fill, #4176e6)",
			/** Foreground on the primary fill; the host keeps white on info-fill. */
			onPrimary: "#fff",
			/** Error / destructive. */
			danger: "var(--dsw-alias-state-error-primary, #ec1313)",
			/** User-bubble tint, matching the main chat's bubble surface. */
			bubble: "var(--dsw-specific-bubble, #edf3fe)",
			/** Neutral platform surface (light #f5f6f7 / dark #353638). */
			platform: "var(--dsw-alias-bg-module-platform, #f5f6f7)"
		};
		/** Side panel enter/exit animation duration (ms). */
		const PANEL_TRANSITION_MS = 240;
		const styles = {
			toggle: {
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				padding: "4px 6px",
				border: "none",
				borderRadius: 6,
				background: "transparent",
				color: C.text2,
				cursor: "pointer",
				fontSize: 13,
				lineHeight: 1
			},
			toggleActive: {
				background: C.surface2,
				color: C.text1
			},
			badge: {
				minWidth: 16,
				height: 16,
				padding: "0 4px",
				borderRadius: 8,
				background: C.primary,
				color: C.onPrimary,
				fontSize: 11,
				lineHeight: "16px",
				textAlign: "center"
			},
			panel: {
				position: "fixed",
				top: "var(--dsh-sidechain-panel-top, 0px)",
				right: 0,
				bottom: 0,
				width: 360,
				maxWidth: "92vw",
				display: "flex",
				flexDirection: "column",
				background: "var(--dsw-alias-bg-layer-1, #ffffff)",
				borderLeft: `1px solid ${C.border}`,
				boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.12)",
				zIndex: 200,
				fontSize: 13,
				color: C.text1,
				transition: `transform ${PANEL_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${PANEL_TRANSITION_MS}ms ease`
			},
			resizer: {
				position: "absolute",
				top: 0,
				bottom: 0,
				left: -6,
				width: 12,
				cursor: "col-resize",
				touchAction: "none",
				zIndex: 2
			},
			header: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "10px 12px",
				borderBottom: `1px solid ${C.border}`
			},
			title: {
				flex: 1,
				fontWeight: 600,
				fontSize: 14
			},
			back: {
				display: "inline-flex",
				alignItems: "center",
				gap: 2,
				padding: "2px 4px",
				border: "none",
				borderRadius: 6,
				background: "transparent",
				color: C.text2,
				cursor: "pointer",
				fontSize: 12,
				flex: 1,
				textAlign: "left"
			},
			runningCount: {
				color: C.text2,
				fontSize: 12
			},
			iconButton: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 24,
				height: 24,
				padding: 0,
				border: "none",
				borderRadius: 6,
				background: "transparent",
				color: C.text2,
				cursor: "pointer"
			},
			body: {
				flex: 1,
				overflowY: "auto",
				padding: 6
			},
			notice: {
				padding: "16px 12px",
				color: C.text2,
				textAlign: "center"
			},
			error: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: 12,
				color: C.danger
			},
			retry: {
				padding: "2px 8px",
				border: `1px solid ${C.border}`,
				borderRadius: 6,
				background: "transparent",
				color: C.text2,
				cursor: "pointer",
				fontSize: 12
			},
			row: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "7px 8px",
				borderRadius: 6,
				cursor: "pointer",
				width: "100%",
				border: "none",
				background: "transparent",
				color: "inherit",
				fontSize: 13,
				textAlign: "left"
			},
			rowDisabled: {
				cursor: "default",
				opacity: .6
			},
			content: {
				flex: 1,
				minWidth: 0
			},
			label: {
				display: "block",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			summary: {
				display: "block",
				color: C.text2,
				fontSize: 12,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			activityLine: {
				display: "-webkit-box",
				WebkitBoxOrient: "vertical",
				WebkitLineClamp: 2,
				overflow: "hidden",
				color: C.text2,
				fontSize: 12,
				lineHeight: 1.4,
				wordBreak: "break-word",
				textAlign: "left"
			},
			transcript: {
				flex: 1,
				overflowY: "auto",
				padding: "8px 12px",
				display: "flex",
				flexDirection: "column",
				gap: 8
			},
			userRow: {
				alignSelf: "flex-start",
				maxWidth: "100%"
			},
			imageRow: {
				display: "flex",
				flexWrap: "wrap",
				gap: 6,
				marginTop: 6
			},
			image: {
				display: "block",
				width: "min(100%, 280px)",
				maxHeight: 240,
				objectFit: "contain",
				borderRadius: 6,
				border: `1px solid ${C.border}`,
				background: C.surface2
			},
			userText: {
				padding: "6px 10px",
				borderRadius: 10,
				background: C.platform,
				color: C.text1,
				width: "fit-content",
				maxWidth: "100%",
				fontSize: 13,
				lineHeight: 1.5
			},
			assistantRow: {
				alignSelf: "flex-start",
				maxWidth: "100%"
			},
			assistantText: {
				padding: "6px 10px",
				borderRadius: 10,
				background: C.bubble,
				color: C.text1,
				width: "fit-content",
				maxWidth: "100%",
				fontSize: 13,
				lineHeight: 1.5
			},
			disclosureSummary: {
				minWidth: 0,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				color: C.text2
			},
			disclosureSeparator: {
				flex: "none",
				width: 2,
				height: 2,
				margin: "0 8px",
				borderRadius: 1,
				background: C.text3
			},
			disclosureBody: {
				margin: "4px 0 4px 22px",
				padding: "8px 10px",
				maxHeight: 240,
				overflow: "auto",
				borderRadius: 6,
				background: "var(--dsw-alias-markdown-code-block, #f9fafb)",
				color: C.text2,
				fontFamily: MONO,
				fontSize: 12,
				lineHeight: 1.5,
				whiteSpace: "pre-wrap",
				overflowWrap: "anywhere"
			},
			toolRow: {
				color: C.text2,
				fontSize: 12,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			toolFailed: { color: C.danger },
			toolDetail: { padding: "4px 0 6px" },
			toolArgs: {
				margin: "4px 0",
				padding: "6px 8px",
				borderRadius: 6,
				background: "var(--dsw-alias-markdown-code-block, #f9fafb)",
				fontFamily: MONO,
				fontSize: 11,
				whiteSpace: "pre-wrap",
				overflowWrap: "anywhere",
				maxHeight: 180,
				overflowY: "auto"
			},
			composer: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "10px 12px",
				borderTop: `1px solid ${C.border}`
			},
			input: {
				flex: 1,
				minWidth: 0,
				padding: "6px 10px",
				border: `1px solid ${C.border}`,
				borderRadius: 8,
				background: "var(--dsw-specific-input-major, #ffffff)",
				color: C.text1,
				fontSize: 13,
				outline: "none"
			},
			sendButton: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 28,
				height: 28,
				padding: 0,
				border: "none",
				borderRadius: 8,
				background: C.primary,
				color: C.onPrimary,
				cursor: "pointer"
			},
			readonly: {
				padding: "8px 12px",
				borderTop: `1px solid ${C.border}`,
				color: C.text2,
				fontSize: 12,
				textAlign: "center"
			}
		};
		/** Render one catalog row; clicking selects it for the embedded view.
		*  Running rows carry a live activity line (latest text / tool call) under
		*  the mode summary — polled separately and only while the panel is open. */
		function Row({ row, activityText, t, onSelect }) {
			if (row.kind === "diagnostic") {
				const reason = diagnosticText(row.reason, t);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						...styles.row,
						...styles.rowDisabled
					},
					title: reason,
					"aria-disabled": "true",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: styles.content,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.label,
							children: row.id
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.summary,
							children: reason
						})]
					})]
				});
			}
			const mode = row.mode === "unknown" ? t("mode.unknown") : row.mode === "one-shot" || row.command === "btw" ? t("mode.oneShot") : t("mode.continuable");
			const running = row.activity === "running";
			const activity = running ? t("activity.running") : t("activity.inactive");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				style: styles.row,
				title: t("row.open", { label: row.label }),
				"aria-label": t("row.open", { label: row.label }),
				onClick: () => onSelect(row.id),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: running ? "ongoing" : "done" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: styles.content,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.label,
							children: row.label
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: styles.summary,
							children: [`${mode} · `, running ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-sidechain-shimmer",
								children: activity
							}) : activity]
						}),
						activityText !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.activityLine,
							title: activityText,
							children: activityText
						})
					]
				})]
			});
		}
		/** Cap for raw arguments shown in the detail view (platform contract: never
		*  dump full raw arguments — write/edit payloads can be hundreds of KB). */
		const TOOL_ARGS_MAX = 2e3;
		/** Pretty-print a tool's curated rawInput (the platform contract's salient
		*  input), falling back to the raw arguments JSON truncated to a hard cap. */
		function prettyToolInput(rawInput, argumentsRaw) {
			if (rawInput !== void 0) try {
				return JSON.stringify(rawInput, null, 2);
			} catch {}
			if (argumentsRaw === void 0) return void 0;
			const trimmed = argumentsRaw.length > TOOL_ARGS_MAX ? `${argumentsRaw.slice(0, TOOL_ARGS_MAX)}…（已截断）` : argumentsRaw;
			try {
				return JSON.stringify(JSON.parse(trimmed), null, 2);
			} catch {
				return trimmed;
			}
		}
		/** Platform convention: decorative animations yield to prefers-reduced-motion
		*  (the plugin bundle has no CSS pipeline, so the guard is a JS matchMedia). */
		function prefersReducedMotion() {
			return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
		}
		/** One expandable tool row: collapsed shows the call line; expanded shows
		*  the terminal-style command/output (terminal calls) or the arguments,
		*  result text, and failure detail. */
		function ToolRow({ row, running, codeLabels }) {
			const [open, setOpen] = (0, react.useState)(false);
			const detail = row.detail;
			const resultText = detail?.result === void 0 ? void 0 : resultViewSummary(detail.result);
			const inputText = prettyToolInput(void 0, detail?.arguments);
			const expandable = inputText !== void 0 || resultText !== void 0 || detail?.error !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: row.failed ? "error" : running ? "ongoing" : "done" }),
				title: row.name,
				open,
				expandable,
				onToggle: () => {
					setOpen((value) => !value);
				},
				collapsedContent: row.failed ? " ✗" : void 0,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles.toolDetail,
					children: [
						inputText !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							style: styles.toolArgs,
							children: inputText
						}),
						resultText !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { margin: "4px 0" },
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
								text: resultText,
								streaming: false,
								labels: {
									code: codeLabels ?? {
										copyLabel: "Copy",
										copiedLabel: "Copied"
									},
									footnotes: "Footnotes"
								}
							})
						}),
						detail?.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								...styles.toolFailed,
								fontSize: 12,
								marginTop: 4
							},
							children: `✗ ${detail.error.name}: ${detail.error.code}`
						})
					]
				})
			});
		}
		/** Compact disclosure matching the main conversation's Think/context rows. */
		function TranscriptDisclosure({ row, streaming, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const summary = row.text.trim().split("\n").find((line) => line !== "") ?? "";
			const contextSource = row.kind === "context" ? row.source : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
				icon: row.kind === "reasoning" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconThinkOutlineRegular, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutlineRegular, { size: 14 }),
				title: row.kind === "reasoning" ? t("view.reasoning") : t(row.recall ? "view.contextRecall" : "view.context"),
				open,
				expandable: true,
				expandOnRowClick: true,
				onToggle: () => {
					setOpen((value) => !value);
				},
				collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles.disclosureSeparator,
					"aria-hidden": true
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles.disclosureSummary,
					children: contextSource ?? (streaming ? summary.slice(-120) : summary)
				})] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					style: styles.disclosureBody,
					children: row.text
				})
			});
		}
		function TranscriptImages({ images }) {
			const visible = images.filter((image) => image.url !== void 0);
			if (visible.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: styles.imageRow,
				children: visible.map((image) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: image.url,
					alt: image.attachment.name ?? "Attached image",
					style: styles.image
				}, String(image.attachment.attachmentId)))
			});
		}
		/** One transcript row from the child session's full visible timeline. */
		function TranscriptRowView({ row, streaming, codeLabels, fileMentions, t }) {
			const labels = {
				code: codeLabels ?? {
					copyLabel: "Copy",
					copiedLabel: "Copied"
				},
				footnotes: "Footnotes"
			};
			if (row.kind === "user") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.userRow,
				children: [row.images !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TranscriptImages, { images: row.images }), row.text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: styles.userText,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
						text: row.text,
						streaming,
						labels,
						fileMentions
					})
				})]
			});
			if (row.kind === "assistant") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.assistantRow,
				children: [row.images !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TranscriptImages, { images: row.images }), row.text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: styles.assistantText,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
						text: row.text,
						streaming,
						labels,
						fileMentions
					})
				})]
			});
			if (row.kind === "reasoning" || row.kind === "context") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [row.kind === "context" && row.images !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TranscriptImages, { images: row.images }), row.text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TranscriptDisclosure, {
				row,
				streaming,
				t
			})] });
			if (row.kind === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					...styles.assistantRow,
					color: C.danger
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: styles.assistantText,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
						text: row.text,
						streaming: false,
						labels,
						fileMentions
					})
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolRow, {
				row,
				running: streaming && row.detail?.result === void 0,
				codeLabels
			});
		}
		/** Poll interval for the selected child's transcript while it is running (ms). */
		const LIVE_POLL_INTERVAL_MS = 1200;
		/** Poll interval for running rows' activity lines (ms). */
		const ACTIVITY_POLL_INTERVAL_MS = 3e3;
		/**
		* Header action for manually opening the sidechain catalog. Keeping this
		* separate from the panel host lets blank sessions mount the host even while
		* their header chrome is intentionally absent.
		*/
		function SidechainPanelToggle({ sessionId, useSessions, t }) {
			const [open, setOpen] = (0, react.useState)(isSidechainPanelOpen);
			(0, react.useEffect)(() => subscribeSidechainPanel(() => {
				setOpen(isSidechainPanelOpen());
			}), []);
			const running = runningCount(sidechainRows(useSessions((state) => state.projectionsBySession[sessionId]), useSessions((state) => state.byId)));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				style: {
					...styles.toggle,
					...open ? styles.toggleActive : {}
				},
				title: t("panel.toggle"),
				"aria-label": t("panel.toggle"),
				"aria-pressed": open,
				onClick: toggleSidechainPanel,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 16 }), running > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: styles.badge,
					children: running
				})]
			});
		}
		/**
		* The composer-mounted floating right panel. It shows the catalog list or,
		* once selected, the child's embedded conversation (transcript + composer for continuable
		* threads); the main session never switches. Arming the catalog happens on
		* open and follows the current session.
		*/
		function SidechainPanel({ sessionId, useChat, useSessions, readTranscript, readActivity, sendPrompt, refresh, openPath, t }) {
			const [open, setOpen] = (0, react.useState)(isSidechainPanelOpen);
			const [selected, setSelected] = (0, react.useState)(selectedChildId);
			const [selectedMode, setSelectedMode] = (0, react.useState)(selectedChildMode);
			(0, react.useEffect)(() => subscribeSidechainPanel(() => {
				setOpen(isSidechainPanelOpen());
				setSelected(selectedChildId());
				setSelectedMode(selectedChildMode());
			}), []);
			const [mounted, setMounted] = (0, react.useState)(isSidechainPanelOpen);
			const [entered, setEntered] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (open) setMounted(true);
				else {
					setEntered(false);
					const timer = setTimeout(() => setMounted(false), PANEL_TRANSITION_MS);
					return () => clearTimeout(timer);
				}
			}, [open]);
			(0, react.useEffect)(() => {
				if (!mounted || !open) return;
				const raf = requestAnimationFrame(() => setEntered(true));
				return () => cancelAnimationFrame(raf);
			}, [mounted, open]);
			const chatNodes = useChat((snapshot) => snapshot.nodes.values());
			const commands = (0, react.useMemo)(() => chatNodes.filter((node) => node.kind === "command").map((node) => node.data), [chatNodes]);
			const observedRef = (0, react.useRef)({
				sessionId,
				startedAt: Date.now(),
				known: void 0
			});
			(0, react.useEffect)(() => {
				if (observedRef.current.sessionId !== sessionId) observedRef.current = {
					sessionId,
					startedAt: Date.now(),
					known: void 0
				};
				const observed = observeCreatedChildren(observedRef.current.known, commands, observedRef.current.startedAt);
				observedRef.current.known = observed.known;
				for (const child of observed.children) {
					const owner = commands.find((candidate) => {
						const name = candidate.name;
						return (name === "side" || name === "btw") && resolveChildSessionId(candidate, name) === child;
					});
					revealChild(child, owner !== void 0 ? owner.name === "btw" ? "one-shot" : "continuable" : void 0);
				}
			}, [commands, sessionId]);
			const catalogs = useSessions((state) => state.projectionsBySession);
			const summaries = useSessions((state) => state.byId);
			const catalog = catalogs[sessionId];
			const rows = (0, react.useMemo)(() => sidechainRows(catalog, summaries), [catalog, summaries]);
			const running = runningCount(rows);
			const codeLabels = (0, react.useMemo)(() => ({
				copyLabel: t("code.copy"),
				copiedLabel: t("code.copied")
			}), [t]);
			const actionsRef = (0, react.useRef)({
				readTranscript,
				readActivity,
				sendPrompt,
				refresh
			});
			actionsRef.current = {
				readTranscript,
				readActivity,
				sendPrompt,
				refresh
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				const { refresh } = actionsRef.current;
				refresh(sessionId);
			}, [open, sessionId]);
			const CATALOG_REFRESH_INTERVAL_MS = 5e3;
			(0, react.useEffect)(() => {
				if (!open) return;
				const timer = setInterval(() => {
					actionsRef.current.refresh(sessionId);
				}, CATALOG_REFRESH_INTERVAL_MS);
				return () => {
					clearInterval(timer);
				};
			}, [open, sessionId]);
			const [width, setWidth] = (0, react.useState)(() => readPanelWidth() ?? 360);
			const [expanded, setExpanded] = (0, react.useState)(false);
			const panelRef = (0, react.useRef)(null);
			const widthRef = (0, react.useRef)(width);
			widthRef.current = width;
			/** Pre-expand width, restored when the expand toggle switches back. */
			const expandedRef = (0, react.useRef)(null);
			const dragRef = (0, react.useRef)(null);
			const applyDragWidth = (0, react.useCallback)((value) => {
				panelRef.current?.style.setProperty("width", `${value}px`);
			}, []);
			const onResizePointerDown = (0, react.useCallback)((event) => {
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				expandedRef.current = null;
				const startWidth = panelRef.current?.getBoundingClientRect().width ?? widthRef.current;
				dragRef.current = {
					startX: event.clientX,
					startWidth,
					raf: null,
					pending: startWidth
				};
			}, []);
			const onResizePointerMove = (0, react.useCallback)((event) => {
				const drag = dragRef.current;
				if (drag === null) return;
				drag.pending = clampPanelWidth(drag.startWidth + drag.startX - event.clientX, window.innerWidth);
				if (drag.raf === null) drag.raf = requestAnimationFrame(() => {
					drag.raf = null;
					applyDragWidth(drag.pending);
				});
			}, [applyDragWidth]);
			const onResizePointerUp = (0, react.useCallback)(() => {
				const drag = dragRef.current;
				dragRef.current = null;
				if (drag === null) return;
				if (drag.raf !== null) {
					cancelAnimationFrame(drag.raf);
					applyDragWidth(drag.pending);
				}
				widthRef.current = drag.pending;
				setWidth(drag.pending);
				writePanelWidth(drag.pending);
			}, [applyDragWidth]);
			const onResizeDoubleClick = (0, react.useCallback)(() => {
				expandedRef.current = null;
				widthRef.current = 360;
				setWidth(360);
				setExpanded(false);
				writePanelWidth(360);
			}, []);
			const toggleExpanded = (0, react.useCallback)(() => {
				if (expandedRef.current !== null) {
					const back = expandedRef.current;
					expandedRef.current = null;
					widthRef.current = back;
					setWidth(back);
					setExpanded(false);
					writePanelWidth(back);
				} else {
					expandedRef.current = widthRef.current;
					const wide = Math.max(360, Math.floor(window.innerWidth * .75));
					widthRef.current = wide;
					setWidth(wide);
					setExpanded(true);
				}
			}, []);
			(0, react.useEffect)(() => () => {
				const drag = dragRef.current;
				if (drag !== null && drag.raf !== null) cancelAnimationFrame(drag.raf);
			}, []);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "e") {
						event.preventDefault();
						toggleSidechainPanel();
					}
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, []);
			const address = (0, react.useMemo)(() => {
				if (selected === void 0) return void 0;
				const row = rows.find((candidate) => candidate.kind === "child" && candidate.id === selected);
				const mode = row?.kind === "child" ? row.mode : selectedMode === void 0 ? void 0 : "continuable";
				return mode === void 0 ? void 0 : {
					parentSessionId: sessionId,
					childSessionId: selected,
					mode
				};
			}, [
				selected,
				rows,
				selectedMode,
				sessionId
			]);
			const selectedRow = selected === void 0 ? void 0 : rows.find((candidate) => candidate.id === selected);
			const selectedChild = selectedRow !== void 0 && selectedRow.kind === "child" ? selectedRow : void 0;
			const summaryRunning = selected === void 0 ? void 0 : summaries[selected]?.running;
			const selectedActivity = resolveChildActivity({
				catalogState: catalog?.state ?? "absent",
				catalogActivity: selectedChild?.activity,
				summaryRunning
			});
			const selectedRunning = selectedActivity === "running";
			const addressKey = address === void 0 ? void 0 : `${address.parentSessionId}:${address.childSessionId}:${address.mode}`;
			const addressRef = (0, react.useRef)(address);
			addressRef.current = address;
			const openRef = (0, react.useRef)(open);
			openRef.current = open;
			const runningRef = (0, react.useRef)(selectedRunning);
			runningRef.current = selectedRunning;
			const [transcript, setTranscript] = (0, react.useState)(null);
			const [produced, setProduced] = (0, react.useState)([]);
			const childCwd = selected === void 0 ? void 0 : summaries[selected]?.cwd;
			const fileMentions = (0, react.useMemo)(() => fileMentionsFor(produced, childCwd, openPath), [
				produced,
				childCwd,
				openPath
			]);
			const [transcriptState, setTranscriptState] = (0, react.useState)("loading");
			const fetchEpoch = (0, react.useRef)(0);
			const fetchInFlight = (0, react.useRef)(false);
			const pendingFinalRead = (0, react.useRef)(void 0);
			const request = (0, react.useCallback)((target, showLoading, final = false) => {
				if (fetchInFlight.current && final) {
					pendingFinalRead.current = target;
					return;
				}
				if (fetchInFlight.current && !showLoading) return;
				const epoch = ++fetchEpoch.current;
				if (showLoading) {
					pendingFinalRead.current = void 0;
					setTranscriptState("loading");
				}
				fetchInFlight.current = true;
				actionsRef.current.readTranscript(target).then((result) => {
					fetchInFlight.current = false;
					if (epoch !== fetchEpoch.current) return;
					setTranscript(result?.rows ?? null);
					setProduced((previous) => showLoading ? result?.produced ?? [] : mergeProduced(previous, result?.produced ?? []));
					setTranscriptState(result === null ? "error" : "ready");
					const pending = pendingFinalRead.current;
					pendingFinalRead.current = void 0;
					if (pending !== void 0) request(pending, false);
				});
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				const target = addressRef.current;
				if (target !== void 0) request(target, true);
			}, [
				open,
				addressKey,
				request
			]);
			(0, react.useEffect)(() => {
				const timer = setInterval(() => {
					if (!openRef.current || !runningRef.current) return;
					const target = addressRef.current;
					if (target !== void 0) request(target, false);
				}, LIVE_POLL_INTERVAL_MS);
				return () => {
					clearInterval(timer);
				};
			}, [request]);
			const runningRows = (0, react.useMemo)(() => rows.filter((row) => row.kind === "child" && row.activity === "running"), [rows]);
			const runningIds = (0, react.useMemo)(() => runningRows.map((row) => row.id), [runningRows]);
			const runningIdsRef = (0, react.useRef)(runningIds);
			runningIdsRef.current = runningIds;
			const runningRowsRef = (0, react.useRef)(runningRows);
			runningRowsRef.current = runningRows;
			const sessionIdRef = (0, react.useRef)(sessionId);
			sessionIdRef.current = sessionId;
			const [activity, setActivity] = (0, react.useState)({});
			const activityEpoch = (0, react.useRef)(/* @__PURE__ */ new Map());
			const activityInFlight = (0, react.useRef)(false);
			const pollActivity = (0, react.useCallback)(() => {
				if (!openRef.current || document.hidden) return;
				const targets = runningRowsRef.current;
				if (targets.length === 0) return;
				if (activityInFlight.current) return;
				const { readActivity } = actionsRef.current;
				activityInFlight.current = true;
				readActivityRound(targets.map((row) => {
					const epoch = (activityEpoch.current.get(row.id) ?? 0) + 1;
					activityEpoch.current.set(row.id, epoch);
					return {
						row,
						epoch
					};
				}), ({ row }) => readActivity({
					parentSessionId: sessionIdRef.current,
					childSessionId: row.id,
					mode: row.mode
				}), ({ row, epoch }, line) => {
					if (activityEpoch.current.get(row.id) === epoch) setActivity((previous) => previous[row.id] === line ? previous : {
						...previous,
						[row.id]: line
					});
				}).finally(() => {
					activityInFlight.current = false;
				});
			}, []);
			(0, react.useEffect)(() => {
				const timer = setInterval(() => {
					pollActivity();
				}, ACTIVITY_POLL_INTERVAL_MS);
				return () => {
					clearInterval(timer);
				};
			}, [pollActivity]);
			(0, react.useEffect)(() => {
				if (open) pollActivity();
			}, [
				open,
				runningIds,
				pollActivity
			]);
			(0, react.useEffect)(() => {
				setActivity((previous) => {
					const active = new Set(runningIds);
					const keys = Object.keys(previous);
					if (keys.length === runningIds.length && keys.every((key) => active.has(key))) return previous;
					const next = {};
					for (const key of keys) if (active.has(key) && previous[key] !== void 0) next[key] = previous[key];
					return next;
				});
			}, [runningIds]);
			const settleGuard = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => {
				if (selected === void 0) {
					settleGuard.current = void 0;
					return;
				}
				const previous = settleGuard.current;
				settleGuard.current = {
					id: selected,
					activity: selectedActivity
				};
				if (previous === void 0 || previous.id !== selected) return;
				if (selectedActivity === "inactive" && (previous.activity === "running" || previous.activity === "unknown")) {
					const target = addressRef.current;
					if (target !== void 0) request(target, false, true);
					const el = transcriptRef.current;
					if (el !== null && !prefersReducedMotion()) el.animate([{ opacity: .7 }, { opacity: 1 }], {
						duration: 260,
						easing: "ease-out"
					});
				}
			}, [
				selected,
				selectedActivity,
				request
			]);
			const transcriptRef = (0, react.useRef)(null);
			const nearBottomRef = (0, react.useRef)(true);
			const onTranscriptScroll = (0, react.useCallback)(() => {
				const el = transcriptRef.current;
				if (el === null) return;
				nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
			}, []);
			(0, react.useEffect)(() => {
				const el = transcriptRef.current;
				if (el !== null && nearBottomRef.current) el.scrollTop = el.scrollHeight;
			}, [transcript]);
			const [draft, setDraft] = (0, react.useState)("");
			const [sendFailed, setSendFailed] = (0, react.useState)(false);
			const sendEpoch = (0, react.useRef)(0);
			const send = (0, react.useCallback)(async () => {
				const target = addressRef.current;
				if (target === void 0 || target.mode !== "continuable") return;
				const text = draft.trim();
				if (text === "") return;
				setSendFailed(false);
				const epoch = ++sendEpoch.current;
				const ok = await actionsRef.current.sendPrompt({
					parentSessionId: target.parentSessionId,
					childSessionId: target.childSessionId,
					mode: "continuable"
				}, text);
				if (epoch !== sendEpoch.current) return;
				if (!ok) {
					setSendFailed(true);
					setDraft(text);
					return;
				}
				setDraft("");
				request(target, false);
			}, [draft, request]);
			const loading = catalog === void 0 || catalog.state === "loading" && rows.length === 0;
			const empty = catalog !== void 0 && catalog.state === "ready" && rows.length === 0;
			const panelTransform = entered ? "translateX(0)" : "translateX(100%)";
			const panelOpacity = entered ? 1 : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: mounted && typeof document !== "undefined" && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				ref: panelRef,
				className: "dsh-sidechain-panel",
				style: {
					...styles.panel,
					width,
					transform: panelTransform,
					opacity: panelOpacity
				},
				role: "complementary",
				"aria-label": t("panel.title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.resizer,
						title: t("panel.resize"),
						role: "separator",
						"aria-orientation": "vertical",
						onPointerDown: onResizePointerDown,
						onPointerMove: onResizePointerMove,
						onPointerUp: onResizePointerUp,
						onDoubleClick: onResizeDoubleClick
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.header,
						children: [
							address === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.title,
								children: t("panel.title")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								style: styles.back,
								title: t("view.back"),
								"aria-label": t("view.back"),
								onClick: () => {
									selectChild(void 0);
									actionsRef.current.refresh(sessionId);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, { size: 14 }), t("view.back")]
							}),
							address === void 0 && running > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.runningCount,
								children: t("count.running", { count: running })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.iconButton,
								title: expanded ? t("panel.contract") : t("panel.expand"),
								"aria-label": expanded ? t("panel.contract") : t("panel.expand"),
								"aria-pressed": expanded,
								onClick: toggleExpanded,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFullscreenOutlineRegular, { size: 16 })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.iconButton,
								title: t("panel.refresh"),
								"aria-label": t("panel.refresh"),
								onClick: () => {
									if (address === void 0) actionsRef.current.refresh(sessionId);
									else {
										const target = addressRef.current;
										if (target !== void 0) request(target, true);
									}
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.iconButton,
								title: t("panel.close"),
								"aria-label": t("panel.close"),
								onClick: closeSidechainPanel,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 16 })
							})
						]
					}),
					address === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.body,
						children: [
							catalog !== void 0 && catalog.state === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.error,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.error") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: styles.retry,
									onClick: () => {
										actionsRef.current.refresh(sessionId);
									},
									children: t("panel.retry")
								})]
							}),
							loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.notice,
								children: t("panel.loading")
							}),
							empty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.notice,
								children: t("panel.empty")
							}),
							rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								row,
								activityText: row.kind === "child" && row.activity === "running" ? activity[row.id] : void 0,
								t,
								onSelect: (childSessionId) => {
									selectChild(childSessionId);
								}
							}, row.id))
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							display: "flex",
							flexDirection: "column",
							minHeight: 0
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								ref: transcriptRef,
								style: styles.transcript,
								onScroll: onTranscriptScroll,
								children: [
									!selectedRunning && transcriptState === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: styles.notice,
										children: t("view.loading")
									}),
									transcriptState === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.error,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("view.error") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: styles.retry,
											onClick: () => {
												const target = addressRef.current;
												if (target !== void 0) request(target, true);
											},
											children: t("panel.retry")
										})]
									}),
									transcriptState === "ready" && transcript !== null && transcript.length === 0 && !selectedRunning && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: styles.notice,
										children: t("view.empty")
									}),
									(transcript ?? []).map((row, index, all) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TranscriptRowView, {
										row,
										streaming: selectedRunning && index === all.length - 1,
										codeLabels,
										fileMentions,
										t
									}, `${row.kind}:${row.seq}:${index}`)),
									selectedRunning && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											marginTop: 8,
											color: "var(--dsw-alias-state-business-primary, #4176e6)",
											textAlign: "left",
											fontSize: 12,
											lineHeight: 1.5
										},
										children: t("view.waiting")
									})
								]
							}),
							address.mode !== "continuable" || selectedChild?.command === "btw" || selectedMode === "one-shot" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.readonly,
								children: t(address.mode === "unknown" ? "mode.unknown" : "view.readonly")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								style: styles.composer,
								onSubmit: (event) => {
									event.preventDefault();
									send();
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: styles.input,
									value: draft,
									placeholder: t("composer.placeholder"),
									"aria-label": t("composer.sendAria"),
									onChange: (event) => {
										setDraft(event.target.value);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									style: styles.sendButton,
									"aria-label": t("composer.send"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 14 })
								})]
							}),
							sendFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.error,
								children: t("view.sendFailed")
							})
						]
					})
				]
			}), document.body) });
		}
		//#endregion
		//#region src/client/panel-style.ts
		/**
		* Panel stylesheet (browser half): the CSS resources the sidechain panel needs
		* beyond inline styles — the running-row shimmer keyframes, plus the desktop
		* window-chrome carve-outs. Inline styles cover everything else, but
		* `background-clip: text` sweeps need a real stylesheet, and style rules are
		* the only way to express the `html[data-windows-titlebar]` condition, so this
		* installs a single idempotent `<style>` tag and hands back its disposer
		* (the plugin fiber removes it on unload — hot-unload discipline).
		*/
		/** The injected stylesheet body. */
		const SIDECHAIN_STYLE_CSS = `
@keyframes dsh-sidechain-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.dsh-sidechain-shimmer {
  background-image: linear-gradient(
    90deg,
    var(--dsw-static-deepseek-500, #4176e6) 0%,
    var(--dsw-static-deepseek-500, #4176e6) 40%,
    var(--dsw-static-deepseek-200, #d3e2ff) 50%,
    var(--dsw-static-deepseek-500, #4176e6) 60%,
    var(--dsw-static-deepseek-500, #4176e6) 100%
  );
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: dsh-sidechain-shimmer 1.6s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-sidechain-shimmer {
    animation: none;
    background: none;
    color: inherit;
  }
}
/* The Windows desktop shell draws a titlebar band across the top of the
   window and marks it -webkit-app-region: drag. Chromium routes pointer
   events in a drag region to the window frame, so a fixed top:0 panel put its
   header — the back button included — inside a band where no click ever
   reached the page. Start the panel below that band, exactly as the host's own
   top-anchored overlays do, and carve the panel out of any remaining drag
   area. The height variable is 0 (or absent) outside that shell. */
.dsh-sidechain-panel {
  -webkit-app-region: no-drag;
}
html[data-windows-titlebar] .dsh-sidechain-panel {
  --dsh-sidechain-panel-top: var(--dsh-windows-titlebar-height, 0px);
}
`;
		/** The stylesheet's fixed element id (also the double-apply guard). */
		const SIDECHAIN_STYLE_ID = "dsh-sidechain-panel-style";
		/**
		* Install the panel stylesheet once. Re-applying while a tag already exists
		* (a double apply in one page) is a no-op; the returned disposer removes the
		* tag the installer owns. Non-DOM environments (unit tests) get a no-op.
		* @returns the disposer removing the stylesheet.
		*/
		function installSidechainStyle() {
			if (typeof document === "undefined") return () => {};
			if (document.getElementById("dsh-sidechain-panel-style") !== null) return () => {};
			const style = document.createElement("style");
			style.id = SIDECHAIN_STYLE_ID;
			style.textContent = SIDECHAIN_STYLE_CSS;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		//#endregion
		//#region src/client/locales.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "sidechain";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"panel.title": "侧链",
			"panel.toggle": "侧链：/side 与 /btw 子代理",
			"panel.close": "关闭侧链面板",
			"panel.refresh": "刷新侧链",
			"panel.expand": "展开面板（约 75% 屏宽）",
			"panel.contract": "还原面板宽度",
			"panel.resize": "拖动调整宽度（双击复位）",
			"panel.empty": "暂无侧会话，试试 /side 或 /btw",
			"panel.loading": "正在加载侧会话…",
			"panel.error": "无法加载侧会话",
			"panel.retry": "重试",
			"count.running": "{count} 个正在运行",
			"code.copy": "复制",
			"code.copied": "已复制",
			"mode.oneShot": "/btw 一次性",
			"mode.continuable": "/side 可续聊",
			"mode.unknown": "未知会话类型（只读）",
			"activity.running": "正在运行",
			"activity.inactive": "已结束",
			"diagnostic.corrupt": "会话记录损坏",
			"diagnostic.unsupported": "子代理记录版本不受支持",
			"diagnostic.unavailable": "会话记录暂不可用",
			"row.open": "打开子代理 {label}",
			"view.back": "返回列表",
			"view.readonly": "一次性侧问（不可续聊）",
			"view.empty": "暂无消息",
			"view.waiting": "Deep diving...",
			"view.loading": "正在加载对话…",
			"view.error": "无法加载对话",
			"view.sendFailed": "发送失败",
			"view.reasoning": "思考",
			"view.context": "上下文",
			"view.contextRecall": "上下文回忆",
			"composer.placeholder": "继续侧聊…（Enter 发送）",
			"composer.send": "发送",
			"composer.sendAria": "发送消息到侧会话"
		};
		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			"panel.title": "Sidechain",
			"panel.toggle": "Sidechain: /side & /btw subagents",
			"panel.close": "Close sidechain panel",
			"panel.refresh": "Refresh sidechain",
			"panel.expand": "Expand panel (~75% of screen)",
			"panel.contract": "Restore panel width",
			"panel.resize": "Drag to resize (double-click to reset)",
			"panel.empty": "No side conversations yet — try /side or /btw",
			"panel.loading": "Loading side conversations…",
			"panel.error": "Failed to load side conversations",
			"panel.retry": "Retry",
			"count.running": "{count} running",
			"code.copy": "Copy",
			"code.copied": "Copied",
			"mode.oneShot": "/btw one-shot",
			"mode.continuable": "/side continuable",
			"mode.unknown": "Unknown session type (read-only)",
			"activity.running": "Running",
			"activity.inactive": "Finished",
			"diagnostic.corrupt": "Corrupted session record",
			"diagnostic.unsupported": "Unsupported subagent record version",
			"diagnostic.unavailable": "Session record temporarily unavailable",
			"row.open": "Open subagent {label}",
			"view.back": "Back to list",
			"view.readonly": "One-shot side question (no follow-up)",
			"view.empty": "No messages yet",
			"view.waiting": "Deep diving...",
			"view.loading": "Loading conversation…",
			"view.error": "Failed to load conversation",
			"view.sendFailed": "Send failed",
			"view.reasoning": "Think",
			"view.context": "Context",
			"view.contextRecall": "Context recall",
			"composer.placeholder": "Continue side chat… (Enter to send)",
			"composer.send": "Send",
			"composer.sendAria": "Send message to side conversation"
		};
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-sidechain";
		const inject = [
			"slots",
			"sessions",
			"locale",
			"remote",
			"remote.session",
			"remote.subagents"
		];
		function apply(ctx) {
			const sessions = ctx.sessions;
			const subagents = ctx.remote.subagents;
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-sidechain: sidechain dictionaries");
			ctx.effect(installSidechainStyle, "dsh-sidechain: panel stylesheet");
			ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
				name: "conversation.chat.commandview",
				key: "side"
			}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideCommandCard, { node: props.node })));
			ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
				name: "conversation.chat.commandview",
				key: "btw"
			}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideCommandCard, { node: props.node })));
			const panelInject = (_parentSessionId) => ({
				readTranscript(address) {
					return fetchTranscript(ctx.remote.session, address);
				},
				readActivity(address) {
					return fetchActivity(ctx.remote.session, address);
				},
				sendPrompt(address, text) {
					return sendPrompt(subagents, address, text);
				},
				refresh(parentSessionId) {
					sessions.refreshProjections(parentSessionId);
				},
				openPath(path) {
					ctx.remote.session.openWorkspacePath({ path }).catch(() => {});
				}
			});
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "sidechain-panel-host",
				order: 30,
				locale: NS,
				inject: panelInject
			}, SidechainPanel));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "sidechain-panel-toggle",
				order: 20,
				locale: NS
			}, SidechainPanelToggle));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
