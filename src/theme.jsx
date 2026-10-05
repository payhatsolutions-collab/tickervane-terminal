import { createContext, useContext, useLayoutEffect, useState } from "react";

const ThemeContext = createContext(null);
const storageKey = "an2-theme";

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "light" ? "#f4f7fb" : "#0b111a",
    );
    try {
      localStorage.setItem(storageKey, JSON.stringify(theme));
    } catch {
      // The switch still works when browser storage is unavailable.
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
