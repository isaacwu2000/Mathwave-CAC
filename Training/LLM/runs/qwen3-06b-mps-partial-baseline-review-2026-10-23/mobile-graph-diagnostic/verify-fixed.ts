import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory = new URL('./', import.meta.url).pathname;
const rows = (await readFile(new URL('../test-subset.jsonl',import.meta.url),'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const browser = await chromium.launch({headless:true});
const results=[];
try {
for(const id of ['graph-exponential-base-parameter:2:final','graph-named-function-redefinition:2:final']) {
 for(const viewport of [{width:390,height:844},{width:1280,height:900}]) {
  const row=rows.find(x=>x.id===id), book=row.expected.before.book;
  const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/api/live-token',route=>route.fulfill({json:{configured:false}}));
  await page.route('**/api/problems',route=>route.fulfill({json:{book,clarification:null,revision:1}}));
  await page.goto('http://localhost:5186');await page.locator('.app-shell[data-ready="true"]').waitFor();
  await page.evaluate(()=>document.fonts.ready);await page.locator('.graph-card canvas').first().waitFor();
  const metrics=()=>page.evaluate(()=>[...document.querySelectorAll('.graph-card,.graph-panel-body,.graph-expressions,.chart-wrap,.learnunlock-canvas,.learnunlock-canvas canvas')].map(element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return{tag:element.tagName,className:element.className,width:r.width,height:r.height,maxHeight:s.maxHeight,display:s.display};}));
  await page.waitForTimeout(300);const early=await metrics();await page.waitForTimeout(5000);const late=await metrics();
  const screenshot=directory+id.split(':')[0]+'-fixed-'+viewport.width+'.png';await page.screenshot({path:screenshot,fullPage:true});
  let collapseRestore=null;
  if(viewport.width===390){await page.getByRole('button',{name:'Hide graph',exact:true}).click();await page.waitForTimeout(150);const collapsed=await metrics();await page.getByRole('button',{name:'Show graph',exact:true}).click();await page.waitForTimeout(600);const restored=await metrics();collapseRestore={collapsed,restored};}
  results.push({id,lane:'Actual unchanged gold prestate from invalid generation; CSS fix verification, no model output applied',viewport,screenshot,early,late,collapseRestore,errors});await page.close();
 }
}
}finally{await browser.close();}
const css=await readFile(new URL('../../../../../Web/src/modules/visuals/ui/graph-controls.css',import.meta.url));
await writeFile(directory+'fixed-verification.json',JSON.stringify({cssSha256:createHash('sha256').update(css).digest('hex'),results},null,2)+'\n',{flag:'wx'});
