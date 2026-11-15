# Contributing

The conventions anyone editing this repository follows, human or AI. Bug
reports, ideas and pull requests are all welcome, and a clear bug report is
often as useful as a patch.

## Setting up

```sh
git config core.hooksPath tools/git-hooks     # once per clone or worktree
docker compose up -d --build                  # http://localhost:5000
```

The hooks enforce the commit rules below. Without `core.hooksPath` they
silently do nothing, so set it in every clone and every worktree.

## Commits

**The history is the maintainer's.** Commits carry no AI tool attribution: no
`Co-Authored-By:` line for Claude or any other assistant, no "Generated with"
footer, no session line, in a commit, a tag message, a pull request body or a
release body. The [AI notice](README.md#ai-notice) declares how the project is
built, once, for the whole repository. One stray trailer puts the tool on
GitHub's Contributors panel, and removing it again means rewriting history.

A `Co-Authored-By:` trailer is still how a **person** is credited, with the
GitHub noreply address that resolves to their profile (see [Credit](#credit)).

Subjects follow [Conventional Commits](https://www.conventionalcommits.org):
`type(area): summary`, lower case after the colon, imperative, no full stop,
72 characters at most and ideally nearer 50.

- Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `build`, `ci`, `test`,
  `style`, `chore`, `revert`. A `!` after the type (`feat(db)!:`) marks a
  breaking change. The type is not decoration: `tools/next-version.sh` reads
  it to decide the next version.
- The area is where the change lives: `auth`, `vehicles`, `records`,
  `reminders`, `dashboard`, `import`, `settings`, `users`, `ui`, `db`,
  `docker`, `release`. Leave it out only when there is no single place.
- An issue number goes at the end: `fix(records): keep photos on edit (#12)`.
- Releases: `chore(release): 0.4.0`.

The body is optional and short: why the change exists, never what the diff
already says. Past 100 words the detail belongs in the README or the
changelog, or the commit wants splitting. **Each body paragraph is one line,
not wrapped:** GitHub keeps every line break in a body, so text wrapped at 72
breaks a second time on a phone. Write it with `git commit -F -` and a heredoc.

No em dashes in commit messages: a colon, a comma or a full stop replaces
them.

`tools/git-hooks/commit-msg` refuses the attribution lines, em dashes, a
subject without a type, and an overlong subject or body. `pre-push` refuses to
publish any commit or tag carrying attribution. `pre-commit` refuses
`CLAUDE.md` and `.claude/`, which are local only: listed in
`.git/info/exclude`, never committed.

## Versions

Every release follows [Semantic Versioning 2.0.0](https://semver.org/). For an
app, the "public API" is whatever an existing install depends on: the data
volume, the configuration, the URLs, and the features.

| Bump | When | Examples |
| --- | --- | --- |
| **MAJOR** | Anything an existing install can't take without help | A migration an older version can't read back; a removed feature or setting; a renamed or removed environment variable; a changed volume path or port |
| **MINOR** | New, backward-compatible functionality, or a deprecation | A new feature, setting or page; a new optional environment variable |
| **PATCH** | Backward-compatible fixes only | A bug fix, a performance fix, a security fix with no behavior change |

`tools/next-version.sh --why` reads the Conventional Commit types since the
last release and says which bump they call for: `!` or a `BREAKING CHANGE:`
footer is major, `feat` is minor, `fix`, `perf` and `revert` are patch. It
cannot see everything, so read the commits too: a `fix` that changes the
schema irreversibly is still MAJOR.

**Before any release, say plainly if the requested version does not fit** what
the commits since the last tag contain, and what SemVer calls for instead. The
maintainer decides; a mismatch has to be a decision, not an accident. A
release with no features is a patch. A version never counts backwards, and a
released version is never reused.

## Releasing

### Channels and cadence

| | Branch | Version | Docker tags | GitHub release |
| --- | --- | --- | --- | --- |
| Development | `main` | the last stable, plus the changelog's "Unreleased" entry | none | none |
| Beta | `beta` | `X.Y.0-beta.K` | `:X.Y.0-beta.K`, `:beta` | prerelease |
| Stable | `main` | `X.Y.Z` | `:X.Y.Z`, `:X.Y`, `:latest` | release |
| Urgent patch | `stable-X.Y` | `X.Y.Z+1` | as stable | release |

1. **Work lands on `main`.** Every user-visible change adds a line to the
   "Unreleased" entry of the changelog in `templates/index.html` (the About
   section shows it), written from the user's side. New features start with
   `New:`, fixes with `Fixed`.
2. **Beta is the gate, not a copy.** "Ship it to beta" merges `main` into
   `beta` and publishes `X.(N+1).0-beta.K`, where N is the current stable
   minor and K counts up. Whatever is on main, whenever the maintainer asks. A
   beta never moves `:latest`.
3. **Stable only when the maintainer says so.** "Ship it to stable" promotes
   what the latest beta carried. If `main` has commits since that beta, ask
   whether to include them untested or cut another beta first.
4. **Patches are for urgent fixes only:** a crash, data loss, a security
   hole, an install that can't start or can't sign anyone in. See
   [Urgent patches](#urgent-patches).
5. **No catch-up beta after a stable.** The next beta after `0.N.0` is
   `0.(N+1).0-beta.1`, cut from main when asked.
6. **A bare "ship" or "ship it" is ambiguous.** Ask: beta or stable?

### Before any release

- The "Unreleased" changelog entry holds every user-visible change.
- `tools/next-version.sh --why` agrees with the version (see [Versions](#versions)).
- `git log origin/main..main --format=%B | grep -iE 'anthropic|claude'`
  prints nothing. The `pre-push` hook checks the same thing.

### Ship it to beta

```sh
tools/prepare-release.sh beta          # version from next-version.sh beta
git push origin main beta vX.Y.0-beta.K
tools/release-notes.sh X.Y.0-beta.K > /tmp/notes-X.Y.0-beta.K.md   # then shorten it
gh release create vX.Y.0-beta.K --prerelease --title "vX.Y.0-beta.K" --notes-file /tmp/notes-X.Y.0-beta.K.md
tools/publish-image.sh X.Y.0-beta.K
git checkout main
```

`prepare-release.sh beta` checks out `beta` (creating it the first time),
merges `main`, renames main's "Unreleased" entry to the beta's version, sets
the version, commits `chore(release): X.Y.0-beta.K`, tags it and stops.
`--prerelease` always, so `releases/latest` keeps pointing at stable.

### Ship it to stable

```sh
tools/prepare-release.sh stable        # version from next-version.sh
git push origin main vX.Y.Z            # main before the tag
tools/release-notes.sh X.Y.Z > /tmp/notes-X.Y.Z.md                 # then shorten it
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file /tmp/notes-X.Y.Z.md
tools/publish-image.sh X.Y.Z
```

`prepare-release.sh stable` renames the "Unreleased" entry to the version,
sets it in `app.py`, `Dockerfile` and `README.md`, commits
`chore(release): X.Y.Z`, tags `vX.Y.Z` and stops. Push `main` before the tag,
so the tag never points at a commit main doesn't have. Then reply to and
close the issues the release fixes, and trim the Releases page (below).

### Urgent patches

1. Fix it on `main` first, in its own commit, so it cherry-picks cleanly.
2. Cut the branch lazily, from the last release tag, never from main:
   `git branch stable-X.Y vX.Y.Z` (skip if it exists).
3. `git checkout stable-X.Y && git cherry-pick <sha>`, add the changelog line
   to an "Unreleased" entry there, then `tools/prepare-release.sh stable`.
4. Publish as for a stable, pushing `stable-X.Y` instead of `main`.
5. Merge `stable-X.Y` back into `main`, so the changelog entry survives.
6. Ship a beta from main alongside, so beta never lacks a fix stable has.
7. Never delete a `stable-X.Y` branch: patch commits may exist only there.

### Release notes

The release title is the version and nothing else: `vX.Y.Z`. The body starts
from `tools/release-notes.sh`, which sorts the version's changelog lines under
the release headings and adds the compare link. Before `gh release create`,
shorten every line to a few words and its issue; the changelog keeps its full
sentences.

```
### New features:

- Saved vendors on the record form - (#12)

### Changes:

- Settings tabs fit on one line

### Fixes:

- photos lost when editing a record - (#18)

---

**Full changelog:** [v0.3.2...v0.4.0](https://github.com/hyprlab/garage-logbook/compare/v0.3.2...v0.4.0)
```

- Features start with a capital; fixes are lower case and name the bug that
  is gone. The issue, if any, ends the line as ` - (#N)`.
- Drop a heading with nothing under it. No introduction, no closing line, no
  commit list, and no bold except the `Full changelog:` label.
- An `@` only for people whose code, art or translation is in the release.
- Never hand the whole changelog to `gh release create`.

### The Releases page

Keep it short: the newest release of each `X.Y` line, plus the current beta.
Delete a superseded release and its tag only after the new one is published,
`releases/latest` points at it, and its notes were generated. Docker image
tags are never deleted: someone may have pinned one.

## Prose style

Documentation, the changelog, release notes, UI text and issue replies:

- Factual, plain language. Say what the app does, not what it enables you to
  do. No marketing, no superlatives, no emoji, no em dashes.
- American spelling in anything the app shows: color, behavior, canceled.
- Changelog lines describe the change from the user's side. How it was built
  belongs in the commit.

## Credit

Outside pull requests land as commits on `main` made by the maintainer,
crediting the author with a trailer that uses their GitHub noreply address:

```
Co-Authored-By: Jane Doe <12345678+janedoe@users.noreply.github.com>
```

Get the id with `gh api users/<login> --jq .id`. An address taken from their
own commit may not be linked to their account, and then they never appear as a
contributor; that can't be fixed after a tagged release without rewriting
history. Close the pull request with a comment saying what was taken, what
changed and what was left out.

In release notes an `@` is for people whose code, art or translation is in the
release. Reporters and requesters are named without the `@`: an @ notifies
someone and reads as authorship.

## Issue replies

Every reply to an issue or pull request written by an agent begins with
`*Agentic reply:*` in italics, then a blank line, then the reply.

- A reply saying something is done is one or two sentences: what changed from
  the user's side, and which version carries it.
- No thanks, no pleasantries, no em dashes. Plain, brief, human.
- Anything the user has to do is a numbered list, one request per item.
- Reply once the image is pushed, not before.
- A fix in a beta: name the beta and say it reaches stable with the next
  stable release; the issue stays open until that stable ships.
- A fix in a stable: the update command as its own paragraph, then close.
