const BOOT_SCRIPT = `(function(){try{
var stored=localStorage.getItem('cfo-landing-theme');
var theme=stored==='light'||stored==='dark'?stored:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
var root=document.querySelector('.landing-v4');
if(root){root.setAttribute('data-theme',theme);}
}catch(e){}})();`

export function ThemeBoot() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
}
