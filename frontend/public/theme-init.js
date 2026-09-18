/* Runs before first paint, from <head>.
 *
 * The chosen theme used to be applied by the app bundle, which arrives after
 * the page has already been painted with the dark floor: a visitor in the light
 * theme saw a black screen until the bundle loaded — seconds on a phone, and the
 * whole screen on client-rendered pages like /login. A separate file rather than
 * an inline script because the site's CSP allows scripts from 'self' only.
 * Keep the key in step with src/lib/siteTheme.ts. */
(function () {
  var theme = "dark";
  try {
    if (localStorage.getItem("bc_site_theme") === "light") theme = "light";
  } catch (e) {
    /* Private mode or blocked storage: the default theme. */
  }
  document.documentElement.setAttribute("data-site-theme", theme);
})();
