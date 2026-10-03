import { useSyncExternalStore } from 'react';
import { safeStorage } from './safeStorage';

export type Theme = 'light' | 'dark';

/** Keep in sync with public/theme-init.js, which applies the saved theme before first paint. */
export const THEME_KEY = 'theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function savedTheme(): Theme | null {
  const v = safeStorage.get(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

let current: Theme = savedTheme() ?? systemTheme();
apply(current);

function update(next: Theme): void {
  if (next === current) return;
  current = next;
  apply(next);
  listeners.forEach((l) => l());
}

export function setTheme(theme: Theme): void {
  safeStorage.set(THEME_KEY, theme);
  update(theme);
}

// Follow the OS setting until the user picks a theme themselves, and pick up a change made in another tab.
try {
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (!savedTheme()) update(systemTheme());
  });
} catch {
  /* matchMedia unavailable */
}
window.addEventListener('storage', (e) => {
  if (e.key === THEME_KEY) update(savedTheme() ?? systemTheme());
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, () => current);
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}
