import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { currentProblem } from '../../../../../Web/src/modules/problems/index.ts';
const directory = new URL('./', import.meta.url).pathname;
const rows = (await readFile(new URL('../test-subset.jsonl',import.meta.url),'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const browser = await chromium.launch({headless:true});
const report=[];
try {
for(const id of ['graph-exponential-base-parameter:2:final','graph-named-function-redefinition:2:final']) {
 const row=rows.find(x=>x.id===id), book=row.expected.before.book;
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.route('**/api/live-token',route=>route.fulfill({json:{configured:false}}));
 await page.route('**/api/problems',route=>route.fulfill({json:{book,clarification:null,revision:1}}));
 await page.goto('http://localhost:5186');
 await page.locator('.app-shell[data-ready="true"]').waitFor();
 await page.evaluate(()=>document.fonts.ready);await page.locator('.graph-card canvas').first().waitFor();
 const metrics=()=>page.evaluate(()=>[...document.querySelectorAll('.graph-card,.graph-panel-body,.graph-studio,.graph-expressions,.chart-wrap,.learnunlock-canvas,.learnunlock-canvas canvas')].map(element=>{const rect=element.getBoundingClientRect(),style=getComputedStyle(element);return{tag:element.tagName,className:element.className,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},height:style.height,maxHeight:style.maxHeight,display:style.display,position:style.position,flex:style.flex,overflow:style.overflow,widthAttribute:element.getAttribute('width'),heightAttribute:element.getAttribute('height')};}));
 await page.waitForTimeout(300);const early=await metrics();await page.screenshot({path:directory+id.split(':')[0]+'-specificity-before.png',fullPage:true});
 await page.waitForTimeout(5000);const late=await metrics();await page.screenshot({path:directory+id.split(':')[0]+'-specificity-late-before.png',fullPage:true});
 await page.addStyleTag({content:'@media(max-width:900px){.app-shell[data-graph=true] .graph-card .graph-scene-studio .graph-expressions{max-height:16dvh;padding:4px 12px}}'});
 await page.waitForTimeout(1000);const probe=await metrics();await page.screenshot({path:directory+id.split(':')[0]+'-specificity-fixed.png',fullPage:true});
 report.push({id,lane:'Unchanged gold prestate replay from invalid generation; no model output applied',state:currentProblem(book).state,early,late,probe,errors});
 await page.close();
}
}finally{await browser.close();}
await writeFile(directory+'specificity-report.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
