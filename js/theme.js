// Theme selection: follow the system, or override it explicitly.
//
// The stylesheet keys off `data-theme` on <html>. Absence of the attribute
// means "follow the system", which is why 'system' clears it rather than
// setting a value.

import { getSettings, saveSettings } from './storage.js';

export const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export function getTheme() {
  const t = getSettings().theme;
  return THEMES.some((x) => x.id === t) ? t : 'system';
}

/** Write the choice to <html> without persisting it. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/** Persist the choice and apply it. */
export function setTheme(theme) {
  const next = THEMES.some((x) => x.id === theme) ? theme : 'system';
  saveSettings({ theme: next });
  applyTheme(next);
  return next;
}

/**
 * Apply the saved choice at boot. The inline script in index.html has already
 * done this to avoid a flash of the wrong theme; this re-applies it from the
 * parsed settings so the two can never disagree.
 */
export function initTheme() {
  applyTheme(getTheme());
}

/** True when no explicit choice is set and the system is currently dark. */
export function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}
