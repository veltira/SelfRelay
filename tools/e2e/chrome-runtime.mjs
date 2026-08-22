import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const extensionDir=resolve(root,'apps/extension/dist');
const chromePath=process.env.SELFRELAY_CHROME;
const fixturePath=process.env.SELFRELAY_WEBM_FIXTURE;
const screenshotDir=resolve(process.env.SELFRELAY_E2E_SCREENSHOTS||join(root,'artifacts/e2e-screenshots'));
if(!chromePath)throw new Error('SELFRELAY_CHROME is required');
if(!fixturePath)throw new Error('SELFRELAY_WEBM_FIXTURE is required');
const fixture=await readFile(fixturePath);
assert.ok(fixture.length>1000,'WebM/Opus fixture is unexpectedly small');
await mkdir(screenshotDir,{recursive:true});

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host}`);
    if(url.pathname==='/work'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      res.end('<!doctype html><meta charset="utf-8"><title>SelfRelay E2E Work</title><main><h1>Trabajo de prueba</h1><p>Contexto real de recuperación.</p></main>');return;
    }
    if(url.pathname.startsWith('/ui/')){
      const relative=decodeURIComponent(url.pathname.slice(4));
      if(relative.includes('..'))throw new Error('unsafe path');
      const file=resolve(extensionDir,relative);assert.ok(file.startsWith(extensionDir));
      const body=await readFile(file);res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});res.end(body);return;
    }
    res.writeHead(404);res.end('not found');
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const address=server.address();if(!address||typeof address==='string')throw new Error('server failed');
const base=`http://127.0.0.1:${address.port}`;
const workUrl=`${base}/work`;
const profile=await mkdtemp(join(tmpdir(),'selfrelay-e2e-'));
let context;

