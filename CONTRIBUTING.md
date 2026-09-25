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

1. Add the version's entry to the changelog in `templates/index.html`
   (it is what the About section shows), written from the user's side.
2. `tools/prepare-release.sh [VERSION]`: checks the version against
   `tools/next-version.sh` (refusing a mismatch unless `FORCE_VERSION=1`), sets
   it in `app.py`, `Dockerfile` and `README.md`, commits
   `chore(release): X.Y.Z` and tags `vX.Y.Z`. Nothing is pushed.
3. Push `main`, then the tag. The tag fires `.github/workflows/release.yml`,
   which creates the GitHub release titled `vX.Y.Z`, with the body from
   `tools/release-notes.sh`.
4. Build the image from the tag and push it to Docker Hub as
   `hyprlab/garage-logbook:X.Y.Z` and `:latest`.

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
