'use client';

import { useEffect } from 'react';

export const DISPLAY_KEYS = { scanlines: 'ff:scanlines', reduceMotion: 'ff:reduce-motion' } as const;

/** Reads a display preference; storage can be blocked or empty, so every access is guarded. */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference lasts for this page view only */
  }
}

/** Applies the saved display preferences to <html> (scanlines off, reduced motion on). Renders nothing. */
export function applyDisplayPrefs(): void {
  const html = document.documentElement;
  if (readPref(DISPLAY_KEYS.scanlines) === 'off') html.setAttribute('data-scanlines', 'off');
  else html.removeAttribute('data-scanlines');
  if (readPref(DISPLAY_KEYS.reduceMotion) === 'on') html.setAttribute('data-reduce-motion', 'on');
  else html.removeAttribute('data-reduce-motion');
}

export function DisplayPrefs() {
  useEffect(() => {
    applyDisplayPrefs();
  }, []);
  return null;
}

export default DisplayPrefs;
