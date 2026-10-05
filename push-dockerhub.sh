#!/bin/sh
# Tag this checkout and push it to Docker Hub as a public box_io-docker-server image.
# Create a token at https://hub.docker.com/settings/security
# Do not commit DOCKERHUB_TOKEN or put it in the repository.
set -eu

if [ -z "${DOCKERHUB_USERNAME:-}" ] || [ -z "${DOCKERHUB_TOKEN:-}" ]; then
  echo "Docker Hub upload needs DOCKERHUB_USERNAME and DOCKERHUB_TOKEN." >&2
  echo "Export them in the shell, then run sh push-dockerhub.sh" >&2
  exit 1
fi

TAG=${BOXIO_TAG:-latest}
version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json | head -n 1)
IMAGE="${DOCKERHUB_USERNAME}/box_io-docker-server"

echo "$DOCKERHUB_TOKEN" | docker login --username "$DOCKERHUB_USERNAME" --password-stdin
docker build -t "${IMAGE}:${TAG}" .
if [ -n "$version" ] && [ "$version" != "$TAG" ]; then
  docker tag "${IMAGE}:${TAG}" "${IMAGE}:${version}"
fi
if [ "$TAG" != "latest" ]; then
  docker tag "${IMAGE}:${TAG}" "${IMAGE}:latest"
fi
docker push "${IMAGE}:${TAG}"
if [ -n "$version" ] && [ "$version" != "$TAG" ]; then
  docker push "${IMAGE}:${version}"
fi
if [ "$TAG" != "latest" ]; then
  docker push "${IMAGE}:latest"
fi
echo "Pushed ${IMAGE}:${TAG}"
