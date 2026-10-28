import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {PROJECT,ITEMS} from '../site/catalog.js';
const root=fileURLToPath(new URL('../site/',import.meta.url));
assert.equal(PROJECT.id,'joias-leopoldina');assert.equal(ITEMS.length,77);assert.equal(new Set(ITEMS.map(x=>x.id)).size,77);
assert.equal(ITEMS.filter(x=>x.type==='image').length,74);assert.equal(ITEMS.filter(x=>x.type==='video').length,3);
for(const item of ITEMS){assert(/^[ABV]\d{2}$/.test(item.id));for(const p of [item.src,item.thumbnail].filter(Boolean)){assert(p.startsWith('./media/'));assert(fs.existsSync(path.resolve(root,p)),p);}if(item.type==='video'){assert.equal(item.thumbnail,undefined);assert(item.src.endsWith('.mp4'));}}
assert(!fs.readdirSync(path.join(root,'media')).some(x=>x.toLowerCase().includes('poster')));
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of index.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))assert(fs.existsSync(path.resolve(root,match[1])),match[1]);
for(const file of ['index.html','app.js','state.js','styles.css','catalog.js']){const s=fs.readFileSync(path.join(root,file),'utf8');assert(!s.includes('C:/Users/')&&!s.includes('C:\\Users\\'),`Host path in ${file}`);}
console.log('Catálogo e caminhos estáticos aprovados: 74 imagens e 3 MP4, sem capas de vídeo.');
