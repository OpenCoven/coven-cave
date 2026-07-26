# Bounded continuity

Research state may be resumed only from a user-approved project directory. The agent may read the state, report progress, and propose the next bounded action; it must not schedule recurring turns, send external messages, create commits, push branches, or continue after a budget or checkpoint without explicit approval.

Write state atomically and preserve the last verified snapshot. Stop when the declared wall-clock, compute, storage, network, or spend limit is reached, and request a new decision before changing scope or publishing results.
