#!/usr/bin/env bash
# Prepare a release commit and tag, locally. Pushes nothing.
#
#   tools/prepare-release.sh [VERSION]
#
# VERSION defaults to what tools/next-version.sh says SemVer calls for. If one
# is given and it disagrees, the script stops and says why: the version is the
# maintainer's call, but a mismatch has to be a decision, not an accident.
# Set FORCE_VERSION=1 to go ahead with a version that disagrees.
#
# Write the version's changelog entry in templates/index.html first; the
# script refuses to release without one. Afterwards: review, then the publish
# steps in CONTRIBUTING.md.
set -euo pipefail
cd "$(dirname "$0")/.."

WANT="${1:-}"
[ -z "$(git status --porcelain --untracked-files=no -- . ':!templates/index.html')" ] \
    || { echo "The working tree has uncommitted changes besides the changelog." >&2; exit 1; }
[ "$(git config core.hooksPath)" = "tools/git-hooks" ] || { echo "Run: git config core.hooksPath tools/git-hooks" >&2; exit 1; }
[ "$(git symbolic-ref --short HEAD)" = main ] || { echo "A release ships from main." >&2; exit 1; }

SUGGESTED=$(tools/next-version.sh)
VERSION="${WANT:-$SUGGESTED}"
if [ "$VERSION" != "$SUGGESTED" ] && [ "${FORCE_VERSION:-0}" != 1 ]; then
    echo "SemVer calls for $SUGGESTED, not $VERSION. The commits that decide it:" >&2
    tools/next-version.sh --why >/dev/null || true
    echo "Rerun with FORCE_VERSION=1 if $VERSION is deliberate." >&2
    exit 1
fi
[[ "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "'$VERSION' is not X.Y.Z." >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
    echo "v$VERSION already exists." >&2
    exit 1
fi
tools/release-notes.sh "$VERSION" >/dev/null

sed -i "s/^APP_VERSION = '.*'/APP_VERSION = '$VERSION'/" app.py
sed -i "s/^LABEL org.opencontainers.image.version=\".*\"/LABEL org.opencontainers.image.version=\"$VERSION\"/" Dockerfile
sed -i "s/^Current version: \*\*.*\*\*/Current version: **$VERSION**/" README.md

git add app.py Dockerfile README.md templates/index.html
git commit -q -m "chore(release): $VERSION"
git tag -a "v$VERSION" -m "$VERSION"
echo
echo "==> v$VERSION committed and tagged on main. Nothing is pushed."
echo "    Review: git show --stat HEAD && tools/release-notes.sh $VERSION"
echo "    Then follow \"Releasing\" in CONTRIBUTING.md."
