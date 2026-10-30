/** Check the actual installed optional package, including files Next consumes. */
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const postcss=require(require.resolve('postcss',{paths:[dirname(require.resolve('next/package.json'))]}));
const root=resolve(process.argv[2]??'node_modules/@opencoven/research');
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
let count=0;
for(const file of await walk(resolve(root,'dist'))){
 if(file.endsWith('.css')){
  postcss.parse(await readFile(file,'utf8'),{from:file}).walkRules(rule=>assert.ok(rule.selector.trim(),`Empty selector in ${file}`));
  count++;
 }else if(file.endsWith('.js')){
  const source=await readFile(file,'utf8');
  assert.doesNotMatch(source,/(?:from\s+|import\s*\(\s*)["']\.{1,2}\/[^"']+\.tsx?["']/,`Uncompiled module reference in ${file}`);
 }
}
console.log(`Research patch: ${count} compiled styles parsed; static and dynamic imports use compiled paths.`);
