// Clickjacking defence. GitHub Pages cannot send X-Frame-Options and a <meta> CSP ignores frame-ancestors, so
// refuse to render when the page is embedded in another site. An external file because the CSP forbids inline scripts.
(function () {
  try {
    if (window.top === window.self) return;
  } catch (e) {
    /* reading window.top threw: we are framed by another origin */
  }
  document.documentElement.style.display = 'none';
  try {
    window.top.location = window.self.location;
  } catch (e) {
    /* cross-origin navigation can be blocked by the embedder; the page stays hidden */
  }
})();
