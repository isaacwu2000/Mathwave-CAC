import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const directory=new URL('./',import.meta.url).pathname;
const cases=JSON.parse(await readFile(new URL('../a/cases.json',import.meta.url),'utf8'));
const item=cases.find(x=>x.key==='b50c474bf9e8d8a97228.png'),ref=item.refs[0];
const originalManifest=JSON.parse(await readFile(new URL('../../visual-baseline/manifest.json',import.meta.url),'utf8'));
const row=(await readFile(originalManifest.sources.dataPath,'utf8')).split('\n').filter(Boolean).map(JSON.parse).find(x=>x.id===ref.id);
const book=row.expected.before.book;
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:ref.viewport,hasTouch:true});
 await page.route('**/api/live-token',route=>route.fulfill({json:{configured:false}}));
 await page.route('**/api/problems',route=>route.fulfill({json:{book,clarification:null,revision:1}}));
 await page.goto('http://localhost:5186');await page.locator('.app-shell[data-ready="true"]').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);
 const equation=page.locator('.equation-carousel li[data-focused="true"] .step-equation');
 const metrics=()=>equation.evaluate(element=>{const r=element.getBoundingClientRect(),m=element.querySelector('math')!.getBoundingClientRect(),s=getComputedStyle(element);return {scrollLeft:element.scrollLeft,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,overflowX:s.overflowX,touchAction:s.touchAction,scrollbarWidth:s.scrollbarWidth,rect:{x:r.x,y:r.y,width:r.width,height:r.height},mathRect:{x:m.x,right:m.right,width:m.width},tabIndex:element.tabIndex,activeTag:document.activeElement?.tagName,activeClass:document.activeElement?.className,spokenEquation:element.querySelector('math')?.getAttribute('aria-label')};});
 const before=await metrics();await page.screenshot({path:directory+'before.png',fullPage:true});
 await equation.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(200);const keyboard=await metrics();
 await equation.evaluate(element=>element.scrollLeft=0);
 const rect=await equation.boundingBox();const session=await page.context().newCDPSession(page);
 const point={x:rect!.x+rect!.width-25,y:rect!.y+rect!.height/2};
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
 for(let step=1;step<=12;step++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-step*18,y:point.y}]});await page.waitForTimeout(30);}
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(400);
 const touch=await metrics();await page.screenshot({path:directory+'after-touch-swipe.png',fullPage:true});
 await equation.evaluate(element=>element.scrollLeft=element.scrollWidth);await page.waitForTimeout(200);const farRight=await metrics();await page.screenshot({path:directory+'far-right.png',fullPage:true});
 await writeFile(directory+'report.json',JSON.stringify({case:item,lane:'Actual app replay of unchanged gold prestate from invalid baseline generation; no model call or output applied.',before,keyboard,touch,farRight},null,2)+'\n',{flag:'wx'});
}finally{await browser.close();}
