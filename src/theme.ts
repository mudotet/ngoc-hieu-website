import { useSyncExternalStore } from 'react';

export const palette = {
  purple: '#2A1650',
  purpleMid: '#4B2A8A',
  green: '#1F9D55',
  greenMid: '#2FBF71',
  lime: '#9AE66E',
  neon: '#B388FF',
  cream: '#FFF6E5',
  paper: '#F3E7D0',
  amber: '#F5C65B',
  ink: '#160D27',
  greenText: '#176B3A',
} as const;

export type ThemeMode = 'light' | 'dark';

export const sceneColors = {
  timber: '#8c6550', iron: '#282725', brass: '#b49a73', asphalt: '#514f50',
  mortar: '#958c7e', window: '#3c5056', ceramic: '#e9dfc9', steak: '#72412b',
  char: '#382b23', eggWhite: '#fff0cf', yolk: '#dda13f', garnish: '#637841',
  skin: '#b98766', hair: '#302824', trousers: '#393b44', shoe: '#272528',
  fur: '#a57b50', leash: '#65523e', white: '#ffffff',
  vehicle: ['#F2F0EB', '#A5A5A5', '#252329', palette.purpleMid],
  vapor: ['rgba(255,245,222,0.6)', 'rgba(255,245,222,0.22)', 'rgba(255,245,222,0)'],
} as const;

export const themeColors = {
  light: {
    surface: palette.cream, 'surface-alt': palette.paper, text: palette.purple,
    muted: palette.purpleMid, accent: palette.greenText, line: `${palette.purple}40`,
    'button-bg': palette.green, 'button-text': palette.ink, 'button-hover': palette.greenMid,
    'heading-accent': palette.purpleMid, 'overlay': `${palette.cream}F5`,
    'overlay-strong': `${palette.cream}FA`,
  },
  dark: {
    surface: palette.ink, 'surface-alt': palette.purple, text: palette.cream,
    muted: palette.paper, accent: palette.lime, line: `${palette.neon}66`,
    'button-bg': palette.lime, 'button-text': palette.ink, 'button-hover': palette.greenMid,
    'heading-accent': palette.neon, 'overlay': `${palette.ink}F5`,
    'overlay-strong': `${palette.ink}FA`,
  },
} as const;

export const sharedColors = {
  transparent: `${palette.ink}00`, 'photo-shade': `${palette.ink}CC`,
  'shadow': `${palette.ink}66`, 'shadow-soft': `${palette.ink}44`,
  'paper-line': `${palette.purple}40`, 'amber-soft': `${palette.amber}55`,
} as const;

export const themeStorageKey = 'ngoc-hieu-theme';
let mode: ThemeMode = 'dark';
const listeners = new Set<() => void>();

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[mode].surface);
  for (const [key, value] of Object.entries({ ...palette, ...sharedColors, ...themeColors[mode] })) {
    root.style.setProperty(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
  }
}

export function initializeTheme() {
  try {
    const saved = localStorage.getItem(themeStorageKey);
    mode = saved === 'light' ? 'light' : 'dark';
  } catch { mode = 'dark'; }
  applyTheme();
}

export function setTheme(next: ThemeMode) {
  mode = next;
  applyTheme();
  try { localStorage.setItem(themeStorageKey, mode); }
  catch { return; }
  finally { listeners.forEach(notify => notify()); }
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  const sync = (event: StorageEvent) => {
    if (event.key !== themeStorageKey && event.key !== null) return;
    mode = event.newValue === 'light' ? 'light' : 'dark';
    applyTheme();
    listeners.forEach(listener => listener());
  };
  window.addEventListener('storage', sync);
  return () => { listeners.delete(notify); window.removeEventListener('storage', sync); };
}

export function useTheme() {
  return [useSyncExternalStore(subscribe, () => mode, () => 'dark' as ThemeMode), setTheme] as const;
}
