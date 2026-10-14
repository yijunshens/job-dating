const fs=require('node:fs'),path=require('node:path');
const root=__dirname,read=name=>fs.readFileSync(path.join(root,'src',name),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/catalog.json'),'utf8'));
const core=require('./src/core.js'),rows=core.normalizeDataset(catalog).records.filter(r=>r.active),now=core.parseDay(core.today());
let html=read('template.html')
 .replace('/* EMBED_STYLES */',()=>read('styles.css')+'\n'+read('pickers.css')+'\n'+read('personal.css'))
 .replace('/* EMBED_CORE */',()=>read('core.js'))
 .replace('/* EMBED_PICKERS */',()=>read('pickers.js'))
 .replace('/* EMBED_PERSONAL */',()=>read('personal.js'))
 .replace('/* EMBED_APP */',()=>read('app.js'))
 .replace('EMBED_TOTAL_COUNT',rows.length.toLocaleString('zh-CN'))
 .replace('EMBED_SOON_COUNT',core.selectRecords(rows,{mode:'soon'},now).length.toLocaleString('zh-CN'));
fs.mkdirSync(path.join(root,'dist/data'),{recursive:true});
fs.writeFileSync(path.join(root,'dist/index.html'),html);
fs.writeFileSync(path.join(root,'dist/.nojekyll'),'');
fs.copyFileSync(path.join(root,'data/catalog.json'),path.join(root,'dist/data/catalog.json'));
console.log(JSON.stringify({htmlBytes:Buffer.byteLength(html),activeRecords:rows.length,lastSync:catalog.metadata.captured_at},null,2));
