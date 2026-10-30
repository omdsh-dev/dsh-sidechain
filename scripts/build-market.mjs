import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const commit = git('rev-parse', 'HEAD')
const manifest = JSON.parse(git('show', `${commit}:package.json`))
const pluginManifest = JSON.parse(git('show', `${commit}:dsh.plugin.json`))
assert.equal(manifest.version, manifest.devDependencies['@deepseek-ai/dsh-agent'], 'Sidechain version must match its target DSH version')
assert.equal(pluginManifest.version, manifest.version, 'Plugin version must match the package')
assert.equal(pluginManifest.engines.dsh, manifest.engines.dsh, 'Plugin DSH requirement must match the package')
assert.ok(!manifest.scripts.prepare, 'Git market packages must ship built files without prepare')
const locales = ['en', 'zh'].map(language => [
  language, JSON.parse(git('show', `${commit}:locale/${language}.json`)).meta,
])
const title = Object.fromEntries(locales.map(([language, meta]) => [language, meta.title]))
const repository = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
const index = {
  format: 1,
  title,
  plugins: [{
    name: manifest.name,
    title,
    description: Object.fromEntries(locales.map(([language, meta]) => [language, meta.description])),
    icon: manifest.icon,
    author: manifest.author,
    homepage: manifest.homepage,
    repository: { url: repository },
    metadata: { keywords: manifest.keywords },
    versions: [{
      version: manifest.version,
      publishTimestamp: Number(git('show', '-s', '--format=%ct', commit)),
      source: { type: 'git', url: repository, commit },
      engines: { dsh: manifest.engines.dsh },
    }],
  }],
}
const output = new URL('../docs/', import.meta.url)
mkdirSync(output, { recursive: true })
writeFileSync(new URL('index.json', output), `${JSON.stringify(index, null, 2)}\n`)
writeFileSync(new URL(manifest.icon, output), `${git('show', `${commit}:${manifest.icon.replace(/^\.\//, '')}`)}\n`)
console.log(`Market: ${manifest.name}@${manifest.version}, commit ${commit}`)