try{
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:chromePath,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
  context.on('page',page=>page.on('console',message=>{if(message.type()==='error'||message.text().includes('SelfRelay'))console.log(`[page console] ${message.type()}: ${message.text()}`);}));
  let worker=context.serviceWorkers().find(item=>item.url().startsWith('chrome-extension://'));
  if(!worker){
    const deadline=Date.now()+20000;
    while(Date.now()<deadline&&!worker){await new Promise(r=>setTimeout(r,250));worker=context.serviceWorkers().find(item=>item.url().startsWith('chrome-extension://'));}
  }
  assert.ok(worker,'SelfRelay service worker did not start from the unpacked build');
  const extensionId=new URL(worker.url()).host;
  console.log(`SelfRelay extension id: ${extensionId}`);

  await renderPopupQa(context,base,screenshotDir);

  const work=await context.newPage();await work.goto(workUrl);await work.bringToFront();
  const tracked=await worker.evaluate(async url=>{const tabs=await chrome.tabs.query({url});if(!tabs[0]?.id)return{ok:false,error:'work_tab_not_found'};return chrome.runtime.sendMessage({type:'UPSERT_WORKSET',tabIds:[tabs[0].id]});},workUrl);
  assert.equal(tracked?.ok,true,JSON.stringify(tracked));

  const capturePromise=context.waitForEvent('page',{predicate:page=>page.url().includes('checkpoint.html?pending='),timeout:15000});
  await work.close();
  const capture=await capturePromise;await capture.waitForLoadState('domcontentloaded');
  await capture.screenshot({path:join(screenshotDir,'F-capture.png')});
  const markVisible=await capture.locator('.identity .logo').evaluate(img=>{const el=img;const r=el.getBoundingClientRect();return{complete:el.complete,naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight,width:r.width,height:r.height};});
  assert.equal(markVisible.complete,true);assert.equal(markVisible.naturalWidth,32);assert.equal(markVisible.naturalHeight,32);assert.ok(markVisible.width>=22&&markVisible.height>=22,'header mark is not visibly sized');

  const audioBase64=fixture.toString('base64');
  const saved=await capture.evaluate(async({audioBase64})=>{
    const pendingId=new URLSearchParams(location.search).get('pending');if(!pendingId)throw new Error('pending missing');
    const bytes=Uint8Array.from(atob(audioBase64),c=>c.charCodeAt(0));
    const blob=new Blob([bytes],{type:'audio/webm;codecs=opus'}),audioRef=`e2e-${crypto.randomUUID()}`;
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('selfrelay-audio',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('assets'))request.result.createObjectStore('assets',{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put({id:audioRef,blob,mimeType:blob.type,durationMs:5000,createdAt:new Date().toISOString()});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    db.close();
    return chrome.runtime.sendMessage({type:'SAVE_CHECKPOINT',pendingId,payload:{text:'',audioRef,audioMimeType:blob.type,audioDurationMs:5000,transcript:null,transcriptionEngine:null,targetMemberIds:null}});
  },{audioBase64});
  assert.equal(saved?.ok,true,JSON.stringify(saved));const checkpointId=saved.checkpoint.id;await capture.close();

  const resumed=await context.newPage();await resumed.goto(workUrl);
  await resumed.waitForFunction(()=>Boolean(document.querySelector('#checkpoint-recovery-root')?.shadowRoot),null,{timeout:15000});
  await resumed.screenshot({path:join(screenshotDir,'G-recovery.png')});
  const recoveryLogo=await resumed.evaluate(()=>{const img=document.querySelector('#checkpoint-recovery-root')?.shadowRoot?.querySelector('.brand-logo');if(!(img instanceof HTMLImageElement))return null;const r=img.getBoundingClientRect();return{complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,width:r.width,height:r.height};});
  assert.equal(recoveryLogo?.naturalWidth,32);assert.ok((recoveryLogo?.width||0)>=20,'recovery logo is not visible');

  const noAutoTranscript=await worker.evaluate(async id=>{const value=await chrome.storage.local.get('checkpoint:checkpoints');return (value['checkpoint:checkpoints']||[]).find(item=>item.id===id)?.transcript??null;},checkpointId);
  assert.equal(noAutoTranscript,null,'transcription started before explicit user action');
  await resumed.evaluate(()=>{const shadow=document.querySelector('#checkpoint-recovery-root')?.shadowRoot;const button=[...(shadow?.querySelectorAll('button')||[])].find(item=>item.textContent?.includes('Transcribir audio'));if(!(button instanceof HTMLButtonElement))throw new Error('Transcribir audio button missing');button.click();});

  const offscreenDeadline=Date.now()+15000;let offscreenCount=0;
  while(Date.now()<offscreenDeadline){offscreenCount=await worker.evaluate(async()=>{const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});return contexts.length;});if(offscreenCount)break;await new Promise(r=>setTimeout(r,150));}
  assert.equal(offscreenCount,1,'expected exactly one offscreen document');
  const diagnostics=await worker.evaluate(()=>chrome.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_DIAGNOSTICS'}));
  console.log('SelfRelay offscreen diagnostics:',JSON.stringify(diagnostics));
  assert.deepEqual({crossOriginIsolated:diagnostics.crossOriginIsolated,sharedArrayBuffer:diagnostics.sharedArrayBuffer,audioContext:diagnostics.audioContext,indexedDb:diagnostics.indexedDb},{crossOriginIsolated:true,sharedArrayBuffer:true,audioContext:true,indexedDb:true});

  await resumed.waitForFunction(()=>{const editor=document.querySelector('#checkpoint-recovery-root')?.shadowRoot?.querySelector('.transcript-editor');return editor instanceof HTMLTextAreaElement&&editor.value.trim().length>0;},null,{timeout:240000});
  const transcript=await resumed.evaluate(()=>document.querySelector('#checkpoint-recovery-root')?.shadowRoot?.querySelector('.transcript-editor')?.value?.trim()||'');
  console.log(`SelfRelay browser transcript: ${transcript}`);
  const tokens=['hola','prueba','sistema','reconocimiento'];const normalized=transcript.toLocaleLowerCase('es');const score=tokens.filter(token=>normalized.includes(token)).length;
  assert.ok(score>=2,`browser transcript did not retain enough Spanish keywords (${score}/4): ${transcript}`);
  const persisted=await worker.evaluate(async id=>{const value=await chrome.storage.local.get('checkpoint:checkpoints');return (value['checkpoint:checkpoints']||[]).find(item=>item.id===id)?.transcript??null;},checkpointId);
  assert.equal(persisted,transcript,'transcript was not persisted by the real background path');

  const cleared=await worker.evaluate(id=>chrome.runtime.sendMessage({type:'UPDATE_CHECKPOINT_TRANSCRIPT',checkpointId:id,text:''}),checkpointId);assert.equal(cleared?.ok,true);
  const second=await worker.evaluate(id=>chrome.runtime.sendMessage({type:'TRANSCRIBE_CHECKPOINT',checkpointId:id,language:'es'}),checkpointId);
  assert.equal(second?.ok,true,`offscreen reuse failed: ${JSON.stringify(second)}`);
  const offscreenAfter=await worker.evaluate(async()=>{const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});return contexts.length;});
  assert.equal(offscreenAfter,1,'offscreen document was duplicated during reuse');
  console.log('SelfRelay packaged Chrome runtime E2E: PASS');
}finally{
  if(context)await context.close();
  server.close();
  await rm(profile,{recursive:true,force:true});
}

