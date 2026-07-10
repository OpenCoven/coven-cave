const SAFE_PANE_ERROR_MESSAGE = "This page hit an unexpected error. Try again.";
export const SAFE_CAUGHT_PANE_ERROR_MESSAGE = "A workspace pane render error was caught.";

type Primitive = null | undefined | string | number | boolean | bigint | symbol;
type PrimitiveMark = { value: Primitive; generation: number };
type ConsoleErrorTarget = { error: (...args: unknown[]) => void };

const PRIMITIVE_MARK_LIMIT = 32;
const markedReferences = new WeakSet<object>();
const markedPrimitives = new Map<Primitive, number>();
const primitiveMarkOrder: PrimitiveMark[] = [];
const installedConsolePolicies = new WeakMap<object, (...args: unknown[]) => void>();
let primitiveGeneration = 0;

function isReference(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function removePrimitiveMarkFromOrder(generation: number): void {
  const index = primitiveMarkOrder.findIndex((mark) => mark.generation === generation);
  if (index !== -1) primitiveMarkOrder.splice(index, 1);
}

function markWorkspacePaneError(thrown: unknown): void {
  if (isReference(thrown)) {
    markedReferences.add(thrown);
    return;
  }

  const value = thrown as Primitive;
  const generation = ++primitiveGeneration;
  markedPrimitives.set(value, generation);
  primitiveMarkOrder.push({ value, generation });
  setTimeout(() => {
    removePrimitiveMarkFromOrder(generation);
    if (markedPrimitives.get(value) === generation) markedPrimitives.delete(value);
  }, 0);
  while (primitiveMarkOrder.length > PRIMITIVE_MARK_LIMIT) {
    const oldest = primitiveMarkOrder.shift();
    if (oldest && markedPrimitives.get(oldest.value) === oldest.generation) {
      markedPrimitives.delete(oldest.value);
    }
  }
}

function consumeWorkspacePaneErrorMark(thrown: unknown): boolean {
  if (isReference(thrown)) return markedReferences.delete(thrown);

  const value = thrown as Primitive;
  if (!markedPrimitives.has(value)) return false;
  const generation = markedPrimitives.get(value);
  markedPrimitives.delete(value);
  if (generation !== undefined) removePrimitiveMarkFromOrder(generation);
  return true;
}

export function workspacePaneResetKey(instanceId: string, landmark: string): string {
  return JSON.stringify([instanceId, landmark]);
}

export function workspacePaneErrorMessage(thrown: unknown): string {
  markWorkspacePaneError(thrown);
  return SAFE_PANE_ERROR_MESSAGE;
}

export function installWorkspacePaneErrorConsolePolicy(target: ConsoleErrorTarget = console): void {
  if (installedConsolePolicies.has(target)) return;

  const originalError = target.error;
  const scopedError = function (this: unknown, ...args: unknown[]) {
    let containsMarkedPaneError = false;
    for (const arg of args) {
      if (consumeWorkspacePaneErrorMark(arg)) containsMarkedPaneError = true;
    }

    return Reflect.apply(
      originalError,
      this,
      containsMarkedPaneError ? [SAFE_CAUGHT_PANE_ERROR_MESSAGE] : args,
    );
  };

  installedConsolePolicies.set(target, scopedError);
  target.error = scopedError;
}

export function reportCaughtWorkspacePaneError(_thrown: unknown): void {
  console.error(SAFE_CAUGHT_PANE_ERROR_MESSAGE);
}
