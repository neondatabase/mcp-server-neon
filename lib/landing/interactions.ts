/** The copy and check marks as neon.com draws them: square corners, 1px line. */
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4.2 13H13V4.2H4.2V13Z"/><path d="M2.6 9.8H1V1h8.8v1.6"/></svg>';

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 6l4.286 5L13 2"/></svg>';

/** Both states of a copy button; CSS shows the check while it has `.copied`. */
export const COPY_ICONS = `<span class="copy-icon">${COPY_ICON}${CHECK_ICON}</span>`;

/**
 * Runs in the head, before first paint: marks that script is available, names the part the
 * address opens at (the head row reads it) and selects the client it names, so neither flashes
 * the wrong thing. Without script nothing is hidden.
 */
export const openAtAddressScript = (
  partIds: readonly string[],
  clientAnchors: readonly (readonly [anchor: string, id: string])[],
): string => `(function(){
var d=document.documentElement,h=location.hash.slice(1),parts=${JSON.stringify(partIds)},clients=${JSON.stringify(clientAnchors)},p=parts[0],c=clients[0][1];
parts.forEach(function(id){if(h===id||h.indexOf(id+'-')===0)p=id;});
clients.forEach(function(pair){if(h===pair[0])c=pair[1];});
d.classList.add('js');d.setAttribute('data-part',p);d.setAttribute('data-client',c);
})();`;

/**
 * The page reads and navigates without this: the parts are plain anchors and the jump to one is
 * the browser's. Script adds what CSS cannot: which part is in view (data-part on <html>, read by
 * the head row; the mark in the contents and in the part strip), the address following the
 * scroll, the client selector as tabs, opening the tool category an address names, and copying.
 */
