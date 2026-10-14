(() => {
  'use strict';
  const KEY='job-dating:progress:v1', DRAFT='job-dating:draft:', $=id=>document.getElementById(id);
  const labels={todo:'未开始',filling:'填写中',applied:'已投递',test:'笔试',interview:'面试',offer:'Offer',closed:'不再考虑'};
  const empty=()=>({status:'todo',favorite:false,notes:'',appliedOn:'',revision:0});
  let config=null,records={},catalog=null,editorFlush=null;
  const queues=new Map(),editorDrafts=new Map();
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url=path=>new URL(path,location.href).href;
  async function request(path,options={}) {
    const response=await fetch(url(path),{cache:'no-store',keepalive:options.method==='PUT',...options,headers:{...(options.body?{'Content-Type':'application/json','X-Job-Dating-Token':config?.csrfToken||''}:{}),...options.headers}});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'操作未完成，请重试');
    return data;
  }
  function localRead(){const raw=localStorage.getItem(KEY);if(!raw)return {};const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('本地记录格式异常，请先备份浏览器数据');return parsed;}
  async function init() {
    if(location.protocol==='file:')throw new Error('请使用“启动 Job Dating”脚本打开个人版，以启用每日更新和记录保存。');
    try{config=await request('api/config');}catch(error){if(['127.0.0.1','localhost'].includes(location.hostname))throw new Error('本地存储服务未响应，请重新运行启动脚本。');config=null;}
    catalog=await request('data/catalog.json');
    records=config?.mode==='local'?await request('api/progress'):localRead();
    // Migrate prior marks only where that origin's browser storage is available, without overwriting saved records.
    const legacy={};let migrated=false;try{migrated=localStorage.getItem(KEY+':migrated')==='yes';}catch{}
    for(const [key,patch] of [['fuyue-radar:favorites:v1',{favorite:true}],['fuyue-radar:applied:v1',{status:'applied'}]]){
      let ids=[];try{ids=JSON.parse(localStorage.getItem(key)||'[]');}catch{}
      if(Array.isArray(ids)&&!migrated)for(const id of ids)if(typeof id==='string')legacy[id]={...legacy[id],...patch};
    }
    for(const [id,patch] of Object.entries(legacy))if(!records[id])await save(id,patch);
    try{localStorage.setItem(KEY+':migrated','yes');}catch{}
  }
  function get(id){return records[id]||empty();}
  function inProgress(id){const p=get(id);return p.status!=='todo'||!!p.notes||!!p.appliedOn;}
  function save(id,patch) {
    const previous=queues.get(id)||Promise.resolve();
    const pending=previous.catch(()=>{}).then(async()=>{
      const before=get(id),value={...before,...patch};let result;
      if(config?.mode==='local')result=await request('api/progress/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({value,expectedRevision:before.revision||0})});
      else {
        const fresh=localRead();
        if((fresh[id]?.revision||0)!==(before.revision||0))throw new Error('其他窗口已修改这条记录，请重新打开详情。');
        result={...value,revision:(before.revision||0)+1,updatedAt:new Date().toISOString()};
        localStorage.setItem(KEY,JSON.stringify({...fresh,[id]:result}));
      }
      records={...records,[id]:result};return result;
    });
    queues.set(id,pending);
    pending.finally(()=>{if(queues.get(id)===pending)queues.delete(id);}).catch(()=>{});
    return pending;
  }
  async function reloadProgress(){records=config?.mode==='local'?await request('api/progress'):localRead();}
  function mountEditor(container,id,onSaved) {
    editorFlush?.();const p={...get(id),...editorDrafts.get(id)},section=document.createElement('section');section.className='progress-editor';
    section.innerHTML=`<div class="progress-heading"><h3>我的投递记录</h3><span id="record-save-state" role="status">${config?'保存在本机数据库':'保存在此浏览器'}</span></div><div class="progress-fields"><label>当前进度<select id="record-status">${Object.entries(labels).map(([v,label])=>`<option value="${v}" ${p.status===v?'selected':''}>${label}</option>`).join('')}</select></label><label>投递日期<input type="date" id="record-date" value="${escape(p.appliedOn)}"></label></div><label class="notes-label">备注<textarea id="record-notes" maxlength="10000" rows="3" placeholder="例如：已填到教育经历，待补成绩单；投递了哪个岗位…">${escape(p.notes)}</textarea></label><div class="draft-note" id="draft-note" hidden>检测到尚未保存的草稿。<button type="button" id="restore-draft">恢复草稿</button></div>`;
    container.append(section);
    let timer,dirty=false,saving=0,pending=Promise.resolve(true);
    const status=section.querySelector('#record-save-state'),notes=section.querySelector('#record-notes'),select=section.querySelector('#record-status'),date=section.querySelector('#record-date');
    const values=()=>({status:select.value,notes:notes.value,appliedOn:date.value});
    function keepDraft(){editorDrafts.set(id,values());try{localStorage.setItem(DRAFT+id,JSON.stringify(values()));}catch{}}
    function flush(){clearTimeout(timer);if(!dirty)return pending;dirty=false;const value=values(),version=++saving;status.textContent='保存中…';status.dataset.state='saving';
      pending=save(id,value).then(()=>{if(JSON.stringify(editorDrafts.get(id))===JSON.stringify(value))editorDrafts.delete(id);if(version===saving){status.textContent='已保存';status.dataset.state='saved';try{if(localStorage.getItem(DRAFT+id)===JSON.stringify(value))localStorage.setItem(DRAFT+id,'');}catch{}}onSaved?.();return true;})
        .catch(error=>{dirty=true;status.textContent=error.message;status.dataset.state='error';keepDraft();return false;});
      return pending;
    }
    function changed(immediate=false){dirty=true;keepDraft();status.textContent='待保存…';clearTimeout(timer);if(immediate)void flush();else timer=setTimeout(flush,350);}
    notes.addEventListener('input',()=>changed());notes.addEventListener('blur',flush);
    select.addEventListener('change',()=>{if(select.value==='applied'&&!date.value)date.value=window.RadarCore.today();changed(true);});date.addEventListener('change',()=>changed(true));
    try{const draft=localStorage.getItem(DRAFT+id);if(draft&&draft!==JSON.stringify({status:p.status,notes:p.notes,appliedOn:p.appliedOn})){section.querySelector('#draft-note').hidden=false;section.querySelector('#restore-draft').onclick=()=>{const d=JSON.parse(draft);notes.value=d.notes||'';select.value=labels[d.status]?d.status:'todo';date.value=d.appliedOn||'';section.querySelector('#draft-note').hidden=true;changed(true);};}}catch{}
    editorFlush=flush;
  }
  function flushEditor(){return editorFlush?.();}
  async function refreshCatalog(){const next=await request('data/catalog.json');window.RadarCore.normalizeDataset(next);catalog=next;return catalog;}
  function syncLabel(){const el=$('sync-label');if(!el||!catalog)return;const time=new Date(catalog.metadata.captured_at);el.textContent='已更新 '+time.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
  function setup(onCatalog,onProgress){
    syncLabel();$('storage-mode').textContent=config?'记录自动保存在本机 · 支持备份':'记录自动保存在此浏览器 · 支持备份';
    let checking=false,lastCheck=0;
    async function checkUpdates(){if(checking||document.hidden||Date.now()-lastCheck<10000)return;checking=true;lastCheck=Date.now();
      try{if(config){const status=await request('api/sync-status');if(status.state==='syncing'){return;}if(status.last_success_at&&status.last_success_at!==catalog.metadata.captured_at){await refreshCatalog();await onCatalog(catalog);syncLabel();}if(status.state==='error')$('sync-label').textContent='更新未完成 · 保留上次数据';}
        else{const before=catalog.metadata.captured_at;await refreshCatalog();if(catalog.metadata.captured_at!==before){await onCatalog(catalog);syncLabel();}}
      }catch{$('sync-label').textContent='暂时无法更新 · 保留当前数据';}finally{checking=false;}
    }
    void checkUpdates();setInterval(checkUpdates,60000);window.addEventListener('focus',checkUpdates);document.addEventListener('visibilitychange',checkUpdates);
    $('sync-now').textContent=config?'同步招聘信息':'刷新招聘信息';
    $('sync-now').addEventListener('click',async()=>{
      const button=$('sync-now');button.disabled=true;$('sync-label').textContent='正在更新…';
      try{if(config){await request('api/sync',{method:'POST',body:'{}'});for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1500));const s=await request('api/sync-status');if(s.state==='error')throw new Error(s.message);if(s.state!=='syncing')break;if(i===89)throw new Error('同步仍在后台进行，稍后刷新查看。');}}
        await refreshCatalog();await onCatalog(catalog);syncLabel();
      }catch(e){$('sync-label').textContent=e.message;}finally{button.disabled=false;}
    });
    $('backup-export').onclick=async()=>{
      try{if(await flushEditor()===false)throw new Error('备注尚未保存成功，请重试保存后再备份。');await Promise.all([...queues.values()]);await reloadProgress();const payload={format:'job-dating-progress-v1',exportedAt:new Date().toISOString(),records};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download='JobDating-投递记录-'+window.RadarCore.today()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);$('backup-state').textContent='备份已准备好';}catch(e){$('backup-state').textContent=e.message;}
    };
    $('backup-import').onclick=()=>$('backup-file').click();
    $('backup-file').onchange=async()=>{const file=$('backup-file').files[0];if(!file)return;
      try{if(file.size>20*1024*1024)throw new Error('备份文件超过20MB');const payload=JSON.parse(await file.text());if(payload.format!=='job-dating-progress-v1'||!payload.records||typeof payload.records!=='object'||Array.isArray(payload.records))throw new Error('请选择投递记录备份');
        let result;if(config)result=await request('api/progress/import',{method:'POST',body:JSON.stringify(payload)});else{let restored=0,skipped=0;const next=localRead();for(const [id,p] of Object.entries(payload.records)){if(!/^[A-Za-z0-9_:-]{1,160}$/.test(id)||!labels[p.status]||typeof p.notes!=='string'||p.notes.length>10000||typeof p.favorite!=='boolean'||typeof p.appliedOn!=='string'||(p.appliedOn&&!window.RadarCore.parseDay(p.appliedOn)))throw new Error('备份字段格式错误');if(next[id]){skipped++;continue;}next[id]={...p,revision:1,updatedAt:new Date().toISOString()};restored++;}localStorage.setItem(KEY,JSON.stringify(next));result={restored,skipped};}
        await reloadProgress();onProgress();$('backup-state').textContent=`恢复 ${result.restored} 条，保留已有 ${result.skipped} 条`;
      }catch(e){$('backup-state').textContent=e.message;}finally{$('backup-file').value='';}
    };
    window.addEventListener('storage',()=>{if(!$('detail-dialog').open)reloadProgress().then(onProgress).catch(()=>{});});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)flushEditor();else if(!$('detail-dialog').open)reloadProgress().then(onProgress).catch(()=>{});});
  }
  window.JobDating={init,get,save,inProgress,mountEditor,flushEditor,setup,labels,reloadProgress,get records(){return records;},get catalog(){return catalog;},get mode(){return config?'local':'browser';}};
})();
