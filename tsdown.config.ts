/**
 * tsdown preset for dsh-sidechain: an ESM node half with declarations plus a
 * browser half (lib/client.js) wrapped for the harness client-plugin loader.
 * The node half keeps Schemastery unbundled because the Loader validates the
 * plugin's `Config` schema and must see its own Schemastery instance; the
 * browser half keeps the platform module table external (React, Cordis,
 * loader seeds) and
 * bundles everything else inline.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const pluginManifest = JSON.parse(readFileSync(new URL('./dsh.plugin.json', import.meta.url), 'utf8'))
assert.equal(packageManifest.version, pluginManifest.engines.dsh, 'Sidechain version must match its supported DSH version')
assert.equal(pluginManifest.version, packageManifest.version, 'Plugin and package versions must match')

const PLUGIN_ID = '@dsh-external/dsh-sidechain'

/** Module specifiers the dsh web shell shares into its frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/** Externals resolved from the loader module table. */
const CLIENT_EXTERNALS: readonly string[] = [
  ...PLATFORM_MODULES,
  '@deepseek-ai/dsh-api-gateway/client',
  '@deepseek-ai/dsh-api-remotes/client',
  '@deepseek-ai/dsh-api-session-controller/client',
  '@deepseek-ai/dsh-api-workspace-controller/client',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-ui-chat/client',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-ui-session/client',
  '@deepseek-ai/dsh-client-ui-workspace/client',
  '@deepseek-ai/dsh-subagent/client',
]

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      // Schemastery stays unbundled because the Loader validates the plugin's
      // `Config` schema and must see its own Schemastery instance; Cordis is
      // type-only in this bundle. The runtime packages resolve from the profile
      // so the plugin shares the deployment's own instances.
      neverBundle: [
        '@deepseek-ai/schemastery',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-llm',
        '@deepseek-ai/dsh-util-values',
      ],
    },
  },
  {
    // Browser bundle: lib/client.js, served by the harness at /plugins/<id>/client.js.
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: ['@deepseek-ai/dsh-llm/assistant-stream'],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: `return module.exports; } });`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
