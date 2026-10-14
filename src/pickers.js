(() => {
  'use strict';
  const definitions={city:['城市','去你向往的地方','pin'],cohort:['届次','找到属于这一届的机会','cap'],degree:['学历要求','让要求，更合适你','cap'],industry:['行业方向','探索你感兴趣的领域','search'],ownership:['企业性质','选择适合你的工作环境','sliders'],category:['招聘类型','找到当下合适的入口','sliders'],sort:['排序方式','按你的节奏，安排下一步','clock']};
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const controllers=new Map();let panel,active=null,options=[],visible=[],activeIndex=0,bodyStyle=null,scrollY=0;
  function lockScroll() {
    if(bodyStyle)return;
    scrollY=window.scrollY;
    bodyStyle={position:document.body.style.position,top:document.body.style.top,left:document.body.style.left,right:document.body.style.right,width:document.body.style.width,overflow:document.body.style.overflow};
    Object.assign(document.body.style,{position:'fixed',top:`${-scrollY}px`,left:'0',right:'0',width:'100%',overflow:'hidden'});
  }
  function unlockScroll() {
    if(!bodyStyle)return;
    Object.assign(document.body.style,bodyStyle);bodyStyle=null;
    const before=document.documentElement.style.scrollBehavior;document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,scrollY);document.documentElement.style.scrollBehavior=before;
  }
  function closePanel() {
    const trigger=active?.trigger;
    active=null;trigger?.setAttribute('aria-expanded','false');
    if(panel.open)panel.close();
    unlockScroll();trigger?.focus({preventScroll:true});
  }
  function positionPanel() {
    if(!panel?.open||!active)return;
    const vv=window.visualViewport,vh=vv?.height||window.innerHeight,offset=vv?.offsetTop||0;
    if(matchMedia('(max-width:620px), (pointer:coarse) and (max-width:1000px)').matches) {
      panel.classList.toggle('compact-sheet',vh<=560);
      const margin=Math.max(12,(window.innerWidth-520)/2);
      Object.assign(panel.style,{left:`${margin}px`,right:`${margin}px`,top:'auto',bottom:`${Math.max(12,window.innerHeight-offset-vh+12)}px`,width:'auto',maxHeight:`${Math.max(120,vh-24)}px`});
    } else {
      const rect=active.trigger.getBoundingClientRect(),width=Math.min(356,window.innerWidth-24),below=window.innerHeight-rect.bottom-12,above=rect.top-12;
      const up=below<270&&above>below,centered=Math.max(above,below)<250,maxHeight=centered?window.innerHeight-24:Math.min(530,(up?above:below)-8);
      panel.classList.toggle('compact-sheet',maxHeight<430);
      Object.assign(panel.style,{left:`${Math.max(12,Math.min(rect.left,window.innerWidth-width-12))}px`,right:'auto',width:`${width}px`,bottom:'auto',maxHeight:`${Math.max(120,maxHeight)}px`});
      panel.style.top=`${centered?12:up?Math.max(12,rect.top-panel.getBoundingClientRect().height-8):rect.bottom+8}px`;
    }
  }
  function synchronize(controller) {
    const {select,trigger}=controller,label=definitions[select.id][0];
    const value=select.selectedOptions[0]?.textContent||select.options[0]?.textContent||'请选择';
    trigger.querySelector('.picker-value').textContent=value;
    trigger.setAttribute('aria-label',`${label}：${value}`);
    trigger.classList.toggle('has-value',!!select.value&&select.id!=='sort');
  }
  function refresh() {for(const controller of controllers.values())synchronize(controller);}
  function setActive(index,{scroll=true}={}) {
    activeIndex=Math.max(0,Math.min(index,visible.length-1));
    const list=panel.querySelector('#choice-options');
    list.querySelectorAll('.choice-option').forEach((node,i)=>node.classList.toggle('is-focused',i===activeIndex));
    const item=list.children[activeIndex];
    if(item){list.setAttribute('aria-activedescendant',item.id);if(scroll)item.scrollIntoView({block:'nearest'});}else list.removeAttribute('aria-activedescendant');
  }
  function renderOptions() {
    const q=panel.querySelector('#choice-search').value.trim().normalize('NFKC').toLowerCase();
    visible=options.filter(o=>o.label.normalize('NFKC').toLowerCase().includes(q));
    const list=panel.querySelector('#choice-options');
    list.innerHTML=visible.map((o,i)=>`<div class="choice-option" role="option" id="choice-option-${i}" aria-selected="${o.value===active.select.value}" data-choice-index="${i}"><span>${esc(o.label)}</span><span class="choice-check">${icon('check')}</span></div>`).join('');
    panel.querySelector('#choice-empty').hidden=visible.length>0;
    list.hidden=!visible.length;
    panel.querySelector('#choice-count').textContent=q?`找到 ${visible.length} 个选项`:`共 ${options.length} 个选项`;
    const popular=panel.querySelector('#choice-popular');popular.hidden=!!q||active.select.id!=='city';
    setActive(Math.max(0,visible.findIndex(o=>o.value===active.select.value)),{scroll:false});
    list.scrollTop=0;
    positionPanel();
  }
  function choose(value) {
    if(!active)return;
    const selected=active.select;
    selected.value=value;synchronize(active);closePanel();
    selected.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function open(controller) {
    if(panel.open){closePanel();}
    active=controller;const [label,description,kind]=definitions[controller.select.id];
    options=[...controller.select.options].map(o=>({label:o.textContent,value:o.value}));
    panel.querySelector('#choice-title').textContent=controller.select.id==='sort'?'排列你的机会':`选择${label}`;
    panel.querySelector('#choice-description').textContent=description;
    panel.querySelector('.choice-emblem').innerHTML=icon(kind);
    panel.querySelector('#choice-search').placeholder=`搜索${label}…`;
    panel.querySelector('#choice-search').value='';
    panel.querySelector('#choice-search').setAttribute('aria-label',`搜索${label}选项`);
    panel.querySelector('.choice-search-wrap').hidden=options.length<=8;
    panel.querySelector('#choice-popular-buttons').innerHTML=['北京','上海','广州','深圳','杭州','成都','南京','武汉'].filter(city=>options.some(o=>o.value===city)).map(city=>`<button type="button" data-popular-city="${city}" class="choice-shortcut">${city}</button>`).join('');
    controller.trigger.setAttribute('aria-expanded','true');
    lockScroll();renderOptions();panel.showModal();positionPanel();
    if(matchMedia('(max-width:620px), (pointer:coarse) and (max-width:1000px)').matches)panel.focus({preventScroll:true});
    else if(options.length>8)panel.querySelector('#choice-search').focus({preventScroll:true});
    else panel.querySelector('#choice-options').focus({preventScroll:true});
    requestAnimationFrame(positionPanel);
  }
  function initializePanel() {
    panel=document.createElement('dialog');panel.id='choice-dialog';panel.className='choice-dialog';panel.tabIndex=-1;panel.setAttribute('aria-labelledby','choice-title');panel.setAttribute('aria-describedby','choice-description');
    panel.innerHTML=`<span class="sheet-handle" aria-hidden="true"></span><div class="choice-header"><span class="choice-emblem"></span><div><h2 id="choice-title"></h2><p id="choice-description"></p></div><button id="choice-close" class="icon-button" type="button" aria-label="关闭选择框">${icon('close')}</button></div><div class="choice-search-wrap">${icon('search')}<input id="choice-search" type="search" autocomplete="off" spellcheck="false" maxlength="80"></div><div id="choice-popular" class="choice-popular"><span>常用城市</span><div id="choice-popular-buttons"></div></div><div class="choice-list-heading"><span id="choice-count" role="status" aria-live="polite"></span><span>点击即应用</span></div><div class="choice-list" id="choice-options" role="listbox" tabindex="0" aria-labelledby="choice-title"></div><div id="choice-empty" class="choice-empty" hidden>${icon('search')}<strong>没有找到这个选项</strong><p>试试其他关键词，或清空搜索。</p><button type="button" id="choice-clear-search">清空搜索</button></div><div class="choice-footnote"><span class="status-dot"></span>每一个选择，离下一站更近一点</div>`;
    document.body.appendChild(panel);
    panel.querySelector('#choice-close').addEventListener('click',closePanel);
    panel.addEventListener('cancel',event=>{event.preventDefault();closePanel();});
    panel.querySelector('#choice-search').addEventListener('input',renderOptions);
    panel.querySelector('#choice-clear-search').addEventListener('click',()=>{panel.querySelector('#choice-search').value='';renderOptions();panel.querySelector('#choice-search').focus();});
    panel.addEventListener('click',event=>{
      const option=event.target.closest('[data-choice-index]'),popular=event.target.closest('[data-popular-city]');
      if(option)choose(visible[Number(option.dataset.choiceIndex)].value);
      else if(popular)choose(popular.dataset.popularCity);
      else if(event.target===panel){const r=panel.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePanel();}
    });
    panel.addEventListener('keydown',event=>{
      const list=panel.querySelector('#choice-options'),search=event.target.id==='choice-search';
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePanel();return;}
      if(search&&event.key==='ArrowDown'){event.preventDefault();list.focus();setActive(0);return;}
      if(event.target!==list)return;
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key))event.preventDefault();
      if(event.key==='ArrowDown')setActive(activeIndex+1);
      else if(event.key==='ArrowUp')setActive(activeIndex-1);
      else if(event.key==='Home')setActive(0);
      else if(event.key==='End')setActive(visible.length-1);
      else if((event.key==='Enter'||event.key===' ')&&visible[activeIndex])choose(visible[activeIndex].value);
    });
    panel.addEventListener('close',()=>{if(!panel.open&&active)closePanel();});
    window.addEventListener('resize',positionPanel);window.visualViewport?.addEventListener('resize',positionPanel);window.visualViewport?.addEventListener('scroll',positionPanel);
  }
  function init() {
    if(panel||typeof HTMLDialogElement==='undefined'||!HTMLDialogElement.prototype.showModal)return;
    initializePanel();
    document.querySelectorAll('select[data-filter],#sort').forEach(select=>{
      const trigger=document.createElement('button');trigger.type='button';trigger.id=`${select.id}-trigger`;trigger.className='picker-trigger';trigger.dataset.pickerFor=select.id;trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls','choice-dialog');trigger.setAttribute('aria-expanded','false');trigger.innerHTML=`<span class="picker-value"></span><span class="picker-chevron">${icon('chevron')}</span>`;
      select.classList.add('native-select-adapter');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.insertAdjacentElement('afterend',trigger);
      document.querySelectorAll(`label[for="${select.id}"]`).forEach(label=>label.htmlFor=trigger.id);
      const controller={select,trigger};controllers.set(select.id,controller);synchronize(controller);
      trigger.addEventListener('click',()=>open(controller));select.addEventListener('change',()=>synchronize(controller));
      trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open(controller);panel.querySelector('#choice-options').focus();setActive(options.findIndex(o=>o.value===select.value));}});
    });
  }
  window.RadarPickers={init,refresh};
})();
