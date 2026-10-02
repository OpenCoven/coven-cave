/**
 * Request bookkeeping for `useWorktreeChanges` (#5729), pure so the orderings
 * that broke it can be tested without React.
 *
 * Every root change starts a new generation. A request carries a ticket (its
 * generation and its own token), and only a ticket from the current
 * generation may apply its result, clear the in-flight slot, or run a queued
 * reload. Root alone is not enough: after A → B → A the first A request is
 * still for "A", but it belongs to a generation that has ended, and its late
 * answer must neither overwrite the newer A answer nor finish the newer A
 * request's bookkeeping.
 *
 * A forced reload asked for while a request is in flight is queued (one queued
 * reload covers any number of asks); a shared poll is simply skipped.
 */

export type ChangesTicket = { generation: number; token: number };

export function createChangesLedger() {
  let generation = 0;
  let nextToken = 0;
  let inFlight: ChangesTicket | null = null;
  let queued = false;

  return {
    /** The root changed: nothing in flight or queued belongs to it. */
    newGeneration(): number {
      generation += 1;
      inFlight = null;
      queued = false;
      return generation;
    },
    /** A ticket for a new request, or null when one is already in flight. */
    begin(opts?: { shared?: boolean }): ChangesTicket | null {
      if (inFlight) {
        if (!opts?.shared) queued = true;
        return null;
      }
      nextToken += 1;
      inFlight = { generation, token: nextToken };
      return inFlight;
    },
    /** May this ticket's response be applied? */
    accepts(ticket: ChangesTicket): boolean {
      return ticket.generation === generation;
    },
    /**
     * The ticket's request ended. Clears the in-flight slot only if it is
     * still this ticket's, and hands back a queued reload only to a current one.
     */
    end(ticket: ChangesTicket): { reload: boolean } {
      if (inFlight && inFlight.token === ticket.token) inFlight = null;
      if (ticket.generation !== generation || !queued) return { reload: false };
      queued = false;
      return { reload: true };
    },
  };
}

export type ChangesLedger = ReturnType<typeof createChangesLedger>;
