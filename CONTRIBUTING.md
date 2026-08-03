# Contributing to Coven Cave

Thank you for your interest in Coven Cave. **We welcome external contributions.**

Coven Cave is MIT licensed and community-driven. Bug fixes, docs, new skills and
integrations, performance work, and community-requested features are all fair
game. The full flow — DCO sign-off, what we're looking for, and getting started
— is below.

## Before you open a PR

- **Keep it focused.** One concern per PR; smaller diffs review faster.
- **Sign off your commits** (`git commit -s`) per the DCO below.
- **Make sure CI is green** before requesting review.
- **Don't merge `main` into your branch to "stay current."** It is never
  required here and it actively delays your PR — see below.
- **Open an issue first for large or design-heavy changes** so we can align on
  the approach before you invest the work.
- **Report security issues privately** through [SECURITY.md](./SECURITY.md) —
  never in a public PR or issue.

### Once CI is running, leave the branch alone

Your branch does **not** need to be up to date with `main` to merge. Branch
protection runs with `strict: false`, so being behind `main` is never the reason
a PR is blocked, and a merge commit from `main` will not unblock one.

Pushing anything — including a merge of `main` — while CI is running cancels the
in-flight run and starts over. If you are contributing from a fork for the first
time, GitHub also re-holds each new run at `action_required` until a maintainer
approves it again, so every extra push adds a full CI cycle *plus* a wait for a
human.

This is not hypothetical: three PRs in a single afternoon reached a fully green
run and were pushed over before they could be merged, each time by a merge of
`main` that changed nothing about the diff.

So:

- **Push while you are still working.** That is what branches are for, and the
  remote is the only copy a local accident cannot destroy.
- **Stop once CI starts**, unless you are pushing a real fix.
- **Only update from `main` if you have an actual conflict**, or a maintainer
  asks. Prefer `git rebase origin/main` over a merge commit when you do.

---

## OpenCoven DCO and Patent Terms

Thank you for your interest in contributing. OpenCoven is MIT licensed and community-driven. We want contributing to be easy, open, and safe for everyone.

## Developer Certificate of Origin (DCO)

OpenCoven uses the **Developer Certificate of Origin (DCO) v1.1** for all contributions. This is a lightweight mechanism — not a CLA — that asks you to certify that you have the right to submit what you're submitting.

By making a contribution to this project, you certify that:

> (a) The contribution was created in whole or in part by you and you have the right to submit it under the open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of your knowledge, is covered under an appropriate open source license and you have the right under that license to submit that work with modifications, whether created in whole or in part by you, under the same open source license (unless you are permitted to submit under a different license), as indicated in the file; or
>
> (c) The contribution was provided directly to you by some other person who certified (a), (b) or (c) and you have not modified it.
>
> (d) You understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information you submit with it, including your sign-off) is maintained indefinitely and may be redistributed consistent with this project or the open source license(s) involved.

### How to Sign Off

Add a `Signed-off-by` line to your commit message:

```
git commit -s -m "Your commit message"
```

This produces:

```
Your commit message

Signed-off-by: Your Name <your.email@example.com>
```

### Patent Non-Assertion

By contributing, you additionally agree not to assert any patent claims — now held or later acquired — against this project or its users that arise from your contribution. See [PATENTS](./PATENTS) for the full non-assertion pledge.

## What We're Looking For

- Bug fixes and reliability improvements
- Documentation and example improvements
- New skills, tools, and integrations
- Performance improvements
- Community-requested features

## What We're Not

OpenCoven is not a contribution vehicle for proprietary forks. If you are building a closed-source derivative of OpenCoven's architecture, please do not use contribution as a means to learn implementation details that are not yet public. We welcome genuine collaborators.

## Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes with signed-off commits: `git commit -s`
4. Open a pull request with a clear description

## Questions?

Join the Discord: https://discord.gg/OpenCoven
