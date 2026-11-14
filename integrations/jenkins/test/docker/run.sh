#!/usr/bin/env bash
# Optional acceptance: jenkins/jenkins LTS + JCasC against the example Jenkinsfile
# and the local fixture sites. Requires Docker. This repository's GitHub CI does
# not run it (adding a workflow would be a §5.2 sensitive change).
set -euo pipefail
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not available; skipping the Dockerized Jenkins acceptance test."
  exit 2
fi
echo "Docker is available, but a full jenkins/jenkins LTS + JCasC run is not wired in this environment automatically."
echo "See integrations/jenkins/test/docker/jenkins.yaml and examples/jenkins/Jenkinsfile."
exit 2
