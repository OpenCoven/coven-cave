import assert from 'node:assert/strict';
import { acquireModalEnvironment, refreshModalEnvironment, acquirePageScrollLock } from './modal-environment.ts';

type FakeElement = { name: string; children: FakeElement[]; inert: boolean; style: {overflow: string; overscrollBehavior: string}; contains(target: unknown): boolean };
function element(name: string, children: FakeElement[] = []): FakeElement {
  const el = { name, children, inert: false, style: {overflow: '', overscrollBehavior: ''}, contains(target: unknown): boolean { return target === el || children.some(child => child.contains(target)); } };
  return el;
}
const page = element('page'), announcer = element('announcer'), parent = element('parent'), child = element('child'), menu = element('menu');
const body = element('body', [page, announcer, parent, child, menu]);
const root = element('root');
const originalDocument = globalThis.document;
Object.assign(globalThis, { document: {body, documentElement: root, querySelectorAll: () => [announcer]} });
try {
  page.inert = true;
  const releaseDrawer = acquirePageScrollLock();
  const parentPortals: typeof menu[] = [];
  const releaseParent = acquireModalEnvironment(parent as unknown as HTMLElement, () => parentPortals as unknown as HTMLElement[], 351);
  assert.equal(body.style.overflow, 'hidden');
  assert.equal(parent.inert, false);
  assert.equal(announcer.inert, false, 'announcements stay available');
  assert.equal(menu.inert, true);
  parentPortals.push(menu);
  refreshModalEnvironment();
  assert.equal(menu.inert, false, 'owned portal remains usable');
  const releaseChild = acquireModalEnvironment(child as unknown as HTMLElement, () => [], 352);
  assert.equal(parent.inert, true, 'nested modal suspends its parent');
  assert.equal(child.inert, false);
  releaseParent();
  assert.equal(child.inert, false, 'out-of-order close leaves the surviving modal usable');
  releaseChild();
  assert.equal(page.inert, true, 'original inert state is preserved');
  assert.equal(parent.inert, false);
  assert.equal(body.style.overflow, 'hidden', 'independent drawer still owns scroll lock');
  releaseDrawer();
  assert.equal(body.style.overflow, '');
  assert.equal(root.style.overscrollBehavior, '');
  releaseDrawer();
  console.log('modal environment: nested ownership, portal interaction, announcement and restoration passed');
} finally { Object.assign(globalThis, {document: originalDocument}); }
