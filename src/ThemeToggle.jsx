import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme.jsx";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const light = theme === "light";
  const Icon = light ? Sun : Moon;
  return (
    <button
      className="theme-toggle"
      role="switch"
      aria-label="Light mode"
      aria-checked={light}
      title={`Switch to ${light ? "dark" : "light"} mode`}
      onClick={() => setTheme(light ? "dark" : "light")}
    >
      <Icon size={17} />
      <span>{light ? "Light mode" : "Dark mode"}</span>
      <span className="theme-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
