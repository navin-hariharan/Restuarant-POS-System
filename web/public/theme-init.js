// Applies the saved (or system) colour theme before the app renders, so the
// page never flashes the wrong theme. Loaded as a file: the server's content
// security policy allows no inline scripts.
(function () {
  var dark = false;
  try {
    var saved = localStorage.getItem('theme');
    dark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (e) {}
  var root = document.documentElement;
  if (dark) root.classList.add('dark');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f172a' : '#ffffff');
})();
