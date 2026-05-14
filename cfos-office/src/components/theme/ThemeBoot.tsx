/**
 * ThemeBoot — inline script that runs in <head> before hydration so we set
 * `data-theme` on <html> *before* first paint, avoiding a flash of the wrong
 * palette. Reads `cfo-theme` from localStorage (with one-time migration from
 * the legacy `cfo-landing-theme` key), defaults to 'dark' when no explicit
 * preference is stored. prefers-color-scheme is intentionally ignored so an
 * OS-light user does not see the app flip to light mid-onboarding.
 *
 * Failures are swallowed silently (private-mode browsers etc.) and still
 * fall through to dark so first paint never lands on the light palette.
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
var theme=stored==='light'||stored==='dark'?stored:'dark';
document.documentElement.setAttribute('data-theme',theme);
}catch(e){try{document.documentElement.setAttribute('data-theme','dark');}catch(_){}}})();`

export function ThemeBoot() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
}
