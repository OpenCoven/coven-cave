/** Prevent feature-owned modal shells, including role spreads and DOM builders. */
import ts from 'typescript';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('..',import.meta.url));
// These are deliberately nonmodal anchored/persistent controls, not exemptions
// for new modals. Counts ratchet: adding another declaration needs classification.
const boundaries = new Map([
 ['src/components/ui/modal.tsx', [1, 'Canonical modal foundation']],
 ['src/components/ui/popover.tsx', [1, 'Canonical anchored nonmodal Popover']],
 ['src/components/board-view.tsx', [1, 'Inline confirmation callout; board remains interactive']],
 ['src/components/notification-bell.tsx', [1, 'Anchored notification panel; light dismiss']],
 ['src/components/task-link-picker.tsx', [1, 'Anchored link selector; light dismiss']],
 ['src/components/familiar-switcher.tsx', [1, 'Anchored familiar selector; light dismiss']],
 ['src/components/automations/cron-detail-panel.tsx', [1, 'Persistent desktop cron details; list remains interactive']],
 ['src/components/automations/reminder-detail-panel.tsx', [1, 'Persistent desktop reminder details; list remains interactive']],
 ['src/components/role-surfaces/x-comms-surface.tsx', [2, 'Anchored budget and revisions popovers']],
]);
const findings=[];
export function findModalDeclarations(source, file){
 const findings=[];
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 // Resolve only local literal bindings, respecting lexical shadowing. Unknown
 // runtime values stay unknown; this is a bounded architecture guard, not a compiler.
 const bindings = new Map();
 const isScope = node => ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node);
 function declare(node, name, value) {
   let scope = node.parent;
   while (scope && !isScope(scope)) scope = scope.parent;
   if (!scope) return;
   if (!bindings.has(scope)) bindings.set(scope, new Map());
   bindings.get(scope).set(name, value);
 }
 function collect(node) {
   if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declare(node, node.name.text, node.initializer);
   if (ts.isParameter(node) && ts.isIdentifier(node.name)) declare(node, node.name.text, undefined);
   ts.forEachChild(node, collect);
 }
 collect(ast);
 function values(expression, at, visited = new Set()) {
   if (!expression || visited.size > 12 || visited.has(expression)) return [];
   const next = new Set(visited).add(expression);
   if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return [expression.text];
   if (ts.isJsxExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return values(expression.expression, at, next);
   if (ts.isConditionalExpression(expression)) return [...values(expression.whenTrue, at, next), ...values(expression.whenFalse, at, next)];
   if (ts.isIdentifier(expression)) {
     for (let scope = at; scope; scope = scope.parent) {
       const table = bindings.get(scope);
       if (table?.has(expression.text)) return values(table.get(expression.text), scope, next);
     }
   }
   return [];
 }
 const seen=new Set();
 const record=(node,kind)=>{const position=node.getStart();const line=ast.getLineAndCharacterOfPosition(position).line+1;const key=`${position}:${kind}`;if(!seen.has(key)){findings.push({file:relative(repo,file),line,kind});seen.add(key);}};
 const dialog=value=>/\b(?:alertdialog|dialog)\b/.test(value);
 function visit(node){
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
   if(node.tagName.getText()==='dialog')record(node,'native-html-dialog');
   for(const attribute of node.attributes.properties){
    if(ts.isJsxAttribute(attribute)&&attribute.name.getText()==='role'&&attribute.initializer&&values(attribute.initializer,node).some(dialog))record(node,'jsx-role');
   }
  }
  if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === "createElement") || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "createElement")) && values(node.arguments[0], node).includes("dialog")) record(node, "native-dialog-constructor");
  // Also finds conditional/object spreads passed to JSX or createElement.
  if(ts.isPropertyAssignment(node)&&node.name.getText().replaceAll(/["']/g,'')==='role'&&values(node.initializer,node).some(dialog))record(node,'role-object');
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='setAttribute'&&node.arguments[0]?.getText().match(/^["']role["']$/)&&values(node.arguments[1],node).some(dialog))record(node,'dom-role');
  if(ts.isBinaryExpression(node)&&ts.isPropertyAccessExpression(node.left)&&node.left.name.text==='role'&&values(node.right,node).some(dialog))record(node,'dom-role-assignment');
  if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateExpression(node))&&/<[^>]+role\s*=\s*["'](?:alertdialog|dialog)["']/.test(node.getText()))record(node,'html-role');
  ts.forEachChild(node,visit);
 }
 visit(ast);
 return findings;
}
function scan(file) { findings.push(...findModalDeclarations(readFileSync(file, "utf8"), file)); }
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.(?:tsx?|jsx?)$/.test(entry.name)&&!/(?:\.test\.|\.behavior\.|\.spec\.)/.test(entry.name))scan(file);}}
function main() {
walk(join(repo,'src'));
const research=join(repo,'node_modules/@opencoven/research/src');
if(existsSync(research))walk(research);
const errors=[];
for(const row of findings)if(!boundaries.has(row.file))errors.push(`${row.file}:${row.line} has a private ${row.kind}; use Modal or document a nonmodal boundary.`);
for(const [file,[count]]of boundaries){const actual=findings.filter(row=>row.file===file).length;if(actual!==count)errors.push(`${file}: expected ${count} classified declarations, found ${actual}; reconcile the boundary.`);}
if(process.argv.includes('--inventory'))console.log(JSON.stringify(findings.map(row=>({...row,reason:boundaries.get(row.file)?.[1]??'UNCLASSIFIED'})),null,2));
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`Modal architecture: one canonical Modal; ${findings.length-1} nonmodal declarations classified; Research ${existsSync(research)?'checked':'not installed (optional)'}.`);

}
if(process.argv[1] === fileURLToPath(import.meta.url)) main();
