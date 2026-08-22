#!/usr/bin/env node
import {mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';

const extensionDir=resolve(process.argv[2]||'apps/extension/dist');
const screenshotsDir=resolve(process.env.SELFRELAY_SCREENSHOTS_DIR||'artifacts/chrome-e2e-screenshots');
await rm(screenshotsDir,{recursive:true,force:true});
await mkdir(screenshotsDir,{recursive:true});

const titles={one:'Trabajo uno',two:'Trabajo dos',three:'Trabajo tres',four:'Trabajo cuatro',retry:'Trabajo de reintento',capture:'Documento para retomar'};
const server=createServer((request,response)=>{const key=String(request.url||'/').split('?')[0].slice(1)||'one',title=titles[key]||'SelfRelay QA';response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;margin:0;background:#f4f6f8;color:#172033}main{max-width:860px;margin:70px auto;padding:28px;background:#fff;border:1px solid #d9dee6;border-radius:10px}h1{margin:0 0 8px;font-size:26px}p{color:#667085}</style><main><h1>${title}</h1><p>Página de trabajo para QA de SelfRelay.</p></main>`);});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const address=server.address();if(!address||typeof address==='string')throw new Error('fixture_server_failed');
const urlFor=key=>`http://127.0.0.1:${address.port}/${key}`;

const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,viewport:{width:720,height:820},args:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const consoleErrors=[];const pageErrors=[];
function watch(page){page.on('console',message=>{if(message.type()==='error')consoleErrors.push(`${page.url()} :: ${message.text()}`);});page.on('pageerror',error=>pageErrors.push(`${page.url()} :: ${error?.stack||error?.message||String(error)}`));}
context.on('page',watch);for(const page of context.pages())watch(page);

async function screenshotElement(page,selector,name){const locator=page.locator(selector);await locator.waitFor({state:'visible'});await locator.screenshot({path:resolve(screenshotsDir,name)});}
async function assertEnabled(page,selector,label){const locator=page.locator(selector);await locator.waitFor({state:'visible'});if(!await locator.isEnabled())throw new Error(`control_disabled:${label}`);}
async function waitPopupReady(page){await page.waitForFunction(()=>{const state=document.querySelector('#state'),actions=document.querySelector('#emptyActions'),workset=document.querySelector('#worksetSection');return document.readyState!=='loading'&&state?.textContent?.trim()&&((actions instanceof HTMLElement&&!actions.hidden)||(workset instanceof HTMLElement&&!workset.hidden));},null,{timeout:10000});}
async function openExtensionPage(serviceWorker,extensionId,path){const url=`chrome-extension://${extensionId}/${path}`;await serviceWorker.evaluate(url=>chrome.tabs.create({url,active:false}),url);let page=context.pages().find(item=>item.url()===url);if(!page)page=await context.waitForEvent('page',{predicate:item=>item.url()===url,timeout:10000});await page.waitForLoadState('domcontentloaded');return page;}
async function memberCount(page,count){await page.waitForFunction(expected=>document.querySelectorAll('.member-row').length===expected,count,{timeout:10000});const label=(await page.locator('#memberCount').textContent())?.trim()||'';if(count===1&&!label.includes('1 pestaña seguida'))throw new Error(`member_count_label:${label}`);if(count>1&&!label.includes(`${count} pestañas seguidas`))throw new Error(`member_count_label:${label}`);}
async function checkPickerRow(page,title){const row=page.locator('.picker-row').filter({hasText:title});if(await row.count()!==1)throw new Error(`picker_row_missing:${title}`);const input=row.locator('input');if(!await input.isChecked())await input.check();}
async function removeMemberRow(page,title){const row=page.locator('.member-row').filter({hasText:title});if(await row.count()!==1)throw new Error(`member_row_missing:${title}`);const button=row.locator('.remove-member');if(!await button.isEnabled())throw new Error(`remove_disabled:${title}`);await button.click();}

try{
  let [serviceWorker]=context.serviceWorkers();if(!serviceWorker)serviceWorker=await context.waitForEvent('serviceworker',{timeout:30000});
  if(!serviceWorker.url().endsWith('/background.js'))throw new Error(`unexpected_service_worker:${serviceWorker.url()}`);
  const extensionId=new URL(serviceWorker.url()).host;

  const one=await context.newPage();await one.goto(urlFor('one'));
  const two=await context.newPage();await two.goto(urlFor('two'));
  const three=await context.newPage();await three.goto(urlFor('three'));
  const four=await context.newPage();await four.goto(urlFor('four'));
  await one.bringToFront();

  const popup=await openExtensionPage(serviceWorker,extensionId,'popup.html');
  await waitPopupReady(popup);
  await assertEnabled(popup,'#createContext','follow_current_initial');
  await assertEnabled(popup,'#addTabsEmpty','follow_multiple_initial');
  await screenshotElement(popup,'.popup-shell','01-popup-initial.png');

  await popup.locator('#createContext').click();
  await popup.locator('#worksetSection').waitFor({state:'visible'});await memberCount(popup,1);
  await assertEnabled(popup,'#addTabs','add_after_follow');await assertEnabled(popup,'#stopTracking','stop_after_follow');
  await screenshotElement(popup,'.popup-shell','02-popup-one-tab.png');

  await popup.locator('#addTabs').click();await popup.locator('#tabPicker').waitFor({state:'visible'});
  await assertEnabled(popup,'#saveTabs','picker_save_immediate');
  await screenshotElement(popup,'.popup-shell','04-popup-picker-open.png');
  await checkPickerRow(popup,'Trabajo dos');await checkPickerRow(popup,'Trabajo tres');
  await popup.locator('#saveTabs').click();await popup.locator('#tabPicker').waitFor({state:'hidden'});await memberCount(popup,3);
  await assertEnabled(popup,'#addTabs','add_after_save');await assertEnabled(popup,'#stopTracking','stop_after_save');
  await screenshotElement(popup,'.popup-shell','03-popup-three-tabs.png');

  await removeMemberRow(popup,'Trabajo dos');await memberCount(popup,2);await assertEnabled(popup,'#addTabs','add_after_remove');await assertEnabled(popup,'#stopTracking','stop_after_remove');
  await popup.locator('#addTabs').click();await popup.locator('#tabPicker').waitFor({state:'visible'});await checkPickerRow(popup,'Trabajo cuatro');await popup.locator('#saveTabs').click();await popup.locator('#tabPicker').waitFor({state:'hidden'});await memberCount(popup,3);await assertEnabled(popup,'#addTabs','add_after_second_save');

  await popup.locator('#stopTracking').click();await popup.locator('#emptyActions').waitFor({state:'visible'});await assertEnabled(popup,'#createContext','follow_after_stop');await assertEnabled(popup,'#addTabsEmpty','multiple_after_stop');
  await popup.locator('#createContext').click();await popup.locator('#worksetSection').waitFor({state:'visible'});await memberCount(popup,1);await assertEnabled(popup,'#addTabs','add_after_refollow');

  await removeMemberRow(popup,'Trabajo uno');await popup.locator('#emptyActions').waitFor({state:'visible'});await assertEnabled(popup,'#createContext','follow_after_last_remove');

  // Real failure: keep a stale selected tab in the picker, close that actual tab, then save.
  await popup.locator('#addTabsEmpty').click();await popup.locator('#tabPicker').waitFor({state:'visible'});await checkPickerRow(popup,'Trabajo uno');
  const oneTabId=await serviceWorker.evaluate(url=>new Promise(resolve=>chrome.tabs.query({},tabs=>resolve(tabs.find(tab=>tab.url===url)?.id??null))),urlFor('one'));
  if(!oneTabId)throw new Error('active_fixture_tab_missing');await serviceWorker.evaluate(id=>chrome.tabs.remove(id),oneTabId);
  await popup.locator('#saveTabs').click();await popup.locator('#popupStatus').waitFor({state:'visible'});const errorText=(await popup.locator('#popupStatus').textContent())?.trim()||'';if(!errorText.includes('No se pudo guardar'))throw new Error(`real_error_not_surface:${errorText}`);
  await assertEnabled(popup,'#saveTabs','save_released_after_error');await assertEnabled(popup,'#closePicker','close_released_after_error');
  await popup.locator('#closePicker').click();

  const retry=await context.newPage();await retry.goto(urlFor('retry'));await retry.bringToFront();
  await popup.locator('#addTabsEmpty').click();await popup.locator('#tabPicker').waitFor({state:'visible'});await checkPickerRow(popup,'Trabajo de reintento');await popup.locator('#saveTabs').click();await popup.locator('#tabPicker').waitFor({state:'hidden'});await memberCount(popup,1);await assertEnabled(popup,'#addTabs','retry_success_enabled');
  console.log('Popup hot state machine: PASS');

  // Seed one real pending capture; the capture page itself uses the real extension background and storage.
  const captureUrl=urlFor('capture'),now=new Date().toISOString(),contextId='qa-capture-context',memberId='qa-capture-member',pendingId='qa-capture-pending';
  await serviceWorker.evaluate(({captureUrl,now,contextId,memberId,pendingId})=>chrome.storage.local.set({
    'checkpoint:contexts':[{id:contextId,type:'browser',contextKey:`browser:workset:${contextId}`,scope:'url',url:captureUrl,origin:new URL(captureUrl).origin,title:'Documento para retomar',faviconUrl:null,trackedTabId:null,members:[{id:memberId,url:captureUrl,title:'Documento para retomar',faviconUrl:null,order:0,addedAt:now}],createdAt:now,updatedAt:now}],
    'checkpoint:pendingCaptures':[{id:pendingId,contextId,url:captureUrl,title:'Documento para retomar',closedAt:now,memberId,closedMembers:[{memberId,url:captureUrl,title:'Documento para retomar',faviconUrl:null}],defaultTargetMemberIds:[memberId],exitSessionId:'qa',exitKind:'tab',sourceKey:'qa'}],
    'checkpoint:checkpoints':[]
  }),{captureUrl,now,contextId,memberId,pendingId});

  const capture=await openExtensionPage(serviceWorker,extensionId,`checkpoint.html?pending=${encodeURIComponent(pendingId)}`);
  await capture.locator('#record').waitFor({state:'visible'});await assertEnabled(capture,'#record','capture_record');
  if(!await capture.locator('#text').isVisible())throw new Error('capture_text_missing');if(!await capture.getByText('Escribí una nota',{exact:true}).isVisible())throw new Error('capture_note_label_missing');if(!await capture.getByText('Grabar nota de voz',{exact:true}).isVisible())throw new Error('capture_voice_action_missing');
  await screenshotElement(capture,'.capture-shell','05-capture-empty.png');
  await capture.locator('#text').fill('Retomar la revisión desde el segundo apartado.');
  await capture.locator('#record').click();await capture.locator('#recording').waitFor({state:'visible'});if(!await capture.getByText('Grabando',{exact:true}).isVisible())throw new Error('recording_state_missing');
  await new Promise(resolve=>setTimeout(resolve,900));await screenshotElement(capture,'.capture-shell','06-capture-recording.png');
  await capture.locator('#stopRecording').click();await capture.locator('#audioReview').waitFor({state:'visible',timeout:10000});if(!await capture.getByText('Nota de voz',{exact:true}).isVisible())throw new Error('audio_review_missing');if(!await capture.locator('#preview').getAttribute('src'))throw new Error('audio_preview_missing');
  await screenshotElement(capture,'.capture-shell','07-capture-audio-ready.png');
  await capture.locator('#save').click();
  await serviceWorker.waitForFunction(()=>true);
  await new Promise(resolve=>setTimeout(resolve,500));
  const saved=await serviceWorker.evaluate(()=>chrome.storage.local.get(['checkpoint:checkpoints','checkpoint:pendingCaptures']));const checkpoints=saved['checkpoint:checkpoints']||[],pending=saved['checkpoint:pendingCaptures']||[];if(checkpoints.length!==1||pending.length!==0)throw new Error(`capture_save_failed:${JSON.stringify({checkpoints:checkpoints.length,pending:pending.length})}`);if(!checkpoints[0].audioRef||checkpoints[0].originalText!=='Retomar la revisión desde el segundo apartado.')throw new Error('capture_payload_failed');
  console.log('Capture note + MediaRecorder review + save: PASS');

  const recovery=await context.newPage();await recovery.goto(captureUrl);await recovery.waitForFunction(()=>Boolean(document.getElementById('checkpoint-recovery-root')),{timeout:10000});
  const recoveryState=await recovery.evaluate(()=>{const host=document.getElementById('checkpoint-recovery-root'),shadow=host?.shadowRoot,brand=shadow?.querySelector('.brand-logo'),panel=shadow?.querySelector('.panel');return{hasHost:Boolean(host),hasPanel:Boolean(panel),brandLoaded:brand instanceof HTMLImageElement&&brand.complete&&brand.naturalWidth>0,text:shadow?.textContent||''};});if(!recoveryState.hasPanel||!recoveryState.brandLoaded||!recoveryState.text.includes('Retomar la revisión'))throw new Error(`recovery_render_failed:${JSON.stringify(recoveryState)}`);
  await recovery.screenshot({path:resolve(screenshotsDir,'08-recovery.png'),fullPage:true});
  console.log('Recovery visual QA surface: PASS');

  if(pageErrors.length)throw new Error(`page_errors:${JSON.stringify(pageErrors)}`);
  if(consoleErrors.length)throw new Error(`console_errors:${JSON.stringify(consoleErrors)}`);
  console.log(`SelfRelay product E2E screenshots: ${screenshotsDir}`);console.log('SelfRelay product E2E: PASS');
}finally{await context.close();await new Promise(resolve=>server.close(resolve));}
