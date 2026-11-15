#!/usr/bin/env bash
# Build the Docker image for a tagged version and push it to Docker Hub.
#
#   tools/publish-image.sh 0.4.0          # pushes :0.4.0, :0.4 and :latest
#   tools/publish-image.sh 0.5.0-beta.1   # pushes :0.5.0-beta.1 and :beta
#
# A beta never moves :latest, so anyone on the default compose file stays on
# stable. Builds from the tag, not the working tree, so what is pushed is
# exactly what was released. linux/amd64 only by default; set
# PLATFORMS=linux/amd64,linux/arm64 once the builder has arm64.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: tools/publish-image.sh X.Y.Z[-beta.K]}"
TAG="v$VERSION"
IMAGE="${IMAGE:-hyprlab/garage-logbook}"
PLATFORMS="${PLATFORMS:-linux/amd64}"

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "no tag $TAG" >&2; exit 1; }
tagged=$(git show "$TAG:app.py" | sed -n "s/^APP_VERSION = '\(.*\)'/\1/p")
[ "$tagged" = "$VERSION" ] || { echo "$TAG carries APP_VERSION $tagged, not $VERSION" >&2; exit 1; }

if [[ "$VERSION" == *-* ]]; then
    tags=(-t "$IMAGE:$VERSION" -t "$IMAGE:beta")
else
    tags=(-t "$IMAGE:$VERSION" -t "$IMAGE:${VERSION%.*}" -t "$IMAGE:latest")
fi

src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git archive "$TAG" | tar -x -C "$src"

echo "Building $IMAGE for $VERSION ($PLATFORMS) from $TAG"
docker buildx build --platform "$PLATFORMS" \
    --label "org.opencontainers.image.version=$VERSION" \
    --label "org.opencontainers.image.revision=$(git rev-parse "$TAG^{commit}")" \
    --label "org.opencontainers.image.source=https://github.com/hyprlab/garage-logbook" \
    "${tags[@]}" --push "$src"

echo "Pushed: ${tags[*]//-t /}"
