# Multi-agent development

The main checkout is the integration baseline. Each writer works in a sibling
folder so rebuilding, changing branches, and Git index operations cannot alter
another agent's files.

From `D:\Code\KomaMotion`, create a task worktree:

```powershell
git fetch origin
git worktree add -b feat/example ../KomaMotion-worktrees/example origin/main
```

From that worktree, run `pnpm install --frozen-lockfile`. Give the worker its
absolute directory, base commit, owned components, expected behavior, validation,
and permission scope. Record the task and result in a local coordination note
outside deliverable source. Use one integration owner. Read-only reviewers can
share a stable revision; writers need separate worktrees.

For native verification, follow the
[verification skill](../.agents/skills/verify-koma-motion/SKILL.md). Keep output
outside disposable profiles and worktrees when it must survive cleanup:

```powershell
pnpm build
pnpm --filter @koma-motion/desktop exec playwright test workflow.spec.ts --output=D:/Code/KomaMotion-evidence/example
```

The Electron harness creates a unique profile per test and closes only that
instance. Run tests serially within a worktree. Concurrent worktrees need their
own build and evidence paths. Avoid concurrent screenshot sessions that depend
on native focus. Do not set `KOMA_LIVE_*` for ordinary verification.

Before integration, inspect the worker's diff and tests, and independently
review consequential changes. Merge dependent work in order, resolve conflicts
by preserving the intended behavior, and rerun checks on the combined commit.
Do not accept separate green branches as proof that their integration works.

Before cleanup, inspect `git status --short` in the target worktree and compare
its branch with `origin/main`. Preserve unique commits on an archive branch and
save any uncommitted work deliberately before removal. Copy useful test results
and personal reference material to a durable location. Do not use forced removal
to get past a dirty-worktree error.

For a clean merged task, run from the main checkout:

```powershell
git merge-base --is-ancestor feat/example origin/main
git worktree remove ../KomaMotion-worktrees/example
git branch -d feat/example
git worktree prune
```

Check the ancestry command's exit status before proceeding. Verify the resolved
path before removing directories on Windows. Archive branches are retained until
their owner decides their recovery value is no longer needed.
