#!/usr/bin/env bash
# Prepare a release commit and tag, locally. Pushes nothing.
#
#   tools/prepare-release.sh beta [VERSION]     # on main: merges main into beta
#   tools/prepare-release.sh stable [VERSION]   # on main, or on stable-X.Y for a patch
#
# VERSION defaults to what tools/next-version.sh says SemVer calls for. If one
# is given and it disagrees, the script stops and says why: the version is the
# maintainer's call, but a mismatch has to be a decision, not an accident.
# Set FORCE_VERSION=1 to go ahead with a version that disagrees.
#
# The release's changelog is the "Unreleased" entry in templates/index.html
# (what the About section shows), written as the work lands. A stable renames
# it to the version; a beta does the same on the beta branch only, so main
# keeps collecting under "Unreleased". Afterwards: review, then the publish
# steps in CONTRIBUTING.md ("Releasing").
set -euo pipefail
cd "$(dirname "$0")/.."

CHANNEL="${1:?usage: tools/prepare-release.sh beta|stable [VERSION]}"
WANT="${2:-}"
CHANGELOG=templates/index.html

[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "The working tree has uncommitted changes." >&2; exit 1; }
[ "$(git config core.hooksPath)" = "tools/git-hooks" ] || { echo "Run: git config core.hooksPath tools/git-hooks" >&2; exit 1; }

branch=$(git symbolic-ref --short HEAD)
case "$CHANNEL" in
    beta)   [ "$branch" = main ] || { echo "Prepare a beta from main (you are on $branch)." >&2; exit 1; } ;;
    stable) [[ "$branch" = main || "$branch" == stable-* ]] || { echo "A stable ships from main or stable-X.Y." >&2; exit 1; } ;;
    *) echo "beta or stable" >&2; exit 1 ;;
esac
SUGGESTED=$(tools/next-version.sh "$CHANNEL")

VERSION="${WANT:-$SUGGESTED}"
if [ "${VERSION%-beta.*}" != "${SUGGESTED%-beta.*}" ] && [ "${FORCE_VERSION:-0}" != 1 ]; then
    echo "SemVer calls for $SUGGESTED, not $VERSION. The commits that decide it:" >&2
    tools/next-version.sh "$CHANNEL" --why >/dev/null || true
    echo "Rerun with FORCE_VERSION=1 if $VERSION is deliberate." >&2
    exit 1
fi
case "$CHANNEL" in
    beta)   [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[1-9][0-9]*$ ]] || { echo "'$VERSION' is not X.Y.Z-beta.K." >&2; exit 1; } ;;
    stable) [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "'$VERSION' is not X.Y.Z." >&2; exit 1; } ;;
esac
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
    echo "v$VERSION already exists." >&2
    exit 1
fi

# Rename the changelog's "Unreleased" entry to the version. Refuses an empty
# or missing one: a release with nothing to tell users has no entry to show.
name_unreleased() {
    python3 - "$1" "$CHANGELOG" <<'PY'
import re, sys, pathlib
version, path = sys.argv[1], pathlib.Path(sys.argv[2])
t = path.read_text(encoding="utf-8")
pat = r'(<div class="changelog-version">)Unreleased(</div>\s*<ul>(.*?)</ul>)'
m = re.search(pat, t, re.S)
if not m or "<li>" not in m.group(3):
    sys.exit(f'{path} has no "Unreleased" changelog entry with lines in it. Write one first.')
path.write_text(t[:m.start()] + m.group(1) + version + m.group(2) + t[m.end():], encoding="utf-8")
PY
}

if [ "$CHANNEL" = beta ]; then
    # The beta branch is main plus one release commit. The version lines and
    # the changelog conflict on every merge, so neither is trusted to it: the
    # changelog is main's copy with its Unreleased entry renamed to this beta.
    # Earlier beta entries disappear, superseded by this one, which carries
    # everything the coming stable will.
    if git rev-parse -q --verify refs/heads/beta >/dev/null; then
        git checkout -q beta
        git merge -q --no-edit -X theirs main
    else
        git checkout -q -b beta
    fi
    git show main:"$CHANGELOG" > "$CHANGELOG"
    if ! name_unreleased "$VERSION"; then
        git checkout -q -- . && git checkout -q main
        exit 1
    fi
else
    name_unreleased "$VERSION"
    sed -i "s/^Current version: \*\*.*\*\*/Current version: **$VERSION**/" README.md
fi
sed -i "s/^APP_VERSION = '.*'/APP_VERSION = '$VERSION'/" app.py
sed -i "s/^LABEL org.opencontainers.image.version=\".*\"/LABEL org.opencontainers.image.version=\"$VERSION\"/" Dockerfile

# No test suite yet: at least make sure the release as tagged still compiles.
python3 -c 'import ast, sys; ast.parse(open("app.py", encoding="utf-8").read())'

git add app.py Dockerfile README.md "$CHANGELOG"
git commit -q -m "chore(release): $VERSION"
git tag -a "v$VERSION" -m "$VERSION"
echo
echo "==> v$VERSION committed and tagged on $(git symbolic-ref --short HEAD). Nothing is pushed."
echo "    Review: git show --stat HEAD && tools/release-notes.sh $VERSION"
echo "    Then follow \"Releasing\" in CONTRIBUTING.md."
