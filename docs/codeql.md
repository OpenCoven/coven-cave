# CodeQL configuration

The advanced workflow is configured to scan GitHub Actions,
JavaScript/TypeScript, Python, Rust, and Swift. It is required because the
native iOS project is generated from
`apps/ios/CovenCave/project.yml`; default setup cannot run `xcodegen` before
Swift autobuild searches for an Xcode project.

## Activating advanced setup

GitHub default setup overrides checked-in CodeQL workflows and rejects their
result uploads. A repository administrator must perform this transition after
`.github/workflows/codeql.yml` reaches `main`:

1. In **Settings > Security > Code security**, disable CodeQL default setup.
2. In **Actions**, enable the **CodeQL Advanced** workflow if GitHub left it
   disabled, then run it with **Run workflow** on `main`.
3. Confirm all five `Analyze (...)` jobs succeed and that the latest code
   scanning analyses contain these categories:
   `/language:actions`, `/language:javascript-typescript`, `/language:python`,
   `/language:rust`, and `/language:swift`.
4. Add an active branch ruleset for `main` with **Require code scanning
   results** set to tool `CodeQL`, security threshold **High or higher**, and
   alerts threshold **None**. Do not remove the existing required CI checks.
5. Open a pull request and confirm merge is blocked until the CodeQL analysis
   finishes, and when a new High or Critical security result is reported.

If the advanced workflow cannot upload results, first verify that default setup
is disabled. Re-enable default setup immediately if the advanced workflow
cannot be made healthy, so the existing four-language security coverage is not
left inactive.
