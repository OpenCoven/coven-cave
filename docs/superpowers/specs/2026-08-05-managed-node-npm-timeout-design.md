# Managed Node npm Verification Timeout Design

**Goal:** Prevent Cave from rejecting a valid managed Node installation when
`npm-cli.js --version` has a slow Windows cold start.

## Approach

Keep the lightweight `node --version` probe at 1,500 ms so missing or broken
runtimes still fail quickly. Give only the npm verification probe a 10,000 ms
deadline, which is long enough for cold Windows startup without weakening the
verification contract or adding retries.

## Error handling

The existing `missing`, `incompatible`, and `unusable` results remain
unchanged. A genuine npm timeout still produces `unusable`; the change only
prevents healthy cold starts from being killed prematurely.

## Testing

Inject the command runner into `probeManagedNodeToolchain`, record both calls,
and assert that Node receives 1,500 ms while npm receives 10,000 ms. The test
also requires the probe to return `ready`, proving the timeout split does not
change successful result parsing.
