#!/usr/bin/env bash
# Print a draft GitHub release body for one version.
#
#   tools/release-notes.sh 0.4.0 > /tmp/notes-0.4.0.md
#
# The draft is that version's entry in the in-app changelog
# (templates/index.html, read from the tag once it exists), sorted under the
# release headings: lines starting "New:" under "New features:", lines starting
# "Fixed" under "Fixes:", the rest under "Changes:". It is a draft: shorten
# each line to a few words and its issue, as in CONTRIBUTING.md ("Release
# notes"), before `gh release create`.
#
# With the tag present, it ends with a "Full changelog" compare link against
# the previous tag OF THE SAME KIND (a beta against the previous beta, a stable
# against the previous stable). No commit list: the compare link has it.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: tools/release-notes.sh X.Y.Z[-beta.K]}"
TAG="v$VERSION"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    source_cmd=(git show "$TAG:templates/index.html")
else
    source_cmd=(cat templates/index.html)
fi

"${source_cmd[@]}" | python3 -c '
import html, re, sys
version = sys.argv[1]
text = sys.stdin.read()
m = re.search(r"<div class=\"changelog-version\">" + re.escape(version) + r"</div>\s*<ul>(.*?)</ul>", text, re.S)
if not m:
    sys.exit(f"templates/index.html has no changelog entry for {version}.")
groups = {"New features": [], "Changes": [], "Fixes": []}
for item in re.findall(r"<li>(.*?)</li>", m.group(1), re.S):
    line = html.unescape(re.sub(r"<[^>]+>", "", " ".join(item.split())))
    if n := re.match(r"New:\s*", line):
        line = line[n.end():]
        groups["New features"].append(line[:1].upper() + line[1:])
    elif f := re.match(r"Fix(ed|es)?:?\s+", line):
        line = line[f.end():]
        groups["Fixes"].append(line[:1].lower() + line[1:])
    else:
        groups["Changes"].append(line)
out = []
for head, lines in groups.items():
    if lines:
        out += [f"### {head}:", ""] + [f"- {l}" for l in lines] + [""]
print("\n".join(out).rstrip())
' "$VERSION"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    if [[ "$VERSION" == *-* ]]; then
        prev=$(git tag -l 'v*-*' --sort=-v:refname | grep -vx "$TAG" | head -1 || true)
    else
        prev=$(git tag -l 'v*' --sort=-v:refname | grep -vE -- '-' | grep -vx "$TAG" \
               | while read -r t; do git merge-base --is-ancestor "$t" "$TAG" && { echo "$t"; break; }; done || true)
    fi
    if [ -n "$prev" ]; then
        repo=$(git remote get-url origin 2>/dev/null | sed -E 's#^(git@[^:]+:|ssh://git@[^/]+/|https://github\.com/)##; s#\.git$##' || true)
        if [[ "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
            echo
            echo "---"
            echo
            echo "**Full changelog:** [$prev...$TAG](https://github.com/$repo/compare/$prev...$TAG)"
        fi
    fi
fi
