/**
 * Module-scope panel visibility + selection store shared by the sidechain UI
 * pieces.
 *
 * One store serves every entry that can open or close the right panel — the
 * conversation-header toggle and the composer-mounted panel host (which
 * observes `/side` / `/btw` live settles) — so they never disagree about its
 * open state. The selection drives the panel's
 * embedded conversation view: selecting a child shows its transcript while
 * the main session stays untouched. Module scope is safe here: the browser
 * half is a single bundle, so every import site sees the same instance.
 */

import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'

/** Listener invoked on every visibility or selection transition. */
export type SidechainPanelListener = () => void

let open = false
let selected: SessionId | undefined
let selectedMode: 'one-shot' | 'continuable' | undefined
const listeners = new Set<SidechainPanelListener>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** Whether the sidechain panel is currently open. */
export function isSidechainPanelOpen(): boolean {
  return open
}

/** The child currently selected for the embedded transcript view, if any. */
export function selectedChildId(): SessionId | undefined {
  return selected
}

/** The mode of the currently selected child, when known from its command. */
export function selectedChildMode(): 'one-shot' | 'continuable' | undefined {
  return selectedMode
}

/** Open the panel (no-op when already open). */
export function openSidechainPanel(): void {
  if (open) return
  open = true
  emit()
}

/** Close the panel (no-op when already closed). */
export function closeSidechainPanel(): void {
  if (!open && selected === undefined) return
  open = false
  selected = undefined
  selectedMode = undefined
  emit()
}

/** Flip the panel between open and closed (closing also clears the selection). */
export function toggleSidechainPanel(): void {
  if (open) closeSidechainPanel()
  else openSidechainPanel()
}

/**
 * Reveal the panel with one child selected for the embedded transcript view.
 * @param childSessionId - the child to show; undefined returns to the list.
 */
export function revealChild(
  childSessionId: SessionId | undefined,
  mode?: 'one-shot' | 'continuable',
): void {
  open = true
  if (selected === childSessionId && (mode === undefined || selectedMode === mode)) return
  selected = childSessionId
  if (mode !== undefined) selectedMode = mode
  emit()
}

/** Select a child (or clear the selection) without changing the panel state. */
export function selectChild(childSessionId: SessionId | undefined): void {
  if (selected === childSessionId) return
  selected = childSessionId
  emit()
}

/**
 * Subscribe to visibility/selection transitions.
 * @param listener - called on every change.
 * @returns the disposer removing the subscription.
 */
export function subscribeSidechainPanel(listener: SidechainPanelListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test seam: reset to the initial closed, unselected state and drop all listeners. */
export function resetSidechainPanel(): void {
  open = false
  selected = undefined
  selectedMode = undefined
  listeners.clear()
}

// ---- Panel width (drag-to-resize, persisted per browser) ----

/** Default floating-panel width in px (the pre-drag fallback). */
export const PANEL_DEFAULT_WIDTH = 360
/** Hard floor for a dragged width (narrow columns are unusable). */
export const PANEL_MIN_WIDTH = 320
/** Hard ceiling for a dragged width in px (the 55% viewport cap still applies). */
export const PANEL_MAX_WIDTH = 720
/** localStorage key for the user's last dragged width. */
export const WIDTH_STORAGE_KEY = 'dsh.sidechain.width'

/**
 * Ceiling for a dragged panel width: 55% of the viewport, never beyond the
 * hard cap — the panel must never cover the whole conversation.
 * @param viewportWidth - current `window.innerWidth`.
 * @returns the maximum allowed panel width in px.
 */
export function panelMaxWidth(viewportWidth: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.floor(viewportWidth * 0.55))
}

/**
 * Clamp a candidate panel width into the allowed band.
 * @param width - raw candidate (drag arithmetic can overshoot).
 * @param viewportWidth - current viewport width.
 * @returns the clamped width, at least {@link PANEL_MIN_WIDTH}.
 */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  return Math.min(Math.max(Math.floor(width), PANEL_MIN_WIDTH), panelMaxWidth(viewportWidth))
}

/**
 * Read the persisted panel width. Storage is best-effort: an absent or
 * malformed value (or no localStorage at all) falls back to undefined.
 * @returns the stored width when it survives the structural check, else undefined.
 */
export function readPanelWidth(): number | undefined {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    if (raw === null) return undefined
    const value = Number.parseInt(raw, 10)
    if (!Number.isFinite(value) || value < PANEL_MIN_WIDTH) return undefined
    return value
  } catch {
    return undefined
  }
}

/**
 * Persist a panel width (best-effort — storage failures are silent, the
 * panel still works at the in-memory width).
 * @param width - the width to store.
 */
export function writePanelWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.floor(width)))
  } catch {
    // private mode / quota: non-fatal
  }
}
