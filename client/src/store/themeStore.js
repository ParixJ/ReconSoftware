import { create } from "zustand";

const THEME_STORAGE_KEY = "reconsoft-theme";
const THEMES = new Set(["light", "dark"]);

function getInitialTheme() {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (THEMES.has(savedTheme)) return savedTheme;
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function saveTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The active theme still works for the current page when storage is blocked.
  }
}

const initialTheme = getInitialTheme();

export const useThemeStore = create((set) => ({
  theme: initialTheme,
  toggleTheme: () => set((state) => {
    const theme = state.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    saveTheme(theme);
    return { theme };
  }),
}));

export function initializeTheme() {
  applyTheme(initialTheme);
}
