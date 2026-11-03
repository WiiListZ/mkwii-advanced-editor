// Regression for the black window on release of a long freehand stroke, and 2D zoom.
import puppeteer from 'puppeteer-core';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
const temp=await mkdtemp(join(tmpdir(),'mkwii-complex-drawing-'));
await writeFile(join(temp,'settings.json'),JSON.stringify({tourDone:true,discordActivity:false,tracksMovedNoticeSeen:true}));
const reservation=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('')}),port=reservation.port;reservation.stop(true);
const child=Bun.spawn([resolve(process.env.MKWII_TEST_EXE||'release/MKWiiAdvancedEditor.exe')],{env:{...process.env,MKWII_SETTINGS_DIR:temp,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},stdout:'ignore',stderr:'inherit',windowsHide:true});
let browser:any;
const check=(ok:boolean,message:string)=>{if(!ok)throw Error(message);console.log('ok: '+message);};
try {
  for(let i=0;;i++){try{if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}if(i===150)throw Error('Debugger unavailable');await Bun.sleep(100);}
  browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`});let page:any;
  for(let i=0;;i++){page=(await browser.pages()).find((p:any)=>p.url().startsWith('http://127.0.0.1:'));if(page)break;if(i===150)throw Error('Page unavailable');await Bun.sleep(100);}
  const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
  await page.setViewport({width:1400,height:1100});await page.waitForFunction(()=>!!(window as any).app);
  await page.evaluate(()=>{void(window as any).app.cmd('newTrack');});await page.waitForSelector('[data-map-zoom]');
  await page.$eval('[role="dialog"]',async(e:HTMLElement)=>{await Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})));});await page.evaluate(()=>document.fonts.ready);
  const settle=()=>page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));
  const value=(label:string)=>page.$eval(`[aria-label="${label}"]`,(e:HTMLInputElement)=>Number(e.value));
  const enter=async(label:string,text:string)=>{await page.click(`[aria-label="${label}"]`);await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(text);await page.keyboard.press('Tab');await settle();};
  const drawTool=()=>page.evaluate(()=>{([...document.querySelectorAll('[role="toolbar"] button')].find(e=>e.textContent?.trim()==='Draw by hand') as HTMLElement).click();});
  await drawTool();await enter('Drawing area width','100000');
  await page.click('[aria-label="Zoom 2D map in"]');await settle();check(await value('Drawing area width')<100000,'zoom in changes the 2D view');
  await page.click('[aria-label="Zoom 2D map out"]');await settle();check(Math.abs(await value('Drawing area width')-100000)<1,'zoom out restores the view');
  const thumb='[aria-label="2D map zoom"] [role="slider"]';
  await page.focus(thumb);await page.keyboard.press('Home');await settle();check(await value('Drawing area width')===500000,'zoom slider reaches the widest drawing area');
  check(await page.$eval('[aria-label="Zoom 2D map out"]',(e:HTMLButtonElement)=>e.disabled),'zoom out stops at its limit');
  await page.focus(thumb);await page.keyboard.press('End');await settle();check(await value('Drawing area width')===2000,'zoom slider reaches the closest view');
  check(await value('Track map width')===44000&&await value('Track map depth')===26000,'view zoom preserves the real map dimensions');
  await page.click('[aria-label="Show 3D preview"]');await page.waitForSelector('[aria-label="3D track preview"]');
  check(!await page.$('[data-map-zoom]'),'2D zoom controls are hidden in 3D');
  await page.click('[aria-label="Show 2D layout"]');await drawTool();await enter('Drawing area width','500000');
  const shape=Array.from({length:721},(_,i)=>{const t=i/720*Math.PI*2;return{x:320+245*Math.cos(t*3),z:215+160*Math.sin(t*7)};});
  const box=await(await page.$('[data-testid="generator-canvas"]')).boundingBox(),screen=(p:any)=>[box.x+p.x/640*box.width,box.y+p.z/430*box.height];
  await page.mouse.move(...screen(shape[0]));await page.mouse.down();for(const p of shape.slice(1))await page.mouse.move(...screen(p));await page.mouse.up();await settle();
  check(await page.evaluate(()=>!!document.querySelector('[data-height-controls]')&&(document.getElementById('root')?.textContent?.length||0)>1000),'releasing a complex stroke keeps the dialog and application visible');
  check(await page.evaluate(()=>!document.body.textContent?.includes('Could not update the track preview')),'the complex preview succeeds without using error recovery');
  const width=await value('Track map width');check(width>300000,'the complex stroke retains its full layout size');
  await page.click('[aria-label="Road control point"]');const count=await page.$$eval('[role="option"]',(els:Element[])=>els.length);await page.keyboard.press('Escape');
  check(count>100&&count<=256,'the complex stroke retains detailed editable control points');
  await page.click('[aria-label="Undo"]');await settle();check(await value('Track map width')===44000,'Undo restores the preceding layout');
  await page.click('[aria-label="Redo"]');await settle();check(await value('Track map width')===width,'Redo safely restores the complex layout');
  await page.click('[aria-label="Zoom 2D map in"]');await settle();check(await value('Track map width')===width,'zoom remains usable after drawing a complex track');
  await page.mouse.move(1250,80);await page.screenshot({path:'.cache/freehand-complex-fixed.png'});
  check(!errors.length,'complex freehand and 2D zoom produce no browser errors');
} finally {
  if(browser){for(const page of await browser.pages())await page.evaluate(()=>{if((window as any).__winctl)void(window as any).__winctl('close');}).catch(()=>{});browser.disconnect();}
  child.kill();await child.exited;
  if(!resolve(temp).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe cleanup');
  for(let i=0;;i++){try{await rm(temp,{recursive:true,force:true});break;}catch(e:any){if(i===120||!['EBUSY','EPERM','ENOTEMPTY'].includes(e.code))throw e;await Bun.sleep(250);}}
}
