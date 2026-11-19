/** The copy and check marks as neon.com draws them: square corners, 1px line. */
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4.2 13H13V4.2H4.2V13Z"/><path d="M2.6 9.8H1V1h8.8v1.6"/></svg>';

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 6l4.286 5L13 2"/></svg>';

/** Both states of a copy button; CSS shows the check while it has `.copied`. */
export const COPY_ICONS = `<span class="copy-icon">${COPY_ICON}${CHECK_ICON}</span>`;

/**
 * Runs in the head, before first paint: marks that script is available and opens the booklet at
 * the part the address names, so the right page never flashes the wrong part. Without script
 * nothing is hidden and the parts follow each other.
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
 * Turns the pages. The markup is complete without it: this decides which right-hand page is open
 * (data-part on <html>, read by CSS), keeps the address and history in step, plays the turn on
 * the spread, and handles the client selector and the copy buttons.
 */
export const INTERACTION_SCRIPT = `(function(){
var root=document.documentElement;
var each=function(list,fn){Array.prototype.forEach.call(list,fn);};
var sheets=Array.prototype.slice.call(document.querySelectorAll('[data-sheet]'));
var ORDER=sheets.map(function(sheet){return sheet.id;});
var tabs=Array.prototype.slice.call(document.querySelectorAll('[data-client-link]'));
var spread=window.matchMedia('(min-width: 60rem)');
var still=window.matchMedia('(prefers-reduced-motion: reduce)');
var HALF=300;
var finishTurn=null;
var handledHash=null;

history.scrollRestoration='manual';

/* an address names a part, one client's procedure, or one tool category */
function parse(hash){
  var h=hash.charAt(0)==='#'?hash.slice(1):hash;
  if(h==='')return {part:ORDER[0]};
  if(ORDER.indexOf(h)>=0)return {part:h};
  var el=document.getElementById(h);
  var sheet=el&&el.closest('[data-sheet]');
  if(!sheet)return null;
  if(el.classList.contains('client'))return {part:sheet.id,client:el.getAttribute('data-client')};
  if(el.classList.contains('tool-group'))return {part:sheet.id,group:h};
  return null;
}
function current(){return root.getAttribute('data-part')||ORDER[0];}
function pageOf(part){return document.getElementById(part);}
function at(deg){return 'perspective(2400px) rotateY('+deg+'deg)';}

/* single column: where the page rests after a change, so the part strip stays in view and the
   reader is not thrown back to the cover */
function restY(){
  var cover=document.getElementById('cover');
  var stripTop=cover?cover.getBoundingClientRect().bottom+window.scrollY:0;
  return Math.min(window.scrollY,Math.max(stripTop,0));
}

/* the client selector is a row of links until script can switch it */
var tablist=document.querySelector('[data-clients]');
if(tablist)tablist.setAttribute('role','tablist');
tabs.forEach(function(tab){
  var panel=document.getElementById(tab.getAttribute('href').slice(1));
  tab.setAttribute('role','tab');
  tab.id='tab-'+tab.getAttribute('data-client-link');
  tab.setAttribute('aria-controls',panel.id);
  panel.setAttribute('role','tabpanel');
  panel.setAttribute('aria-labelledby',tab.id);
});

function mark(){
  var here=current();
  var client=root.getAttribute('data-client');
  each(document.querySelectorAll('[data-part-link]'),function(link){
    if(link.getAttribute('data-part-link')===here)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  tabs.forEach(function(tab){
    var on=tab.getAttribute('data-client-link')===client;
    tab.setAttribute('aria-selected',String(on));
    tab.tabIndex=on?0:-1;
  });
}
function focusTitle(part){
  var title=pageOf(part).querySelector('h2');
  if(title)title.focus({preventScroll:true});
}
function land(target,y){
  if(target.group){
    var group=document.getElementById(target.group);
    /* a reference points at one category: fold the others so it is the one at the top */
    each(document.querySelectorAll('.tool-group[open]'),function(other){if(other!==group)other.open=false;});
    group.open=true;
    group.scrollIntoView({block:'start'});
  }else if(y!==null){
    window.scrollTo(0,y);
  }
}

function show(target,y,focus){
  if(finishTurn)finishTurn();
  var from=current();
  var to=target.part;
  if(target.client)root.setAttribute('data-client',target.client);
  if(from===to){mark();land(target,y);return;}

  var out=pageOf(from);
  var inn=pageOf(to);
  var forward=ORDER.indexOf(to)>ORDER.indexOf(from);

  /* no page turn in the single column, nor when motion is reduced: the part just changes */
  if(still.matches||!spread.matches){
    var rest=spread.matches?0:restY();
    root.setAttribute('data-part',to);
    mark();
    land(target,y===null?rest:y);
    if(focus&&spread.matches)focusTitle(to);
    return;
  }

  /* Freeze the outgoing page exactly where the reader sees it: a fixed, clipped box scrolled to
     the same place, so the document underneath can already be the next page. */
  var rect=out.getBoundingClientRect();
  var top=Math.max(rect.top,0);
  var inner=Math.max(-rect.top,0);
  var box={left:rect.left+'px',top:top+'px',width:rect.width+'px',height:(window.innerHeight-top)+'px'};
  out.classList.add(forward?'is-leaf':'is-under');
  out.style.left=box.left;out.style.top=box.top;out.style.width=box.width;out.style.height=box.height;
  out.style.minHeight='0';
  out.style.transformOrigin='left center';
  root.setAttribute('data-part',to);
  mark();
  out.scrollTop=inner;
  land(target,y===null?0:y);

  /* the back of the leaf: it travels on over the left page and dissolves there, because every
     left page of this booklet prints the same thing */
  var verso=document.createElement('div');
  verso.className='verso';
  verso.setAttribute('aria-hidden','true');
  verso.style.left=box.left;verso.style.top=box.top;verso.style.width=box.width;verso.style.height=box.height;
  verso.style.transformOrigin='left center';
  document.body.appendChild(verso);

  var anims=[];
  if(forward){
    anims.push(out.animate([{transform:at(0)},{transform:at(-90)}],{duration:HALF,easing:'ease-in',fill:'forwards'}));
    anims.push(verso.animate([{transform:at(-90),opacity:1},{transform:at(-150),opacity:1,offset:0.55},{transform:at(-180),opacity:0}],{duration:HALF,delay:HALF,easing:'ease-out',fill:'both'}));
  }else{
    var landed=inn.getBoundingClientRect();
    inn.classList.add('is-rising');
    inn.style.transformOrigin='0px '+(window.innerHeight/2-landed.top)+'px';
    anims.push(verso.animate([{transform:at(-180),opacity:0},{transform:at(-150),opacity:1,offset:0.45},{transform:at(-90),opacity:1}],{duration:HALF,easing:'ease-in',fill:'both'}));
    anims.push(inn.animate([{transform:at(-90)},{transform:at(0)}],{duration:HALF,delay:HALF,easing:'ease-out',fill:'backwards'}));
  }

  var done=function(){
    if(finishTurn!==done)return;
    finishTurn=null;
    anims.forEach(function(anim){anim.cancel();});
    verso.remove();
    out.classList.remove('is-leaf','is-under');
    out.removeAttribute('style');
    inn.classList.remove('is-rising');
    inn.style.transformOrigin='';
    if(!inn.getAttribute('style'))inn.removeAttribute('style');
    if(focus)focusTitle(to);
  };
  finishTurn=done;
  Promise.all(anims.map(function(anim){return anim.finished;})).then(done,function(){});
}

function navigate(hash){
  var target=parse(hash);
  if(!target)return false;
  var same=target.part===current();
  if(same&&!target.client&&!target.group){
    window.scrollTo({top:0,behavior:still.matches?'auto':'smooth'});
    return true;
  }
  if(same){
    history.replaceState(history.state,'',hash);
  }else{
    history.replaceState(Object.assign({},history.state,{y:window.scrollY}),'');
    history.pushState({y:0},'',hash);
  }
  show(target,null,!same);
  return true;
}
function step(by){
  var next=ORDER[ORDER.indexOf(current())+by];
  if(next)navigate('#'+next);
}

function copy(btn){
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
}

document.addEventListener('click',function(e){
  var btn=e.target.closest('.copy-btn');
  if(btn){if(navigator.clipboard)copy(btn);return;}
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  var link=e.target.closest('a[href^="#"]');
  if(link&&navigate(link.getAttribute('href')))e.preventDefault();
});

document.addEventListener('keydown',function(e){
  if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||e.shiftKey)return;
  var tab=e.target.closest('[role="tab"]');
  if(tab){
    /* inside the client selector the arrows choose a client; they do not turn the page */
    var i=tabs.indexOf(tab);
    var next={ArrowRight:i+1,ArrowDown:i+1,ArrowLeft:i-1,ArrowUp:i-1,Home:0,End:tabs.length-1}[e.key];
    if(next===undefined){
      if(e.key===' '){e.preventDefault();tab.click();}
      return;
    }
    e.preventDefault();
    var other=tabs[(next+tabs.length)%tabs.length];
    navigate(other.getAttribute('href'));
    other.focus();
    return;
  }
  if(e.target.closest('input, textarea, select, [contenteditable="true"]'))return;
  if(e.key==='ArrowRight')step(1);
  else if(e.key==='ArrowLeft')step(-1);
});

/* a swipe that starts on something that scrolls sideways (the part strip, a long command)
   belongs to it */
function sideScrolls(el){
  for(var node=el;node&&node!==document.body;node=node.parentElement){
    if(node.scrollWidth>node.clientWidth+1&&/(auto|scroll)/.test(getComputedStyle(node).overflowX))return true;
  }
  return false;
}
var touch=null;
document.addEventListener('touchstart',function(e){
  touch=e.touches.length===1
    ?{x:e.touches[0].clientX,y:e.touches[0].clientY,t:Date.now(),ok:!e.target.closest('.bar-nav')&&!sideScrolls(e.target)}
    :null;
},{passive:true});
document.addEventListener('touchend',function(e){
  if(!touch||!touch.ok)return;
  var dx=e.changedTouches[0].clientX-touch.x;
  var dy=e.changedTouches[0].clientY-touch.y;
  var quick=Date.now()-touch.t<700;
  touch=null;
  if(!quick||Math.abs(dx)<56||Math.abs(dx)<Math.abs(dy)*1.8)return;
  if(String(window.getSelection()||'')!=='')return;
  step(dx<0?1:-1);
},{passive:true});

window.addEventListener('popstate',function(e){
  handledHash=location.hash;
  var y=e.state&&typeof e.state.y==='number'?e.state.y:0;
  show(parse(location.hash)||{part:ORDER[0]},y,false);
});
window.addEventListener('hashchange',function(){
  if(handledHash===location.hash){handledHash=null;return;}
  var target=parse(location.hash);
  if(target)show(target,null,false);
});
spread.addEventListener('change',mark);

/* first open: the head script already chose the part; finish what CSS cannot do */
mark();
var first=parse(location.hash);
if(first&&first.group)land(first,null);
})();`;
