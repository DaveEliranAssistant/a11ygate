#!/usr/bin/env bash
# Real Jenkins LTS + JCasC acceptance, separate from npm/vitest tests.
set -euo pipefail
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not available; skipping the Dockerized Jenkins acceptance test." >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but its daemon is unavailable. Start Docker Desktop or Docker Engine." >&2
  exit 2
fi
root=$(cd "$(dirname "$0")/../../../.." && pwd)
output=${JENKINS_E2E_OUTPUT:-"$root/test-results/jenkins-e2e"}
mkdir -p "$output"
output=$(cd "$output" && pwd)
context=$(mktemp -d)
name="a11ygate-jenkins-$$"
image="$name:local"
cleanup() {
  status=$?
  trap - EXIT
  docker logs "$name" >"$output/jenkins.log" 2>&1 || true
  docker cp "$name:/var/jenkins_home/jobs" "$output/jobs" >/dev/null 2>&1 || true
  docker rm -fv "$name" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -rf "$context"
  exit "$status"
}
trap cleanup EXIT
# Build context is an explicit source allowlist, never the owner's working tree
# wholesale (no .git, .env, npm config, host node_modules, or credentials).
python3 - "$root" "$context" <<'PY'
import pathlib, shutil, sys
root, context = map(pathlib.Path, sys.argv[1:])
dest = context / 'source'
dest.mkdir()
for name in ['package.json', 'package-lock.json', 'tsconfig.json', 'packages', 'lib', 'scripts', 'examples/jenkins', 'integrations/jenkins/vars', 'integrations/jenkins/test/docker']:
    src = root / name
    target = dest / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, target, ignore=shutil.ignore_patterns('node_modules', 'dist', '.gradle', 'build', '.env*', '.npmrc', '__pycache__'))
    else:
        shutil.copy2(src, target)
shutil.copy2(root / 'integrations/jenkins/test/docker/Dockerfile', context / 'Dockerfile')
PY
docker build --progress=plain -t "$image" "$context" 2>&1 | tee "$output/docker-build.log"
# Everything, including Jenkins's API, is on container loopback; no host ports,
# host network, privileged mode, Docker socket mount, or credentials.
docker run -d --name "$name" --network none --shm-size=1g "$image" >/dev/null
docker exec -d "$name" node /opt/a11ygate/integrations/jenkins/test/docker/fixtures.mjs
python3 "$root/integrations/jenkins/test/docker/verify.py" "$name" "$output"
