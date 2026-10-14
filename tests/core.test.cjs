const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const corePath = path.join(__dirname, '../src/core.js');
test('recruitment data model is available', () => assert.ok(fs.existsSync(corePath), 'date/search data model has not been implemented'));
if (fs.existsSync(corePath)) {
  const C = require(corePath);
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/catalog.json'), 'utf8'));
  const data = C.normalizeDataset(source);
  const day = C.parseDay('2026-10-13');
  const defaults = {q:'', city:'', cohort:'', degree:'', industry:'', ownership:'', category:'', mode:'all', day:'', hideExpired:true, sort:'deadline'};
  test('strict Gregorian dates preserve ambiguous source text', () => {
    assert.equal(C.parseDay('2026/10/13'), day);
    assert.equal(C.parseDay('2026-02-29'), null);
    assert.notEqual(C.parseDay('2028-02-29'), null);
    for (const d of ['尽快投递','招满即止','','10-20','2026-13-01']) assert.equal(C.parseDay(d), null);
  });
  test('Shanghai day boundary changes at 16:00 UTC', () => {
    assert.equal(C.today(new Date('2026-10-12T15:59:59Z')), '2026-10-12');
    assert.equal(C.today(new Date('2026-10-12T16:00:00Z')), '2026-10-13');
  });
  test('DDL includes today, distinguishes expiration and unknown', () => {
    assert.equal(C.deadlineInfo('2026-10-13', day).label, '今天截止');
    assert.equal(C.deadlineInfo('2026-10-14', day).days, 1);
    assert.equal(C.deadlineInfo('2026-10-12', day).kind, 'expired');
    assert.equal(C.deadlineInfo('尽快投递', day).kind, 'unknown');
    assert.equal(C.deadlineInfo('招满即止', day).label, '招满即止');
  });
  test('catalog metadata agrees with unique active records', () => {
    assert.equal(data.records.filter(r=>r.active).length,source.metadata.active_count);
    assert.equal(new Set(data.records.map(r=>r.id)).size,data.records.length);
    assert.ok(data.records.length>7000);
  });
  test('new filters use Shanghai discovery days, excluding baseline and future',()=>{
    const records=C.normalizeDataset({records:[
      {record_id:'today',招聘单位:'T',截止日期:'尽快投递',firstSeenAt:'2026-10-12T16:00:00Z'},
      {record_id:'day3',招聘单位:'D3',截止日期:'尽快投递',firstSeenAt:'2026-10-10T16:00:00Z'},
      {record_id:'day4',招聘单位:'D4',截止日期:'尽快投递',firstSeenAt:'2026-10-09T16:00:00Z'},
      {record_id:'day7',招聘单位:'D7',截止日期:'尽快投递',firstSeenAt:'2026-10-06T16:00:00Z'},
      {record_id:'day8',招聘单位:'D8',截止日期:'尽快投递',firstSeenAt:'2026-10-05T16:00:00Z'},
      {record_id:'baseline',招聘单位:'B',截止日期:'尽快投递',firstSeenAt:null},
      {record_id:'future',招聘单位:'F',截止日期:'尽快投递',firstSeenAt:'2026-10-14T00:00:00Z'}
    ]}).records;
    assert.equal(C.selectRecords(records,{...defaults,added:'1'},day).length,1);
    assert.equal(C.selectRecords(records,{...defaults,added:'3'},day).length,2);
    assert.equal(C.selectRecords(records,{...defaults,added:'7'},day).length,4);
  });
  test('personal progress retains expired and removed records',()=>{
    const records=C.normalizeDataset({records:[{record_id:'x',招聘单位:'X',截止日期:'2026-10-01',active:false}]}).records;
    assert.equal(C.selectRecords(records,defaults,day).length,0);
    assert.equal(C.selectRecords(records,{...defaults,mode:'applied'},day,new Set(),new Set(['x'])).length,1);
  });
  test('DDL sorting is future, unknown, then expired; latest sorting is independent', () => {
    const rows = C.normalizeDataset({records:[
      {record_id:'past',招聘单位:'过去',截止日期:'2026-10-12',更新时间:'2026/10/13'},
      {record_id:'unknown',招聘单位:'未知',截止日期:'尽快投递',更新时间:'2026/10/12'},
      {record_id:'next',招聘单位:'未来',截止日期:'2026-10-20',更新时间:'2026/10/11'},
      {record_id:'today',招聘单位:'今天',截止日期:'2026-10-13',更新时间:'2026/10/10'}
    ]}).records;
    assert.deepEqual(C.selectRecords(rows,{...defaults,hideExpired:false},day).map(r=>r.id),['today','next','unknown','past']);
    assert.equal(C.selectRecords(rows,{...defaults,hideExpired:false,sort:'latest'},day)[0].id,'past');
  });
  test('search intersects tokens and combines city/cohort filters', () => {
    const result = C.selectRecords(data.records,{...defaults,q:'算法',city:'北京',cohort:'27届'},day);
    assert.ok(result.length>0);
    for (const r of result) { assert.ok(r.search.includes('算法')); assert.ok(r.cities.includes('北京')); assert.ok(r.cohorts.includes('27届')); }
    assert.equal(C.selectRecords(data.records,{...defaults,q:'不存在的公司xyz921'},day).length,0);
  });
  test('personal flags filter independently and date filters match exactly', () => {
    const id = data.records.find(r=>r.deadlineDay===day).id;
    assert.deepEqual(C.selectRecords(data.records,{...defaults,mode:'favorites'},day,new Set([id])).map(r=>r.id),[id]);
    assert.equal(C.selectRecords(data.records,{...defaults,mode:'applied'},day,new Set([id])).length,0);
    assert.ok(C.selectRecords(data.records,{...defaults,day:'2026-10-13'},day).every(r=>r.deadlineDay===day));
  });
  test('malformed and duplicate data imports fail explicitly; URL schemes are constrained', () => {
    for (const bad of [{}, {records:[]}, {records:[{record_id:'x'}]}, {records:[{record_id:'x',招聘单位:'A',截止日期:'今天'},{record_id:'x',招聘单位:'B',截止日期:'今天'}]}]) assert.throws(()=>C.normalizeDataset(bad));
    assert.equal(C.safeUrl('javascript:alert(1)'), '');
    assert.equal(C.safeUrl('https://example.com/jobs?a=1'), 'https://example.com/jobs?a=1');
  });
  test('invalid snapshot metadata is rejected before UI state can be committed', () => {
    const records=[{record_id:'valid',招聘单位:'测试',截止日期:'2026-10-15'}];
    for(const metadata of [[],{captured_at:{toString:null,valueOf:null}},{captured_at:'not-a-date'},{source_url:{url:'https://example.com'}}]) assert.throws(()=>C.normalizeDataset({records,metadata}));
    assert.equal(C.normalizeDataset({records}).records.length,1);
  });
}
