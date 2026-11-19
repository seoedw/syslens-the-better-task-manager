'use strict';
// Runs before the first paint. The server writes the saved theme onto <html>; this resolves
// "auto" against Windows' light/dark setting, so a light or black theme never flashes dark.
(() => {
  const root = document.documentElement;
  const pref = root.dataset.prefTheme || 'auto';
  const dark = !window.matchMedia || matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = pref === 'auto' ? (dark ? 'dark' : 'light') : pref;
})();
