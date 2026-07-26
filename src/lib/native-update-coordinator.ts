import { releasePreparedUpdate, type NativeUpdateHandle } from "./native-update-preparation.ts";

export type NativeUpdateSnapshot = {
  update: NativeUpdateHandle | null;
  actionActive: boolean;
};

export type NativeUpdateCheckResult =
  | { kind: "available"; update: NativeUpdateHandle }
  | { kind: "current" };

type Listener = (snapshot: NativeUpdateSnapshot) => void;

function compareVersions(left: string, right: string): number {
  const parse = (version: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version);
    return match
      ? { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split(".") ?? [] }
      : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return left.localeCompare(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

/** Shared native updater resource and action coordinator for all React surfaces. */
export class NativeUpdateCoordinator {
  private update: NativeUpdateHandle | null = null;
  private pendingUpdate: NativeUpdateHandle | null = null;
  private pendingCurrent = false;
  private checkEpoch = 0;
  private latestResultEpoch = 0;
  private latestResultAvailable = false;
  private readonly owners = new Set<symbol>();
  private actionOwner: symbol | null = null;
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  beginCheck(): number {
    this.checkEpoch += 1;
    return this.checkEpoch;
  }

  private notify(): void {
    const snapshot = { update: this.update, actionActive: this.actionOwner !== null };
    for (const listener of this.listeners) listener(snapshot);
  }

  private async replaceCurrent(replacement: NativeUpdateHandle | null): Promise<void> {
    const previous = this.update;
    const changed = previous !== replacement;
    this.update = replacement;
    if (!replacement) this.owners.clear();
    if (changed && previous) await releasePreparedUpdate(previous);
    if (changed) this.notify();
  }

  async adopt(
    owner: symbol,
    candidate: NativeUpdateHandle,
    epoch = this.beginCheck(),
  ): Promise<NativeUpdateHandle | null> {
    if (epoch < this.latestResultEpoch) {
      await releasePreparedUpdate(candidate);
      if (!this.latestResultAvailable) return null;
      const retained = this.pendingUpdate ?? this.update;
      if (retained) this.owners.add(owner);
      return retained;
    }
    this.latestResultEpoch = epoch;
    this.latestResultAvailable = true;
    if (!this.update) {
      this.update = candidate;
      this.owners.add(owner);
      return candidate;
    }
    if (compareVersions(candidate.version, this.update.version) <= 0) {
      this.owners.add(owner);
      if (this.update !== candidate) await releasePreparedUpdate(candidate);
      return this.update;
    }

    this.owners.add(owner);
    if (this.actionOwner) {
      const replacedPending = this.pendingUpdate;
      this.pendingUpdate = candidate;
      this.pendingCurrent = false;
      if (replacedPending && replacedPending !== candidate) {
        await releasePreparedUpdate(replacedPending);
      }
      return this.update;
    }

    await this.replaceCurrent(candidate);
    return candidate;
  }

  async reportCurrent(epoch = this.beginCheck()): Promise<void> {
    if (epoch < this.latestResultEpoch) return;
    this.latestResultEpoch = epoch;
    this.latestResultAvailable = false;
    if (this.actionOwner) {
      this.pendingCurrent = true;
      if (this.pendingUpdate) await releasePreparedUpdate(this.pendingUpdate);
      this.pendingUpdate = null;
      return;
    }
    await this.replaceCurrent(null);
  }

  beginAction(owner: symbol, update: NativeUpdateHandle): boolean {
    if (this.update !== update || (this.actionOwner && this.actionOwner !== owner)) return false;
    this.actionOwner = owner;
    return true;
  }

  async finishAction(owner: symbol): Promise<void> {
    if (this.actionOwner !== owner) return;
    this.actionOwner = null;
    if (this.pendingCurrent) {
      this.pendingCurrent = false;
      await this.replaceCurrent(null);
      return;
    }
    if (this.pendingUpdate) {
      const replacement = this.pendingUpdate;
      this.pendingUpdate = null;
      await this.replaceCurrent(replacement);
      return;
    }
  }

  async release(owner: symbol): Promise<void> {
    this.owners.delete(owner);
    if (this.actionOwner === owner) return;
    if (this.owners.size === 0 && this.update) await this.replaceCurrent(null);
  }

  async invalidate(update: NativeUpdateHandle): Promise<void> {
    if (this.update === update) {
      this.update = null;
      this.actionOwner = null;
      this.owners.clear();
      this.notify();
    }
    await releasePreparedUpdate(update);
  }
}

export async function adoptNativeUpdateResult(
  coordinator: NativeUpdateCoordinator,
  owner: symbol,
  candidate: NativeUpdateHandle,
  epoch: number,
): Promise<NativeUpdateCheckResult> {
  const adopted = await coordinator.adopt(owner, candidate, epoch);
  return adopted ? { kind: "available", update: adopted } : { kind: "current" };
}

export const nativeUpdateCoordinator = new NativeUpdateCoordinator();
