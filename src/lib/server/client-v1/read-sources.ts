/**
 * The stores the Client v1 canonical reads project, behind one injectable seam.
 *
 * Every module here resolves its on-disk location at import time — CONV_DIR is
 * `path.join(caveHome(), "conversations")` evaluated when cave-conversations.ts
 * is first loaded — so a test that wants a different Cave home has to set the
 * environment before the import graph is built. That makes suite behaviour
 * depend on module load order, which is exactly the kind of coupling that turns
 * a green run on one machine into a red run on another.
 *
 * So the routes take their sources as an argument, the same way they already
 * take their ClientV1Runtime. `clientV1ReadSources()` is the production
 * binding; a test hands the handler a plain object and never touches the
 * filesystem or the daemon at all.
 */

import {
  listConversations,
  loadConversation,
  type ConversationFile,
  type ConversationSummary,
} from "../../cave-conversations.ts";
import { loadProjects } from "../../cave-projects.ts";
import type { CaveProject } from "../../cave-projects-types.ts";
import type { FamiliarExecutionAnalytics } from "../../familiar-execution-analytics.ts";
import {
  readFamiliarContractFiles,
  type LoadedContractFiles,
} from "../familiar-contract-files.ts";
import { readFamiliarExecutionAnalytics } from "../familiar-execution-analytics-source.ts";
import {
  loadVisibleFamiliarRoster,
  type VisibleFamiliarRosterResult,
} from "../familiar-roster.ts";

export interface ClientV1ReadSources {
  /**
   * The visible familiar roster, or the failure that stopped it being read.
   *
   * Returns the result rather than throwing because a daemon that is down is
   * an ordinary, reportable state of this Cave — not an exception — and the
   * route has to distinguish it from an empty roster.
   */
  listFamiliars(): Promise<VisibleFamiliarRosterResult>;
  listProjects(): Promise<CaveProject[]>;
  listConversations(): Promise<ConversationSummary[]>;
  /**
   * One transcript, or null.
   *
   * Null covers "no such conversation" and "that id cannot name one" alike:
   * loadConversation resolves the path through a traversal guard and returns
   * null on any failure, so a `..` segment that survived URL decoding is
   * absent rather than an error, and the route answers `not_found` for both.
   */
  loadConversation(id: string): Promise<ConversationFile | null>;
  /**
   * One familiar's contract files, read from its workspace.
   *
   * A missing file is `null` in the result rather than an error, so a familiar
   * that has not authored every file still gets a report — one that names what
   * is missing. The loader re-asserts the id slug barrier; the route checks it
   * first and never calls this for an id the roster does not list.
   */
  loadFamiliarContract(id: string): Promise<LoadedContractFiles>;
  /** One familiar's execution analytics, every window, `recentLimit` attempts. */
  readFamiliarAnalytics(args: {
    familiarId: string;
    recentLimit: number;
  }): Promise<FamiliarExecutionAnalytics>;
}

export function clientV1ReadSources(): ClientV1ReadSources {
  return Object.freeze({
    listFamiliars: loadVisibleFamiliarRoster,
    listProjects: loadProjects,
    listConversations,
    loadConversation,
    loadFamiliarContract: readFamiliarContractFiles,
    readFamiliarAnalytics: (args: { familiarId: string; recentLimit: number }) =>
      readFamiliarExecutionAnalytics(args),
  });
}