export const INTERACTION_SCRIPT = `(function(){
var root=document.documentElement;
var list=function(selector){return Array.prototype.slice.call(document.querySelectorAll(selector));};
var sheets=list('.sheet');
var partLinks=list('[data-part-link]');
/* the sticky row the parts pass under: the head row on the spread, the part strip in the single
   column (the other one is not displayed) */
var stickyRows=list('.sheet-head, .bar');
var groups=list('.tool-group');
var tabs=list('[data-client-link]');
var still=window.matchMedia('(prefers-reduced-motion: reduce)');

/* the part an address belongs to; no hash is the top of the document, which is the first part */
function partOf(hash){
  var el=document.getElementById(hash.slice(1));
  var sheet=el&&el.closest('.sheet');
  return sheet?sheet.id:hash===''?sheets[0].id:'';
}

/* the client selector is a row of links until script can switch it */
var tablist=document.querySelector('[data-clients]');
if(tablist)tablist.setAttribute('role','tablist');
tabs.forEach(function(tab){
  var panel=document.getElementById(tab.hash.slice(1));
  tab.setAttribute('role','tab');
  tab.id='tab-'+tab.getAttribute('data-client-link');
  tab.setAttribute('aria-controls',panel.id);
  panel.setAttribute('role','tabpanel');
  panel.setAttribute('aria-labelledby',tab.id);
});
function selectClient(id){
  root.setAttribute('data-client',id);
  tabs.forEach(function(tab){
    var on=tab.getAttribute('data-client-link')===id;
    tab.setAttribute('aria-selected',String(on));
    tab.tabIndex=on?0:-1;
  });
}
/* a press on a tab: the procedure changes in place, the page does not move, history gets no entry */
function pressTab(tab){
  selectClient(tab.getAttribute('data-client-link'));
  history.replaceState(history.state,'',tab.hash);
}

/* an address names one category: open it and fold the others, so it is the row under the head */
function showGroup(group){
  if(groups.every(function(other){return other.open===(other===group);}))return false;
  groups.forEach(function(other){other.open=other===group;});
  return true;
}
/* what the browser's own jump to an anchor cannot do: select the client or open the category the
   address names */
function openAddress(behavior){
  var target=document.getElementById(location.hash.slice(1));
  if(!target)return;
  if(target.classList.contains('client')){
    /* the panel was hidden when the browser looked for the anchor: show it, then go there */
    selectClient(target.getAttribute('data-client'));
    target.scrollIntoView({behavior:behavior});
  }else if(target.classList.contains('tool-group')&&showGroup(target)){
    target.scrollIntoView({behavior:behavior});
  }
}

/* ---- the head row's name: erased letter by letter from the right, then typed from the left ----
   CSS has already swapped number and name (data-part); this only plays over that final state by
   clipping whole letters of the monospace names, so nothing is measured, moved or left behind */
var head=document.querySelector('.sheet-head');
var LETTER_MS=22;
var HIDDEN='inset(0 100% 0 0)';
var SHOWN='inset(0 0 0 0)';
var typing=[];
/* the name is held empty: the reader is on the way to travel and this part is only passed */
var blank=false;
/* the part a pressed anchor leads to, until scrolling rests */
var travel='';
function nameOf(part){return head.querySelector('[data-head="'+part+'"] > :last-child');}
function retype(from,to){
  var midway=blank||typing.some(function(anim){return anim.playState==='running';});
  typing.forEach(function(anim){anim.cancel();});
  typing=[];
  blank=false;
  var old=nameOf(from);
  var name=nameOf(to);
  if(!old||!name||!head.offsetHeight||still.matches)return;
  /* interrupted: nothing left to erase, go straight to the latest name */
  var erased=midway?0:old.textContent.length;
  if(travel&&to!==travel){
    /* passing through: the number says where the reader is, the name waits for the destination */
    blank=true;
    typing.push(name.animate([{clipPath:HIDDEN},{clipPath:HIDDEN}],{duration:1,fill:'forwards'}));
  }
  var typed=blank?0:name.textContent.length;
  var total=Math.min(Math.max((erased+typed)*LETTER_MS,erased&&typed?250:0),360);
  var eraseMs=erased?total*erased/(erased+typed):0;
  if(typed)typing.push(name.animate([{clipPath:HIDDEN},{clipPath:SHOWN}],{duration:total-eraseMs,delay:eraseMs,easing:'steps('+typed+', start)',fill:'backwards'}));
  if(erased)typing.push(old.animate([{visibility:'visible',clipPath:SHOWN},{visibility:'visible',clipPath:HIDDEN}],{duration:eraseMs,easing:'steps('+erased+')'}));
}

/* ---- the part in view ---- */
var current='';
var frame=0;
var settled=0;
function follow(){
  frame=0;
  /* a part becomes current when the rule above it has gone under the sticky row */
  var line=Math.max.apply(null,stickyRows.map(function(row){return row.offsetHeight;}))+2;
  var here=sheets[0].id;
  sheets.forEach(function(sheet){if(sheet.getBoundingClientRect().top<=line)here=sheet.id;});
  if(here===current)return;
  var from=current;
  current=here;
  root.setAttribute('data-part',here);
  retype(from,here);
  partLinks.forEach(function(link){
    if(link.getAttribute('data-part-link')===here)link.setAttribute('aria-current','location');
    else link.removeAttribute('aria-current');
  });
}
/* once scrolling rests, the address names the part in view; a finer address inside it is kept */
function syncAddress(){
  travel='';
  if(blank)retype(current,current); /* the journey ended elsewhere: name the part it ended in */
  if(partOf(location.hash)!==current)history.replaceState(history.state,'','#'+current);
}
function onScroll(){
  if(!frame)frame=requestAnimationFrame(follow);
  clearTimeout(settled);
  settled=setTimeout(syncAddress,150);
}

function copy(btn){
  navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(function(){
    if(!btn.classList.contains('copied'))btn.setAttribute('data-name',btn.getAttribute('aria-label'));
    btn.classList.add('copied');
    btn.setAttribute('aria-label','Copied');
    btn.title='Copied';
    clearTimeout(btn.copyTimer);
    btn.copyTimer=setTimeout(function(){
      btn.classList.remove('copied');
      btn.setAttribute('aria-label',btn.getAttribute('data-name'));
      btn.title=btn.getAttribute('data-name');
    },2000);
  });
}

document.addEventListener('click',function(e){
  var btn=e.target.closest('.copy-btn');
  if(btn){if(navigator.clipboard)copy(btn);return;}
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  var link=e.target.closest('a[href^="#"]');
  if(!link)return;
  if(link.hasAttribute('data-client-link')){e.preventDefault();pressTab(link);return;}
  /* a reference to a tool category: open it first, then the browser scrolls to it as to any anchor */
  var target=document.getElementById(link.hash.slice(1));
  if(target&&target.classList.contains('tool-group'))showGroup(target);
  if(target&&partOf(link.hash)!==current)travel=partOf(link.hash);
});

document.addEventListener('keydown',function(e){
  if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||e.shiftKey)return;
  var tab=e.target.closest('[role="tab"]');
  if(!tab)return;
  var i=tabs.indexOf(tab);
  var next={ArrowRight:i+1,ArrowDown:i+1,ArrowLeft:i-1,ArrowUp:i-1,Home:0,End:tabs.length-1}[e.key];
  if(next===undefined){
    if(e.key===' '){e.preventDefault();pressTab(tab);}
    return;
  }
  e.preventDefault();
  var other=tabs[(next+tabs.length)%tabs.length];
  pressTab(other);
  other.focus();
});

window.addEventListener('scroll',onScroll,{passive:true});
window.addEventListener('resize',onScroll);
window.addEventListener('hashchange',function(){openAddress();});

selectClient(root.getAttribute('data-client'));
openAddress('instant');
follow();
/* anchors glide only once the page has opened: the jump to the address it opens at is not a journey */
function glide(){setTimeout(function(){root.classList.add('ready');});}
if(document.readyState==='complete')glide();
else window.addEventListener('load',glide);
})();`;
