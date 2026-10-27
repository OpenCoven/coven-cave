/** Regenerate only the compiled files changed by the Research modal patch.
 * Usage: node scripts/research/build-modal-patch.mjs /path/to/patched/package
 * Apply the tracked patch to the original v0.1.0 tarball before running.
 */
import {readFile, writeFile, copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {transform} from 'esbuild';
const root=process.argv[2];
if(!root) throw new Error('Pass the patched Research package directory.');
const names=['research-studio-modals','research-github-repo-viewer','research-tab-desk','research-tab-resources','research-reader','research-artifact-actions','research-prompt-builder','research-tab-library'];
for(const name of names){
 const source=await readFile(resolve(root,`src/components/role-surfaces/${name}.tsx`),'utf8');
 const {code}=await transform(source,{loader:'tsx',format:'esm',target:'es2022',jsx:'automatic'});
 // Match the published package's explicit ESM extension contract.
 const compiled=code.replace(/((?:from\s+|import\s*\(\s*)["']\.{1,2}\/[^"']+)\.tsx?(["'])/g,'$1.js$2');
 await writeFile(resolve(root,`dist/components/role-surfaces/${name}.js`),compiled);
}
{
 const source=await readFile(resolve(root,'src/components/research-resource-browser-modal.tsx'),'utf8');
 const {code}=await transform(source,{loader:'tsx',format:'esm',target:'es2022',jsx:'automatic'});
 await writeFile(resolve(root,'dist/components/research-resource-browser-modal.js'),code.replace(/((?:from\s+|import\s*\(\s*)["']\.{1,2}\/[^"']+)\.tsx?(["'])/g,'$1.js$2'));
}
for(const name of ['research-reader.css','research-github-repo-viewer.css','research-paper-focus-reader.css','globals/surface-research-studio.css','globals/surface-research-resources.css','globals/surface-research-prompt.css']){
 await copyFile(resolve(root,`src/styles/${name}`),resolve(root,`dist/styles/${name}`));
}
console.log('Research modal patch: nine compiled modules and six styles regenerated.');
