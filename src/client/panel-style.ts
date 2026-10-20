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
export const SIDECHAIN_STYLE_CSS = `
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
`

/** The stylesheet's fixed element id (also the double-apply guard). */
export const SIDECHAIN_STYLE_ID = 'dsh-sidechain-panel-style'

/**
 * Install the panel stylesheet once. Re-applying while a tag already exists
 * (a double apply in one page) is a no-op; the returned disposer removes the
 * tag the installer owns. Non-DOM environments (unit tests) get a no-op.
 * @returns the disposer removing the stylesheet.
 */
export function installSidechainStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(SIDECHAIN_STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = SIDECHAIN_STYLE_ID
  style.textContent = SIDECHAIN_STYLE_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
