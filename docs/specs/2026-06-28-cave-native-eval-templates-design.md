# Cave-Native Eval Templates Design

## Goal

Make the Evals template catalog useful for Coven Cave maintainers. Templates should start realistic suites for familiar behavior that Cave actually cares about: code review, tool use, context fidelity, memory hygiene, permissions, thread freshness, response confidence, and eval-loop recovery.

## Shape

Keep the existing `EvalTemplate` data model and gallery. The work is a catalog refresh, not a schema expansion.

Each template remains self-contained: prompts include their fixture data inline, so a maintainer can run the suite against any familiar without project setup. Templates clone into normal editable `EvalSuite` drafts.

## Catalog

Replace generic benchmark examples with Cave operational starters:

- Code review risk detection
- Tool-use reliability
- Project context fidelity
- Structured action summaries
- PR merge readiness
- Test failure triage
- Permission/blocker handling
- Memory hygiene
- Thread freshness triage
- Response confidence diagnostics
- Eval-loop recovery
- Familiar voice under operational pressure

## Testing

The template unit test should enforce:

- the required Cave-native template IDs exist
- generic benchmark starter IDs are gone
- every template is categorized, self-contained, runnable, and has valid graders
- deterministic grader values are strings
- regex graders compile and latency graders use numeric millisecond budgets

