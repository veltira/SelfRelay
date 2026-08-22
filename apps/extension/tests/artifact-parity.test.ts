import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const publicDir=resolve(here,'../public');
const artifactDir=resolve(here,'../../../artifacts/chrome-extension-unpacked');
const brandingDir=resolve(here,'../../../assets/branding');
async function text(root:string,name:string){return readFile(resolve(root,name),'utf8');}

function stableManifest(value:any){return{manifest_version:value.manifest_version,description:value.description,minimum_chrome_version:value.minimum_chrome_version,host_permissions:value.host_permissions,background:value.background,action:{default_popup:value.action?.default_popup},content_scripts:value.content_scripts};}
function pngInfo(buffer:Buffer){assert.equal(buffer.subarray(0,8).toString('hex'),'89504e470d0a1a0a','not a PNG');assert.equal(buffer.subarray(12,16).toString('ascii'),'IHDR','missing IHDR');const colorType=buffer[25];let offset=8,hasTransparencyChunk=false;while(offset+12<=buffer.length){const length=buffer.readUInt32BE(offset);const type=buffer.subarray(offset+4,offset+8).toString('ascii');if(type==='tRNS')hasTransparencyChunk=true;offset+=12+length;if(type==='IEND')break;}return{width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20),colorType,hasTransparencyChunk};}
function assertTransparencyCapable(info:ReturnType<typeof pngInfo>){assert.ok(info.colorType===4||info.colorType===6||(info.colorType===3&&info.hasTransparencyChunk),'PNG must preserve transparency');}

test('validated browser capabilities stay aligned while local transcription adds only offscreen permission',async()=>{const current=JSON.parse(await text(publicDir,'manifest.json'));const preserved=JSON.parse(await text(artifactDir,'manifest.json'));assert.deepEqual(stableManifest(current),stableManifest(preserved));for(const permission of preserved.permissions)assert.ok(current.permissions.includes(permission));assert.deepEqual(current.permissions.filter((item:string)=>!preserved.permissions.includes(item)),['offscreen']);assert.equal(current.name,'SelfRelay');assert.equal(current.version,'0.3.0');assert.equal(current.action.default_title,'SelfRelay');assert.match(current.content_security_policy.extension_pages,/wasm-unsafe-eval/);assert.doesNotMatch(current.content_security_policy.extension_pages,/https?:/);});

test('popup is workset-first and keeps legacy scopes secondary',async()=>{const popup=await text(publicDir,'popup.html');assert.match(popup,/Añadir pestañas/);assert.match(popup,/Elegir varias pestañas/);assert.match(popup,/id="tabPicker"/);for(const label of ['Pestaña','Página','Sitio'])assert.match(popup,new RegExp(`>${label}<`));assert.match(popup,/icons\/selfrelay-logo\.png/);assert.doesNotMatch(popup,/state-badge|trackingBadge|Seguir esta pestaña|Seguir esta URL|Seguir todo este sitio/);});

test('exit composer records and saves audio without any transcription surface',async()=>{const checkpoint=await text(publicDir,'checkpoint.html');for(const id of ['text','record','recording','timer','levelMeter','stopRecording','cancelRecording','audioReview','preview','redoRecording','checkpointTargets','chooseTargets','save'])assert.match(checkpoint,new RegExp(`id="${id}"`));assert.match(checkpoint,/¿Dónde quedaste\?/);assert.doesNotMatch(checkpoint,/Transcribiendo|Transcripción|transcript|Procesado en este dispositivo|CHECKPOINT DE SALIDA/i);const source=await text(resolve(publicDir,'../src'),'checkpoint.ts');assert.doesNotMatch(source,/transcribeLocally|TRANSCRIBE_CHECKPOINT/);assert.match(source,/transcript:null,transcriptionEngine:null/);});

test('recovery exposes transcription only behind an explicit user action',async()=>{const source=await text(resolve(publicDir,'../src'),'content.ts');assert.match(source,/Transcribir audio/);assert.match(source,/TRANSCRIBE_CHECKPOINT/);assert.match(source,/transcribe\.onclick=/);assert.doesNotMatch(source,/AI is transcribing|inteligencia artificial/i);});

test('visual system is neutral, IBM Plex based and rejects historical template styling',async()=>{const css=await text(publicDir,'ui.css');assert.match(css,/IBM Plex Sans/);assert.match(css,/fonts\/IBMPlexSans-Regular\.woff2/);assert.match(css,/#2563eb/i);assert.doesNotMatch(css,/#315f4c|#f5f5f2|#fffdf8|linear-gradient|glassmorphism|backdrop-filter/i);const checkpoint=await text(publicDir,'checkpoint.html');assert.doesNotMatch(checkpoint,/eyebrow|local-badge|state-badge/);});

test('official SelfRelay icon set is declared with correct dimensions and transparency',async()=>{const manifest=JSON.parse(await text(publicDir,'manifest.json'));for(const size of [16,32,48,128]){const relative=`icons/icon${size}.png`;assert.equal(manifest.icons[String(size)],relative);assert.equal(manifest.action.default_icon[String(size)],relative);const info=pngInfo(await readFile(resolve(publicDir,relative)));assert.deepEqual([info.width,info.height],[size,size]);assertTransparencyCapable(info);}const master=pngInfo(await readFile(resolve(brandingDir,'selfrelay-logo.png')));assert.ok(master.width>=128&&master.height>=128);assertTransparencyCapable(master);});
