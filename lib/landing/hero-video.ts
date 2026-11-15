export const HERO_VIDEO_ORIGIN = 'https://cdn.neonapi.io';

const HERO_VIDEO_PATH = `${HERO_VIDEO_ORIGIN}/public/pages/home/hero`;

export const HERO_VIDEO_HTML = `<video id="hero-video" class="hero-video" width="1920" height="832" muted loop playsinline preload="metadata" aria-hidden="true">
  <source src="${HERO_VIDEO_PATH}/hero-av1.mp4" type="video/mp4; codecs=av01.0.05M.08,opus">
  <source src="${HERO_VIDEO_PATH}/hero.mp4" type="video/mp4">
  <source src="${HERO_VIDEO_PATH}/hero.webm" type="video/webm">
</video>`;

export const HERO_VIDEO_SCRIPT = `(function(){
var v=document.getElementById('hero-video');
if(!v)return;
var still=window.matchMedia('(prefers-reduced-motion: reduce)');
var visible=true;
v.addEventListener('playing',function(){v.classList.add('ready');});
v.addEventListener('loadeddata',function(){if(still.matches)v.classList.add('ready');});
function sync(){
  if(visible&&!document.hidden&&!still.matches){var p=v.play();if(p)p.catch(function(){});}
  else v.pause();
}
new IntersectionObserver(function(entries){visible=entries[0].isIntersecting;sync();}).observe(v);
document.addEventListener('visibilitychange',sync);
still.addEventListener('change',sync);
sync();
})();`;
