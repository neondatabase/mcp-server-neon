export const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

export const INTERACTION_SCRIPT = `(function(){
var tabs=Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
function select(tab){
  tabs.forEach(function(t){
    var on=t===tab;
    t.setAttribute('aria-selected',String(on));
    t.tabIndex=on?0:-1;
    document.getElementById(t.getAttribute('aria-controls')).hidden=!on;
  });
  tab.focus();
  tab.scrollIntoView({block:'nearest',inline:'nearest'});
}
tabs.forEach(function(tab,i){
  tab.addEventListener('click',function(){select(tab);});
  tab.addEventListener('keydown',function(e){
    var next={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:tabs.length-1}[e.key];
    if(next===undefined)return;
    e.preventDefault();
    select(tabs[(next+tabs.length)%tabs.length]);
  });
});
var copyIcon=${JSON.stringify(COPY_ICON)},checkIcon=${JSON.stringify(CHECK_ICON)};
document.addEventListener('click',function(e){
  var btn=e.target.closest('.copy-btn');
  if(!btn||!navigator.clipboard)return;
  navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(function(){
    btn.classList.add('copied');btn.innerHTML=checkIcon;
    setTimeout(function(){btn.classList.remove('copied');btn.innerHTML=copyIcon;},2000);
  });
});
})();`;
