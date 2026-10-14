(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadarCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const DAY = 86400000;
  const collator = new Intl.Collator('zh-CN');
  const text = value => value == null ? '' : Array.isArray(value) ? value.join('、') : String(value);
  const list = value => Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(/[、,，;；]/).map(x=>x.trim()).filter(Boolean);
  const fold = value => text(value).normalize('NFKC').toLowerCase();
  function parseDay(value) {
    const m = text(value).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!m) return null;
    const [y, mo, d] = m.slice(1).map(Number);
    if (y < 1900 || y > 2200) return null;
    const stamp = Date.UTC(y, mo-1, d), date = new Date(stamp);
    return date.getUTCFullYear()===y && date.getUTCMonth()===mo-1 && date.getUTCDate()===d ? stamp / DAY : null;
  }
  function today(now = new Date()) { return new Date(now.getTime()+8*3600000).toISOString().slice(0,10); }
  function dayString(day) { return new Date(day*DAY).toISOString().slice(0,10); }
  function deadlineInfo(value, currentDay) {
    const date = parseDay(value);
    if (date===null) return {kind:'unknown',label:text(value)||'日期未明确',days:null,date:null};
    const days = date-currentDay;
    return {kind:days<0?'expired':days===0?'today':days<=7?'soon':'future',label:days<0?'已过截止日':days===0?'今天截止':`还剩 ${days} 天`,days,date:dayString(date)};
  }
  function safeUrl(value) {
    try { const url = new URL(text(value)); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function normalizeDataset(raw) {
    if (!raw || !Array.isArray(raw.records) || !raw.records.length || raw.records.length>30000) throw new Error('请选择包含 records 数组的校招 JSON（1–30,000 条）。');
    const metadata=raw.metadata??{};
    if(typeof metadata!=='object'||Array.isArray(metadata))throw new Error('metadata 必须是对象。');
    if(metadata.captured_at!=null&&(typeof metadata.captured_at!=='string'||Number.isNaN(Date.parse(metadata.captured_at))))throw new Error('数据时间 captured_at 必须是有效的日期字符串。');
    if(metadata.source_url!=null&&typeof metadata.source_url!=='string')throw new Error('source_url 必须是网址字符串。');
    const seen = new Set(), records=[];
    for (const [index, row] of raw.records.entries()) {
      if (!row || typeof row !== 'object') throw new Error(`第 ${index+1} 条记录格式错误。`);
      if (row['招聘单位']==='必看文档【重要】') continue;
      if (typeof row.record_id!=='string' || !row.record_id || typeof row['招聘单位']!=='string' || !row['招聘单位'].trim() || typeof row['截止日期']!=='string') throw new Error(`第 ${index+1} 条记录缺少 record_id、招聘单位或截止日期。`);
      if (seen.has(row.record_id)) throw new Error('记录 ID 重复，请检查导入文件。');
      for (const [key, value] of Object.entries(row)) {
        if (value!==null && typeof value==='object' && !(Array.isArray(value)&&value.every(x=>typeof x==='string'))) throw new Error(`字段 ${key} 格式不受支持。`);
      }
      seen.add(row.record_id);
      const r = {
        id:row.record_id, company:row['招聘单位'], types:list(row['企业性质']), industries:list(row['行业分类']),
        roles:text(row['招聘岗位']), cities:list(row['工作地点']), cohorts:list(row['可投届次']),
        updated:text(row['更新时间']), deadline:text(row['截止日期']), degree:text(row['学历要求']),
        categories:list(row['招聘类型']), source:text(row['公告来源']), announcement:text(row['公告链接']),
        apply:text(row['投递链接']), majors:text(row['专业要求']), exam:list(row['是否笔试']), insurance:text(row['已交社保可投']),
        deadlineDay:parseDay(row['截止日期']), updatedDay:parseDay(row['更新时间']), firstSeenDay:row.firstSeenAt?parseDay(today(new Date(row.firstSeenAt))):null, active:row.active!==false, original:row
      };
      r.search=fold([r.company,r.roles,r.majors,...r.cities].join(' '));
      records.push(r);
    }
    if (!records.length) throw new Error('文件中没有可展示的招聘记录。');
    return {metadata, records};
  }
  function selectRecords(records, state, currentDay, favorites=new Set(), applied=new Set()) {
    const tokens = fold(state.q).trim().split(/\s+/).filter(Boolean);
    const targetDay = parseDay(state.day);
    const selected=records.filter(r=>{
      const known=r.deadlineDay!==null, personal=['favorites','applied'].includes(state.mode);
      if(!personal&&r.active===false)return false;
      const addedDays=Number(state.added)||0;
      if(addedDays&&![1,3,7].includes(addedDays))return false;
      if(addedDays&&(r.firstSeenDay===null||r.firstSeenDay===undefined||r.firstSeenDay>currentDay||r.firstSeenDay<currentDay-addedDays+1))return false;
      if (state.hideExpired && !personal && known && r.deadlineDay<currentDay) return false;
      if (state.mode==='soon' && (!known || r.deadlineDay<currentDay || r.deadlineDay>currentDay+7)) return false;
      if (state.mode==='undated' && known) return false;
      if (state.mode==='favorites' && !favorites.has(r.id)) return false;
      if (state.mode==='applied' && !applied.has(r.id)) return false;
      if (targetDay!==null && r.deadlineDay!==targetDay) return false;
      if (state.city && !r.cities.includes(state.city)) return false;
      if (state.cohort && !r.cohorts.includes(state.cohort)) return false;
      if (state.degree && !r.degree.includes(state.degree)) return false;
      if (state.industry && !r.industries.includes(state.industry)) return false;
      if (state.ownership && !r.types.includes(state.ownership)) return false;
      if (state.category && !r.categories.includes(state.category)) return false;
      return tokens.every(token=>r.search.includes(token));
    });
    const tie=(a,b)=>(b.updatedDay??-Infinity)-(a.updatedDay??-Infinity)||collator.compare(a.company,b.company)||a.id.localeCompare(b.id);
    const group=r=>r.deadlineDay===null?1:r.deadlineDay<currentDay?2:0;
    selected.sort((a,b)=>{
      if (state.sort==='latest') return tie(a,b);
      const g=group(a)-group(b);
      if (g) return g;
      if (group(a)===0) return a.deadlineDay-b.deadlineDay||tie(a,b);
      if (group(a)===2) return b.deadlineDay-a.deadlineDay||tie(a,b);
      return tie(a,b);
    });
    return selected;
  }
  return {parseDay,today,dayString,deadlineInfo,safeUrl,normalizeDataset,selectRecords,fold};
});
