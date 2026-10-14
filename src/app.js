(async () => {
  'use strict';
  const P=window.JobDating;
  try { await P.init(); } catch(error) { document.getElementById('startup-error').textContent=error.message;return; }
  const C=window.RadarCore, $=id=>document.getElementById(id), PAGE_SIZE=12;
  const KEYS={state:'fuyue-radar:filters:v1',favorites:'fuyue-radar:favorites:v1',applied:'fuyue-radar:applied:v1'};
  const DEFAULTS={q:'',city:'',cohort:'',degree:'',industry:'',ownership:'',category:'',mode:'all',day:'',added:'0',hideExpired:true,sort:'deadline'};
  let storageOK=true, toastTimer, searchTimer, page=1, currentId='', selected=[], stats={}, lastFocus=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const fmt=n=>Number(n).toLocaleString('zh-CN');
  const join=(value,fallback='未说明')=>Array.isArray(value)?value.filter(x=>x&&x!=='/').join('、')||fallback:String(value||fallback);
  function read(key,fallback) { try { const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; } catch { storageOK=false;return fallback; } }
  function write(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch { if(storageOK) toast('浏览器存储不可用，标记仅在当前页面保留'); storageOK=false; updateStorageNote(); } }
  function updateStorageNote() { const note=document.querySelector('.local-note'); if(note&&!storageOK) note.innerHTML=icon('info')+'浏览器存储不可用，标记暂存于此页面'; }
  const savedState=read(KEYS.state,{}), state={...DEFAULTS};
  if (savedState&&typeof savedState==='object') for(const key of Object.keys(DEFAULTS)) if(typeof savedState[key]===typeof DEFAULTS[key]) state[key]=savedState[key];
  if(!['all','soon','favorites','applied','undated'].includes(state.mode)) state.mode='all';
  if(!['deadline','latest'].includes(state.sort)) state.sort='deadline';
  state.q=state.q.slice(0,160);
  const getSet=key=>{const a=read(key,[]);return new Set(Array.isArray(a)?a.filter(x=>typeof x==='string'):[])};
  const favorites=new Set(), applied=new Set();
  function refreshProgressSets(){favorites.clear();applied.clear();for(const [id,p] of Object.entries(P.records)){if(p.favorite)favorites.add(id);if(P.inProgress(id))applied.add(id);}}
  refreshProgressSets();
  let todayText=C.today(), todayDay=C.parseDay(todayText), data=C.normalizeDataset(P.catalog), byId;
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').classList.add('visible'); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2600); }
  function highlight(value) {
    const tokens=[...new Set(state.q.trim().split(/\s+/).filter(Boolean))].sort((a,b)=>b.length-a.length);
    const valueText=String(value??'');
    if(!tokens.length) return esc(valueText);
    const expression=new RegExp(tokens.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gi');
    let result='',cursor=0;
    for(const match of valueText.matchAll(expression)) { result+=esc(valueText.slice(cursor,match.index))+`<mark>${esc(match[0])}</mark>`;cursor=match.index+match[0].length; }
    return result+esc(valueText.slice(cursor));
  }
  function avatar(r) {
    const colors=[['#edf1fa','#778fb8'],['#edf4f1','#6f958a'],['#f1eef8','#9288b3'],['#f7f1ea','#ad947a'],['#edf3f7','#7c9aaa']];
    const hash=Array.from(r.company).reduce((n,c)=>n+c.codePointAt(0),0), [bg,ink]=colors[hash%colors.length];
    const initials=r.company.replace(/^[（(].*?[）)]/,'').slice(0,2);
    return `<span class="company-avatar" aria-hidden="true" style="--avatar-bg:${bg};--avatar-ink:${ink}">${esc(initials)}</span>`;
  }
  function badge(r) {const d=C.deadlineInfo(r.deadline,todayDay);return `<span class="deadline-badge ${d.kind}">${icon('clock')}${esc(d.label)}</span>`;}
  function populateSelect(id,values,label) {
    const entries=[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    if(id==='city') {const priority=['北京','上海','广州','深圳','杭州','成都','南京','武汉','苏州','全国'];entries.sort((a,b)=>{const ai=priority.indexOf(a),bi=priority.indexOf(b);return (ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b,'zh-CN')})}
    if(id==='cohort') entries.sort((a,b)=>a.localeCompare(b,'zh-CN'));
    $(id).replaceChildren(new Option(label,''),...entries.map(v=>new Option(v,v)));
    if(state[id]&&!entries.includes(state[id])) state[id]='';
    $(id).value=state[id];
  }
  function recalculateStats() {
    stats={unknown:0,expired:0,soon:0,days:Array(8).fill(0)};
    for(const r of data.records) { if(r.active===false)continue;if(r.deadlineDay===null) stats.unknown++;else {const diff=r.deadlineDay-todayDay;if(diff<0)stats.expired++;if(diff>=0&&diff<=7){stats.soon++;stats.days[diff]++;}} }
    $('total-stat').textContent=fmt(data.records.filter(r=>r.active).length);$('soon-stat').textContent=fmt(stats.soon);$('tab-soon').textContent=fmt(stats.soon);$('unknown-count').textContent=fmt(stats.unknown);
    $('calendar-month').textContent=`${todayText.slice(5,7)} / ${todayText.slice(0,4)}`;
    for(const days of [1,3,7])$('added-'+days).textContent=fmt(data.records.filter(r=>r.active&&r.firstSeenDay!==null&&r.firstSeenDay>=todayDay-days+1&&r.firstSeenDay<=todayDay).length);
    renderCalendar();
  }
  function loadDataset() {
    byId=new Map(data.records.map(r=>[r.id,r]));
    populateSelect('city',data.records.flatMap(r=>r.cities),'全部城市');
    populateSelect('cohort',data.records.flatMap(r=>r.cohorts),'全部届次');
    populateSelect('industry',data.records.flatMap(r=>r.industries),'全部行业');
    populateSelect('ownership',data.records.flatMap(r=>r.types),'全部性质');
    populateSelect('category',data.records.flatMap(r=>r.categories),'全部类型');
    syncInputs();recalculateStats();render();
  }
  function syncInputs() { $('search').value=state.q; for(const key of ['city','cohort','degree','industry','ownership','category','sort']) $(key).value=state[key];$('hide-expired').checked=state.hideExpired;window.RadarPickers?.refresh(); }
  function renderCalendar() {
    const days=['周日','周一','周二','周三','周四','周五','周六'],max=Math.max(...stats.days,1);
    $('date-list').innerHTML=stats.days.map((count,i)=>{
      const date=C.dayString(todayDay+i),week=days[new Date(date+'T00:00:00Z').getUTCDay()];
      return `<button class="date-button ${i===0?'today':''} ${state.day===date?'selected':''}" data-day="${date}" aria-pressed="${state.day===date}" aria-label="${date} 截止，全部数据共 ${count} 条"><span class="date-volume" style="--volume:${count/max*76}%"></span><span class="date-number">${date.slice(-2)}</span><span class="date-week">${i===0?'今天':week}</span><span class="date-count"><b>${count}</b> 条</span></button>`;
    }).join('');
  }
  const labels={q:'搜索',city:'城市',cohort:'届次',degree:'学历',industry:'行业',ownership:'性质',category:'类型',day:'截止日',added:'新增范围'};
  function renderChips() {
    const chips=Object.keys(labels).filter(k=>state[k]&&(k!=='added'||state[k]!=='0')).map(k=>`<button class="filter-chip" data-clear="${k}" aria-label="移除${labels[k]}筛选：${esc(state[k])}">${labels[k]}：${k==='added'?(state[k]==='1'?'当日':state[k]+' 天内'):esc(state[k])}${icon('close')}</button>`);
    if(state.mode==='undated')chips.push(`<button class="filter-chip" data-clear="mode">日期未明确${icon('close')}</button>`);
    $('filter-chips').hidden=!chips.length;
    $('filter-chips').innerHTML=chips.join('')+(chips.length?'<button class="clear-filters" data-reset>清空筛选</button>':'');
    const advanced=['degree','industry','ownership','category'].filter(k=>state[k]).length;
    $('advanced-count').textContent=advanced?` · ${advanced}`:'';
  }
  function renderCounts() {
    const saved=[...favorites].filter(id=>byId.has(id)).length,submitted=[...applied].filter(id=>byId.has(id)).length;
    $('nav-saved').textContent=fmt(saved);$('tab-saved').textContent=fmt(saved);$('tab-applied').textContent=fmt(submitted);
    document.querySelectorAll('[data-added]').forEach(button=>{const active=button.dataset.added===state.added;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
    document.querySelectorAll('.view-tabs [data-mode]').forEach(button=>{const active=button.dataset.mode===state.mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active)});
  }
  function card(r,index) {
    const d=C.deadlineInfo(r.deadline,todayDay),saved=favorites.has(r.id),isApplied=applied.has(r.id);
    const location=join(r.cities),degree=r.degree||'学历未说明';
    return `<article class="job-card" data-record="${esc(r.id)}" style="--delay:${Math.min(index,5)*35}ms">
      <div class="card-head">${avatar(r)}<div class="company-text"><h2 class="company-title"><button data-detail="${esc(r.id)}">${highlight(r.company)}</button></h2><p class="company-meta" title="${esc(join(r.industries))}">${esc(join(r.industries))}</p></div></div>
      <button class="bookmark-button ${saved?'is-saved':''}" data-save="${esc(r.id)}" aria-label="${saved?'取消收藏':'收藏'}${esc(r.company)}" aria-pressed="${saved}">${icon('star')}</button>
      <p class="roles-preview">${highlight(r.roles||'岗位详情见原始公告')}</p>
      <div class="card-facts"><span title="${esc(location)}">${icon('pin')}<span class="fact-text">${highlight(location)}</span></span><span title="${esc(degree)}">${icon('cap')}<span class="fact-text">${esc(degree)}</span></span></div>
      <div class="card-tags">${r.types.slice(0,1).map(t=>`<span class="tag type-tag">${esc(t)}</span>`).join('')}<span class="tag">${esc(join(r.cohorts,'届次未说明'))}</span>${r.categories.slice(0,1).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}${isApplied?`<span class="tag progress-tag">${esc(P.labels[P.get(r.id).status]||'有备注')}</span>`:''}${r.active===false?'<span class="tag archived-tag">来源已移除</span>':''}${r.firstSeenDay===todayDay?'<span class="tag new-label">今日新发现</span>':''}</div>
      <div class="card-bottom"><div>${badge(r)}<span class="deadline-date">${d.date?`${esc(d.date.replace(/-/g,'.'))} 截止`:'日期未明确 · 以原公告为准'}</span></div><button class="card-detail-link" data-detail="${esc(r.id)}">查看详情${icon('arrow')}</button></div>
    </article>`;
  }
  const revealObserver='IntersectionObserver' in window?new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){e.target.classList.add('reveal');revealObserver.unobserve(e.target)}},{threshold:.08}):null;
  function renderPagination() {
    const pages=Math.ceil(selected.length/PAGE_SIZE);$('pagination').hidden=pages<2;
    if(pages<2){$('pagination').replaceChildren();return}
    const numbers=[...new Set([1,page-1,page,page+1,pages])].filter(p=>p>=1&&p<=pages).sort((a,b)=>a-b);
    let html=`<button data-page="${page-1}" ${page===1?'disabled':''} aria-label="上一页"><span style="transform:rotate(180deg)">${icon('chevron')}</span></button>`,prev=0;
    for(const n of numbers){if(prev&&n>prev+1)html+='<span class="ellipsis">…</span>';html+=`<button data-page="${n}" ${n===page?'aria-current="page"':''} aria-label="第 ${n} 页">${n}</button>`;prev=n;}
    html+=`<button data-page="${page+1}" ${page===pages?'disabled':''} aria-label="下一页">${icon('chevron')}</button><small>第 ${page} / ${pages} 页</small>`;$('pagination').innerHTML=html;
  }
  function rememberResultFocus() {
    const node=document.activeElement,container=node?.closest('#date-list,#filter-chips,#pagination,#job-list');
    const key=['data-day','data-clear','data-page','data-save','data-detail'].find(k=>node?.hasAttribute(k));
    return container&&key?{node,container:container.id,key,value:node.getAttribute(key),index:[...container.querySelectorAll('button')].indexOf(node)}:null;
  }
  function restoreResultFocus(previous) {
    if(!previous||previous.node.isConnected)return;
    const container=$(previous.container),buttons=[...container.querySelectorAll('button:not(:disabled)')];
    const match=buttons.find(b=>b.getAttribute(previous.key)===previous.value),fallback=buttons[Math.min(previous.index,buttons.length-1)];
    const target=match||fallback||document.querySelector('.view-tabs button.active')||$('search');
    target.focus({preventScroll:true});
  }
  function render() {
    const previousFocus=rememberResultFocus();
    selected=C.selectRecords(data.records,state,todayDay,favorites,applied);
    page=Math.min(Math.max(1,page),Math.max(1,Math.ceil(selected.length/PAGE_SIZE)));
    revealObserver?.disconnect();$('job-list').innerHTML=selected.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(card).join('');
    if(revealObserver)document.querySelectorAll('.job-card').forEach(el=>revealObserver.observe(el));
    const modes={all:'符合条件的校招信息',soon:'7 日内截止的信息',favorites:'收藏中的信息',applied:'有投递记录的信息',undated:'日期未明确的信息'};
    $('result-summary').innerHTML=`找到 <strong>${fmt(selected.length)}</strong> 条${modes[state.mode]}`;
    $('order-note').textContent=['applied','favorites'].includes(state.mode)?'保留已截止及来源移除的记录':state.sort==='latest'?'按原表更新时间排序':'明确日期优先 · 未明确日期置后';
    const empty=!selected.length;$('empty-state').hidden=!empty;$('job-list').hidden=empty;
    $('empty-title').textContent=state.mode==='favorites'?'先收藏，让心动有处安放':state.mode==='applied'?'为每次投递，留一个记号':'还没有找到对应机会';
    $('empty-text').textContent=state.mode==='favorites'?'点击岗位卡片的星标即可收藏；已有收藏也可能被当前筛选隐藏。':state.mode==='applied'?'在机会详情中选择进度或写下备注，即可自动保存。已有记录也可能被当前筛选隐藏。':'换一个关键词，或放宽筛选条件试试。';
    renderChips();renderCounts();renderCalendar();renderPagination();write(KEYS.state,state);restoreResultFocus(previousFocus);
  }
  function changeState(changes,{scroll=false}={}) {Object.assign(state,changes);page=1;syncInputs();render();if(scroll)$('opportunities').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
  function reset(){changeState({...DEFAULTS});}
  function openDialog(dialog,trigger) {if(!dialog.open){lastFocus=trigger||document.activeElement;dialog.showModal();}document.body.style.overflow='hidden';}
  async function openDetails(id,trigger) {
    await P.flushEditor();
    currentId=id;const r=byId.get(id);if(!r)return;
    const d=C.deadlineInfo(r.deadline,todayDay),exam=join(r.exam);
    $('detail-content').innerHTML=`<div class="detail-company">${avatar(r)}<div><h2 id="detail-title">${highlight(r.company)}</h2><p>${esc(join(r.types))} · ${esc(join(r.industries))}</p></div></div><div class="detail-deadline">${badge(r)}<span>${esc(d.date||'未提供具体截止日')}</span></div><section class="detail-section"><h3>招聘岗位</h3><p>${highlight(r.roles||'未说明，请查看原始公告。')}</p></section><dl class="detail-grid">${[
      ['工作地点',join(r.cities)],['可投届次',join(r.cohorts)],['学历要求',r.degree||'未说明'],['招聘类型',join(r.categories)],['是否笔试',exam],['已交社保可投',r.insurance&&r.insurance!=='/'?r.insurance:'未说明']
    ].map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><section class="detail-section"><h3>专业要求</h3><p>${highlight(r.majors||'未说明，请查看原始公告。')}</p></section><section class="detail-section"><h3>信息来源</h3><p>${esc(r.source||'原始表格所收录公告')}</p><p>原表更新时间：${esc(r.updated||'未提供')}</p></section><p class="detail-note">这是一条招聘公告，可能包含多个岗位。不同岗位的地点与要求请以原始公告为准。倒计时据表内日期计算，未核实是否提前关闭或延期。</p>`;
    renderDetailActions();P.mountEditor($('detail-content'),id,()=>{refreshProgressSets();render();});$('detail-content').scrollTop=0;openDialog($('detail-dialog'),trigger);
  }
  function renderDetailActions() {
    const r=byId.get(currentId);if(!r)return;
    const saved=favorites.has(r.id),announcement=C.safeUrl(r.announcement),apply=C.safeUrl(r.apply);
    $('detail-actions').innerHTML=`<button class="secondary ${saved?'is-saved':''}" data-save="${esc(r.id)}" aria-pressed="${saved}">${icon('star')}${saved?'已收藏':'收藏'}</button>${announcement?`<a class="secondary" href="${esc(announcement)}" target="_blank" rel="noopener noreferrer">原始公告${icon('external')}</a>`:'<span class="secondary">公告链接未提供</span>'}${apply?`<a class="primary" id="apply-link" href="${esc(apply)}" target="_blank" rel="noopener noreferrer">前往投递${icon('arrow')}</a>`:'<span class="secondary">投递链接未提供</span>'}`;
  }
  async function toggleSave(id,trigger) {
    const was=favorites.has(id),insideDetail=!!trigger?.closest('#detail-dialog');
    try{await P.save(id,{favorite:!was});refreshProgressSets();render();if($('detail-dialog').open)renderDetailActions();
      const replacement=insideDetail?$('detail-actions').querySelector('[data-save]'):[...$('job-list').querySelectorAll('[data-save]')].find(b=>b.dataset.save===id);
      replacement?.focus({preventScroll:true});toast(was?'已取消收藏':'已收藏并保存');
    }catch(error){toast(error.message);}
  }
  function refreshDay() {const next=C.today();if(next!==todayText){todayText=next;todayDay=C.parseDay(next);recalculateStats();render();if($('detail-dialog').open)openDetails(currentId);}}
  $('search-form').addEventListener('submit',event=>{event.preventDefault();clearTimeout(searchTimer);changeState({q:$('search').value.trim()},{scroll:true});});
  $('search').addEventListener('input',()=>{state.q=$('search').value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;render();},140);});
  document.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener('change',()=>changeState({[el.dataset.filter]:el.value})));
  $('hide-expired').addEventListener('change',()=>changeState({hideExpired:$('hide-expired').checked}));
  $('sort').addEventListener('change',()=>changeState({sort:$('sort').value}));
  $('advanced-toggle').addEventListener('click',()=>{const open=$('advanced-filters').hidden;$('advanced-filters').hidden=!open;$('advanced-toggle').setAttribute('aria-expanded',open);});
  $('empty-reset').addEventListener('click',reset);
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-mode],[data-day],[data-clear],[data-reset],[data-page],[data-detail],[data-save],[data-added]');
    if(button) {
      if(button.hasAttribute('data-mode'))changeState({mode:button.dataset.mode,day:'',added:['applied','favorites'].includes(button.dataset.mode)?'0':state.added},{scroll:!button.closest('.view-tabs')});
      else if(button.hasAttribute('data-added'))changeState({added:button.dataset.added,mode:'all',day:''});
      else if(button.hasAttribute('data-day'))changeState({day:state.day===button.dataset.day?'':button.dataset.day,mode:'all'});
      else if(button.hasAttribute('data-clear'))changeState({[button.dataset.clear]:button.dataset.clear==='mode'?'all':button.dataset.clear==='added'?'0':''});
      else if(button.hasAttribute('data-reset'))reset();
      else if(button.hasAttribute('data-page')){page=Number(button.dataset.page);render();$('opportunities').scrollIntoView({block:'start',behavior:'instant'});$('pagination').querySelector('[aria-current]')?.focus({preventScroll:true});}
      else if(button.hasAttribute('data-detail'))openDetails(button.dataset.detail,button);
      else if(button.hasAttribute('data-save'))toggleSave(button.dataset.save,button);
      return;
    }
    const article=event.target.closest('.job-card');if(article&&!event.target.closest('a,button,input,select')&&!window.getSelection()?.toString())openDetails(article.dataset.record,article.querySelector('[data-detail]'));
  });
  for(const dialog of [$('detail-dialog')]) {
    dialog.querySelector('.close-dialog').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
    dialog.addEventListener('close',()=>{P.flushEditor();document.body.style.overflow='';const equivalent=lastFocus?.dataset.detail?[...document.querySelectorAll('#job-list [data-detail]')].find(b=>b.dataset.detail===lastFocus.dataset.detail):null;const target=lastFocus?.isConnected?lastFocus:equivalent||$('search');target.focus({preventScroll:true});});
  }
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.closest('input,textarea,select,[contenteditable="true"]')&&!document.querySelector('dialog[open]')){event.preventDefault();$('search').focus();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDay();});window.addEventListener('focus',refreshDay);setInterval(refreshDay,30000);
  window.RadarPickers?.init();loadDataset();P.setup(async catalog=>{await P.flushEditor();data=C.normalizeDataset(catalog);loadDataset();},()=>{refreshProgressSets();render();});updateStorageNote();$('browser-help').hidden=true;
})();
