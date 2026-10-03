import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),dist=path.join(root,'dist');
await mkdir(dist,{recursive:true});
const files={
 'control.html':'control.html','control.js':'control.js','common.js':'common.js',
 'styles.css':'styles.css','control.css':'control.css','logo.svg':'assets/logo.svg',
 'room-preview.png':'assets/room-preview.png','room.glb':'assets/models/room.glb'
};
for(const [source,target]of Object.entries(files)){
 const output=path.join(dist,target);await mkdir(path.dirname(output),{recursive:true});await copyFile(path.join(root,source),output);
}
const three=path.dirname(fileURLToPath(import.meta.resolve('three')));
const base=path.resolve(three,'..');
const queue=['build/three.module.js','examples/jsm/controls/OrbitControls.js','examples/jsm/loaders/GLTFLoader.js','examples/jsm/environments/RoomEnvironment.js'];
const copied=new Set();
while(queue.length){
 const relative=queue.shift();if(copied.has(relative))continue;copied.add(relative);
 const source=path.resolve(base,relative);if(!source.startsWith(base+path.sep))throw Error('Dependency path outside Three.js');
 const output=path.join(dist,'vendor/three',relative);await mkdir(path.dirname(output),{recursive:true});await copyFile(source,output);
 const text=await readFile(source,'utf8');
 for(const match of text.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["'](\.[^"']+\.js)["']/g)){
  const next=path.relative(base,path.resolve(path.dirname(source),match[1])).split(path.sep).join('/');queue.push(next);
 }
}
async function check(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await check(file);else if(entry.name==='index.html'||entry.name.startsWith('.')||/\.(mjs|py|blend)$/.test(entry.name))throw Error('Disallowed file in public output: '+file);}}
await check(dist);
console.log(`Control-only build: ${Object.keys(files).length} application assets + ${copied.size} Three.js modules; no overview or backend source.`);