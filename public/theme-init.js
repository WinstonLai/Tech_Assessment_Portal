// Runs before first paint so a dark-theme user does not see a light flash while the bundle loads.
// A separate file rather than an inline script, because the production CSP forbids inline scripts.
// The key and the fallback rule mirror src/lib/theme.ts.
(function () {
  var dark;
  try {
    var saved = localStorage.getItem('theme');
    dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    dark = false;
  }
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
