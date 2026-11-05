import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
declare const name = "dsh-sidechain";
declare const inject: string[];
/** Plugin config: deployment-varying behavior, validated from cordis.yml. */
interface Config {
  /** Provider name on `ctx.subagents`; the fork backend registers as `fork`. */
  providerName: string;
  /** Side-conversation instructions appended to the opening boundary message. */
  persona: string;
  /** Optional allow-list of tool names kept visible in side conversations. */
  readOnlyTools?: string[];
}
declare const Config: z<Config>;
declare function apply(ctx: Context, config: Config): Promise<() => void>;
//#endregion
export { Config, apply, inject, name };