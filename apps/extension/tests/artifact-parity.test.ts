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

function functionalManifest(value:any){return{manifest_version:value.manifest_version,description:value.description,minimum_chrome_version:value.minimum_chrome_version,permissions:value.permissions,host_permissions:value.host_permissions,background:value.background,action:{default_popup:value.action?.default_popup},content_scripts:value.content_scripts};}
function pngInfo(buffer:Buffer){assert.equal(buffer.subarray(0,8).toString('hex'),'89504e470d0a1a0a','not a PNG');assert.equal(buffer.subarray(12,16).toString('ascii'),'IHDR','missing IHDR');const colorType=buffer[25];let offset=8,hasTransparencyChunk=false;while(offset+12<=buffer.length){const length=buffer.readUInt32BE(offset);const type=buffer.subarray(offset+4,offset+8).toString('ascii');if(type==='tRNS')hasTransparencyChunk=true;offset+=12+length;if(type==='IEND')break;}return{width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20),colorType,hasTransparencyChunk};}
function assertTransparencyCapable(info:ReturnType<typeof pngInfo>){assert.ok(info.colorType===4||info.colorType===6||(info.colorType===3&&info.hasTransparencyChunk),'PNG must preserve transparency');}

test('functional browser capabilities remain aligned while audio adds no remote permission',async()=>{const current=JSON.parse(await text(publicDir,'manifest.json'));const preserved=JSON.parse(await text(artifactDir,'manifest.json'));assert.deepEqual(functionalManifest(current),functionalManifest(preserved));assert.equal(current.name,'SelfRelay');assert.equal(current.version,'0.2.0');assert.equal(current.action.default_title,'SelfRelay');assert.match(current.content_security_policy.extension_pages,/wasm-unsafe-eval/);assert.doesNotMatch(current.content_security_policy.extension_pages,/https?:/);});

test('popup uses compact scope selection and one tracking action',async()=>{const popup=await text(publicDir,'popup.html');for(const label of ['Pestaña','Página','Sitio'])assert.match(popup,new RegExp(`>${label}<`));assert.equal((popup.match(/id="followToggle"/g)||[]).length,1);assert.match(popup,/icons\/selfrelay-logo\.png/);assert.doesNotMatch(popup,/Seguir esta pestaña|Seguir esta URL|Seguir todo este sitio/);});

test('checkpoint composer exposes text audio recording transcript and local privacy state',async()=>{const checkpoint=await text(publicDir,'checkpoint.html');for(const id of ['text','record','recording','timer','levelMeter','stopRecording','cancelRecording','audioReview','preview','redoRecording','transcript','save'])assert.match(checkpoint,new RegExp(`id="${id}"`));assert.match(checkpoint,/¿Dónde quedaste\?/);assert.match(checkpoint,/Procesado en este dispositivo/);assert.doesNotMatch(checkpoint,/AI is transcribing|IA está transcribiendo|inteligencia artificial/i);});

test('visual system rejects the historical cream green palette',async()=>{const css=await text(publicDir,'ui.css');assert.doesNotMatch(css,/#315f4c|#f5f5f2|#fffdf8/i);assert.match(css,/#2463eb/i);assert.match(css,/#0891b2/i);assert.match(css,/Segoe UI Variable/);});

test('official SelfRelay icon set is declared with correct dimensions and transparency',async()=>{const manifest=JSON.parse(await text(publicDir,'manifest.json'));for(const size of [16,32,48,128]){const relative=`icons/icon${size}.png`;assert.equal(manifest.icons[String(size)],relative);assert.equal(manifest.action.default_icon[String(size)],relative);const info=pngInfo(await readFile(resolve(publicDir,relative)));assert.deepEqual([info.width,info.height],[size,size]);assertTransparencyCapable(info);}const master=pngInfo(await readFile(resolve(brandingDir,'selfrelay-logo.png')));assert.ok(master.width>=128&&master.height>=128);assertTransparencyCapable(master);});