async function renderPopupQa(context,base,screenshotDir){
  const empty={ok:true,supported:true,tab:{id:11,windowId:1,url:'https://docs.google.com/document/d/selfrelay-demo/edit',title:'Documentos de Google — Plan de lanzamiento',faviconUrl:null},context:null};
  const members=[
    {id:'m1',url:'https://github.com/veltira/SelfRelay/pull/7',title:'SelfRelay · Pull request',faviconUrl:null,order:0,addedAt:'2026-08-22T18:00:00Z'},
    {id:'m2',url:'https://developer.chrome.com/docs/extensions/',title:'Chrome Extensions documentation',faviconUrl:null,order:1,addedAt:'2026-08-22T18:00:00Z'},
    {id:'m3',url:'https://docs.google.com/document/d/selfrelay-demo/edit',title:'Documentos de Google — Plan de lanzamiento',faviconUrl:null,order:2,addedAt:'2026-08-22T18:00:00Z'}
  ];
  const active={...empty,context:{id:'ctx',type:'browser',contextKey:'browser:workset:ctx',scope:'url',url:members[0].url,origin:'https://github.com',title:'SelfRelay work',faviconUrl:null,trackedTabId:null,members,createdAt:'2026-08-22T18:00:00Z',updatedAt:'2026-08-22T18:00:00Z'}};
  const tabs=members.map((member,index)=>({id:index+20,windowId:1,url:member.url,title:member.title,faviconUrl:null,selected:index===2,memberId:index===2?member.id:null,conflictContextId:null}));
  const make=async(state,name)=>{
    const page=await context.newPage();
    await page.addInitScript(({state,tabs})=>{window.__SELFRELAY_QA__={state,tabs};const runtime={sendMessage:async message=>{if(message.type==='GET_ACTIVE_STATE')return window.__SELFRELAY_QA__.state;if(message.type==='LIST_ELIGIBLE_TABS')return{ok:true,tabs:window.__SELFRELAY_QA__.tabs};return{ok:true};}};try{Object.defineProperty(window.chrome,'runtime',{value:runtime,configurable:true});}catch{window.chrome.runtime=runtime;}},{state,tabs});
    await page.goto(`${base}/ui/popup.html`);await page.waitForSelector('#state .current-title');await page.screenshot({path:join(screenshotDir,name)});return page;
  };
  const emptyPage=await make(empty,'A-popup-empty.png');
  const toggle=emptyPage.locator('#simpleToggle');const panel=emptyPage.locator('#simplePanel');
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await panel.evaluate(el=>getComputedStyle(el).display),'none');
  await emptyPage.screenshot({path:join(screenshotDir,'D-advanced-closed.png')});
  for(const expected of [true,false,true,false,true]){await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),String(expected));assert.equal(await panel.evaluate(el=>getComputedStyle(el).display==='none'),!expected);}
  await emptyPage.screenshot({path:join(screenshotDir,'E-advanced-open.png')});
  const chevronTransform=await emptyPage.locator('.disclosure-chevron').evaluate(el=>getComputedStyle(el).transform);assert.notEqual(chevronTransform,'none','expanded disclosure chevron did not rotate');
  await emptyPage.close();
  const activePage=await make(active,'B-popup-active.png');await activePage.close();
  const pickerPage=await make(empty,'C-popup-picker.png');await pickerPage.locator('#addTabsEmpty').click();assert.notEqual(await pickerPage.locator('#tabPicker').evaluate(el=>getComputedStyle(el).display),'none');await pickerPage.screenshot({path:join(screenshotDir,'C-popup-picker.png')});await pickerPage.close();
}
