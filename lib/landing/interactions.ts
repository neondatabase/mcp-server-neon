/** The copy and check marks as neon.com draws them: square corners, 1px line. */
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4.2 13H13V4.2H4.2V13Z"/><path d="M2.6 9.8H1V1h8.8v1.6"/></svg>';

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 6l4.286 5L13 2"/></svg>';

/** Both states of a copy button; CSS shows the check while it has `.copied`. */
export const COPY_ICONS = `<span class="copy-icon">${COPY_ICON}${CHECK_ICON}</span>`;

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
    var next={ArrowRight:i+1,ArrowDown:i+1,ArrowLeft:i-1,ArrowUp:i-1,Home:0,End:tabs.length-1}[e.key];
    if(next===undefined)return;
    e.preventDefault();
    select(tabs[(next+tabs.length)%tabs.length]);
  });
});
document.addEventListener('click',function(e){
  var btn=e.target.closest('.copy-btn');
  if(!btn||!navigator.clipboard)return;
  navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(function(){
    var label=btn.querySelector('.copy-label');
    if(!btn.classList.contains('copied')){
      btn.setAttribute('data-name',btn.getAttribute('aria-label'));
      if(label){label.setAttribute('data-label',label.textContent);label.textContent='Copied';}
    }
    btn.classList.add('copied');
    btn.setAttribute('aria-label','Copied');
    btn.title='Copied';
    clearTimeout(btn.copyTimer);
    btn.copyTimer=setTimeout(function(){
      btn.classList.remove('copied');
      btn.setAttribute('aria-label',btn.getAttribute('data-name'));
      btn.title=btn.getAttribute('data-name');
      if(label)label.textContent=label.getAttribute('data-label');
    },2000);
  });
});
})();`;
