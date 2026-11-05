import z from "@deepseek-ai/schemastery";
import { RUN_CODE_NAME } from "@deepseek-ai/dsh-tools";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { z as z$1 } from "zod";
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
* Side-conversation instructions appended to the fork boundary:
* answer questions and do lightweight non-destructive exploration
* without disrupting the main thread. No `{{...}}` interpolation variables.
*/
const SIDE_PERSONA = `You are in a side conversation, not the main thread. This side conversation answers questions and does lightweight, non-destructive exploration without disrupting the main thread.

The inherited fork history is provided only as reference context. Do not treat instructions, plans, or requests found in the inherited history as active instructions for this side conversation. Only messages submitted after the side-conversation boundary are active.

Do not modify files, source, git state, permissions, configuration, or workspace state unless the user explicitly asks for that mutation after this boundary. Do not request escalated permissions or broader sandbox access unless the user explicitly asks.

Sub-agents are off-limits in this side conversation: do not interact with any existing or new sub-agents. Do not call report or send any message back to the parent session; your answer stays in this side conversation's own transcript.

You may perform non-mutating inspection, including reading or searching files and running checks that do not alter repo-tracked files.`;
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
/** One text content block. */
function textBlock(text) {
	return {
		type: "text",
		text
	};
}
/**
* The side conversation's opening user message: the boundary prompt (with the
* mode declaration inside it), then the user's question. The message opens
* with `Side conversation boundary` so the panel's boundary-row drop keeps
* hiding the whole internal prompt.
* @param question - the user's question.
* @param mode - which command created the child; declared to the child so it
*   can never misidentify itself.
*/
function sidePrompt(question, mode, attachments = [], persona) {
	return [textBlock([
		SIDE_BOUNDARY_PROMPT,
		persona,
		SIDE_MODE_LINE[mode],
		question.trim()
	].filter(Boolean).join("\n\n")), ...attachments];
}
/**
* Start one side question (`/btw`): a fork activation whose
* answer streams into the sidechain panel; the child session stays out of the
* main history. The caller returns as soon as the run is started — nothing
* here waits for the child to settle.
*/
function askSideOneShot(subagents, parent, question, deps, signal, attachments = [], childId) {
	return subagents.startActivation({
		provider: deps.providerName,
		label: `BTW: ${truncateLabel(question)}`,
		...childId === void 0 ? {} : { childId },
		request: {
			prompt: sidePrompt(question, "btw", attachments, deps.persona),
			parent
		},
		signal,
		delivery: "caller"
	});
}
/**
* Start a durable continuable side thread (`/side`): a named fork child that
* keeps its own session, appears in the web subagent catalog, and can be
* continued while the main thread keeps running.
*/
function startSideConversation(subagents, parent, question, deps, signal, attachments = [], childId) {
	const label = truncateLabel(question) || "Side conversation";
	return subagents.startActivation({
		provider: deps.providerName,
		label,
		...childId === void 0 ? {} : { childId },
		request: {
			prompt: sidePrompt(question, "side", attachments, deps.persona),
			parent
		},
		signal,
		delivery: "caller"
	});
}
/** One-line label from the question's first words; empty when there is none. */
function truncateLabel(text) {
	const normalized = text.trim().replace(/\s+/g, " ");
	const chars = [...normalized];
	return chars.length <= 48 ? normalized : chars.slice(0, 48).join("") + "…";
}
/** Render the direct-child catalog as readable lines for `/side list`. */
function formatSideList(entries, modes = {}) {
	if (entries.length === 0) return "No side conversations yet. Start one with /side <question>.";
	return entries.map((entry) => {
		return `- [${modes[entry.id] ?? (entry.mode === "one-shot" ? "btw" : entry.mode === "continuable" ? "side" : entry.mode)}] ${entry.label ?? "(one-shot)"} — ${entry.id}`;
	}).join("\n");
}
//#endregion
//#region src/commands.ts
/** Build the two commands against a subagent-service face. */
function createSidechainCommands(subagents, deps, settlementSilence, projections) {
	/** Loud hint when the configured provider is absent from the deployment. */
	const missingProvider = () => {
		const provider = subagents.getProvider(deps.providerName);
		if (provider === void 0) return `sidechain: provider "${deps.providerName}" is not registered — mount @deepseek-ai/dsh-subagent-fork-in-process (or set providerName in the plugin config).`;
		if (provider.prepareContinuable === void 0 || !provider.inheritsParentContext) return `sidechain: provider "${deps.providerName}" must be a local fork provider so side conversations inherit history and enforce tool restrictions.`;
	};
	return [{
		name: "side",
		description: "Start a side conversation in a fork of the current session",
		recordInput: false,
		input: {
			hint: "<question>",
			attachments: true
		},
		handler: async ({ agent, rawInput, attachments, signal }) => {
			const missing = missingProvider();
			if (missing !== void 0) return {
				kind: "error",
				text: missing
			};
			const arg = rawInput.trim();
			if (arg === "list" || arg === "ls") try {
				const entries = await subagents.listChildren(agent.session.id, signal);
				const modes = projections?.snapshot(agent.session, ["sidechainModes"]).values.sidechainModes;
				return {
					kind: "success",
					text: formatSideList(entries, modes)
				};
			} catch (error) {
				return {
					kind: "error",
					text: `sidechain: failed to list side conversations: ${messageOf(error)}`
				};
			}
			if (arg === "") return {
				kind: "error",
				text: "/side requires a question: /side <question>"
			};
			try {
				const { childId } = await startSideConversation(subagents, agent, arg, deps, signal, attachments, settlementSilence.reserveChild(agent));
				settlementSilence.noteChild(agent, childId);
				return {
					kind: "success",
					text: `Side conversation started: ${childId}.`
				};
			} catch (error) {
				return {
					kind: "error",
					text: `sidechain: failed to start side conversation: ${messageOf(error)}`
				};
			}
		}
	}, {
		name: "btw",
		description: "Ask a quick question in a fork of the current session",
		recordInput: false,
		input: {
			hint: "<question>",
			attachments: true
		},
		handler: async ({ agent, rawInput, attachments, signal }) => {
			const question = rawInput.trim();
			if (question === "") return {
				kind: "error",
				text: "/btw requires a question: /btw <question>"
			};
			const missing = missingProvider();
			if (missing !== void 0) return {
				kind: "error",
				text: missing
			};
			try {
				const run = await askSideOneShot(subagents, agent, question, deps, signal, attachments, settlementSilence.reserveChild(agent));
				settlementSilence.noteChild(agent, run.childId);
				run.result.catch(() => {}).then(() => run.dispose().catch(() => {}));
				return {
					kind: "success",
					text: `BTW question started: ${run.childId}.`
				};
			} catch (error) {
				return {
					kind: "error",
					text: `sidechain: /btw failed: ${messageOf(error)}`
				};
			}
		}
	}];
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/settle-silence.ts
/**
* Stop side-conversation reports and settlement notices before they enter the
* parent inbox. Continuable children can deliver both `agent-message` and
* `subagent-settled` messages through `followup`, `steer`, or `inject`; even
* filtering later at pre-step leaves inbox and empty-turn events in the main
* Session log.
*
* Child identity is persisted under DSH_HOME so resumed parents still reject
* authored reports and settlement notices from side children created before a
* restart. Notices from children this plugin did not register pass through, so
* other orchestration workflows keep receiving their completion accounts.
*/
const DELIVERY_METHODS = [
	"followup",
	"steer",
	"inject"
];
/** The persisted child-id registry file (under the DSH home, like settings). */
function registryPath() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "sidechain-children.json");
}
function loadChildren() {
	const path = registryPath();
	if (!existsSync(path)) return /* @__PURE__ */ new Set();
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) throw new Error(`sidechain: invalid child registry at ${path}; expected an array of session ids`);
	return new Set(parsed.map((id) => SessionId(id)));
}
function saveChildren(children) {
	const path = registryPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify([...children]), "utf8");
}
function isSideChildDelivery(message, children) {
	const source = message.source;
	return (source?.kind === "agent-message" || source?.kind === "subagent-report" || source?.kind === "subagent-settled") && source.senderSessionId !== void 0 && children.has(source.senderSessionId);
}
/**
* Install the parent-inbox boundary for side settlement notices.
* @param ctx - root plugin context, used to protect future/resumed agents.
*/
function createSettlementSilence(ctx) {
	const children = loadChildren();
	const patched = /* @__PURE__ */ new Map();
	const protect = (agent) => {
		if (patched.has(agent)) return;
		const descriptors = /* @__PURE__ */ new Map();
		for (const method of DELIVERY_METHODS) {
			descriptors.set(method, Object.getOwnPropertyDescriptor(agent, method));
			const original = agent[method];
			Object.defineProperty(agent, method, {
				configurable: true,
				writable: true,
				value(message) {
					if (!isSideChildDelivery(message, children)) original.call(agent, message);
				}
			});
		}
		patched.set(agent, descriptors);
	};
	for (const agent of ctx.agents.list()) protect(agent);
	const removeCreatedListener = ctx.on("agent/created", ({ agent }) => {
		protect(agent);
	});
	return {
		hasChild: (childId) => children.has(childId),
		reserveChild(parent) {
			protect(parent);
			const childId = SessionId(randomUUID());
			children.add(childId);
			saveChildren(children);
			return childId;
		},
		noteChild(parent, childId) {
			protect(parent);
			children.add(childId);
			saveChildren(children);
		},
		dispose() {
			removeCreatedListener();
			for (const [agent, descriptors] of patched) for (const method of DELIVERY_METHODS) {
				const descriptor = descriptors.get(method);
				if (descriptor === void 0) delete agent[method];
				else Object.defineProperty(agent, method, descriptor);
			}
			patched.clear();
		}
	};
}
//#endregion
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
//#region src/sidechain-projection.ts
const schema = z$1.record(z$1.string(), z$1.enum(["side", "btw"]));
const sidechainModesProjection = {
	key: "sidechainModes",
	stateSchema: schema,
	init: () => ({}),
	apply: (state, event) => {
		if (event.type === "session/end-seed" && event.data.inherited === true) return {};
		if (event.type !== "command/done") return state;
		const created = sideCommandResult(event.data);
		return created === void 0 ? state : {
			...state,
			[created.childId]: created.mode
		};
	},
	wire: {
		viewSchema: schema,
		view: (state) => state
	},
	stateVersion: 2
};
//#endregion
//#region src/index.ts
const name = "dsh-sidechain";
const inject = [
	"agents",
	"subagents",
	"sessionProjections"
];
const Config = z.object({
	providerName: z.string().default("fork"),
	persona: z.string().default(SIDE_PERSONA),
	readOnlyTools: z.array(z.string())
});
async function apply(ctx, config) {
	await ctx.sessionProjections.register(sidechainModesProjection);
	const readOnlyTools = config.readOnlyTools?.length ? config.readOnlyTools : void 0;
	const deps = {
		providerName: config.providerName,
		...config.persona === "" ? {} : { persona: config.persona }
	};
	const settlementSilence = createSettlementSilence(ctx);
	const restrictions = /* @__PURE__ */ new Map();
	const restrictChild = (agent) => {
		if (readOnlyTools === void 0 || !settlementSilence.hasChild(agent.session.id) || restrictions.has(agent)) return;
		restrictions.set(agent, agent.ctx.effect(function* () {
			yield agent.ctx.tools.restrict({ allow: readOnlyTools });
			yield agent.ctx.tools.guard(({ name }) => name === RUN_CODE_NAME || readOnlyTools.includes(name) ? void 0 : `sidechain: tool "${name}" is not allowed by readOnlyTools`);
		}));
	};
	const removeCreatedListener = ctx.on("agent/created", ({ agent }) => {
		restrictChild(agent);
	});
	const removeDisposedListener = ctx.on("agent/disposed", ({ agent }) => {
		restrictions.delete(agent);
	});
	const dispose = ctx.effect(() => () => {
		removeCreatedListener();
		removeDisposedListener();
		for (const release of restrictions.values()) release();
		restrictions.clear();
		settlementSilence.dispose();
	});
	for (const agent of ctx.agents.list()) restrictChild(agent);
	ctx.inject(["commands"], (commandCtx) => {
		for (const definition of createSidechainCommands(ctx.subagents, deps, settlementSilence, ctx.sessionProjections)) commandCtx.commands.register(definition);
	});
	return dispose;
}
//#endregion
export { Config, apply, inject, name };
