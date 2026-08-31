import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "../store/themeStore.js";

export default function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const isDark = theme === "dark";
  const label = `Switch to ${isDark ? "light" : "dark"} mode`;

  return (
    <button className="icon-button theme-toggle" type="button" onClick={toggleTheme} aria-label={label} title={label}>
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
