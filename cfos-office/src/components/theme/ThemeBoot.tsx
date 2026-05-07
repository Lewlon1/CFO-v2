/**
 * ThemeBoot — inline script that runs in <head> before hydration so we set
 * `data-theme` on <html> *before* first paint, avoiding a flash of the wrong
 * palette. Reads `cfo-theme` from localStorage (with one-time migration from
 * the legacy `cfo-landing-theme` key), falls back to `prefers-color-scheme`.
 *
 * Failures are swallowed silently (private-mode browsers etc.).
 */
const BOOT_SCRIPT = `(function(){try{
var KEY='cfo-theme';
var LEGACY='cfo-landing-theme';
var stored=localStorage.getItem(KEY);
if(!stored){
  var legacy=localStorage.getItem(LEGACY);
  if(legacy==='light'||legacy==='dark'){
    stored=legacy;
    localStorage.setItem(KEY,legacy);
    localStorage.removeItem(LEGACY);
  }
}
var theme=stored==='light'||stored==='dark'?stored:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
document.documentElement.setAttribute('data-theme',theme);
}catch(e){}})();`

export function ThemeBoot() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
}
