import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "../store/themeStore.js";

export default function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const isDark = theme === "dark";
  const label = `Switch to ${isDark ? "light" : "dark"} mode`;

  return (
    <Button variant="ghost" size="icon" type="button" onClick={toggleTheme} aria-label={label} title={label}>
      {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
