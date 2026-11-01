// Apply the saved appearance before the first paint, under the production CSP.
try {
  const theme = JSON.parse(localStorage.getItem("an2-theme")) === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "light" ? "#f5f7f8" : "#0c1116";
} catch {}
