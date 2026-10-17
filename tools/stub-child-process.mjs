/**
 * Local test-only preload: the DSH file sandbox rejects piped child-process
 * spawns, and Vite probes `net use` during Windows safe-realpath setup. This
 * stub answers that probe with an error, which makes Vite fall back to
 * `fs.realpathSync.native`. It is not part of the plugin and is never shipped.
 */
import cp from 'node:child_process'

const stub = (_command, _options, callback) => {
  const done = typeof _options === 'function' ? _options : callback
  queueMicrotask(() => done?.(new Error('spawn disabled in this sandbox'), '', ''))
  return { on() {}, once() {}, kill() {} }
}

cp.exec = stub
cp.execFile = stub
