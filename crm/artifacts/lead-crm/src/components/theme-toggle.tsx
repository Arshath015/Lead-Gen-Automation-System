import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeContext } from "@/context/theme-context";

export function ThemeToggle() {
  const { theme, toggle } = useThemeContext();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
