# Live Jenkins acceptance

Run from any directory with Docker Engine/Desktop, Python 3, and a Bash shell:

```sh
bash integrations/jenkins/test/docker/run.sh
```

No Docker CLI or unavailable daemon exits 2. Any build, timeout, API, or assertion
failure exits nonzero. This is deliberately separate from `npm test` and
`npm run test:jenkins` (JenkinsPipelineUnit).

The harness builds a disposable controller/agent with Node 22, Playwright Chromium,
JCasC, Pipeline, Git, Timestamper, and JUnit plugins. It executes the unchanged
`examples/jenkins/Jenkinsfile`, loading the real `vars/a11yGate.groovy` through a
local Git shared library. Independent BAD and clean jobs have fresh workspaces.
Both fixture HTTP servers and Jenkins listen on **127.0.0.1 inside the container**.
The runtime container uses `--network none`; only loopback is available. No ports are published. The host reads Jenkins's HTTP API through `docker exec
curl`; CSRF crumbs and anonymous session cookies are local, temporary state.
No credentials, external controller, remote library checkout, or third-party
site scans are involved. Package, plugin, image, and browser downloads occur
during image construction.

The verifier requires BAD to be UNSTABLE/FAILURE with failing JUnit tests and
clean to be SUCCESS with nonempty, passing JUnit tests. A scan/setup error with
no JUnit report cannot pass. Build JSON, JUnit API JSON, console logs, archived
reports, and controller/build logs go to `test-results/jenkins-e2e/` (override
with `JENKINS_E2E_OUTPUT`). The container, anonymous volume, build context, and
local harness image are removed on exit, including failure.

## Image provenance

- Jenkins **2.580.2 LTS**, Java 21, tag `jenkins/jenkins:2.580.2-lts-jdk21`.
- Multi-platform manifest digest:
  `sha256:74401de6a6f92e1afe1b02d1c8e3d0c33f263bfb5275dd8813f9150355f2367b`.
- Retrieved 2026-11-14 from Docker Hub's official Jenkins repository API:
  <https://hub.docker.com/v2/repositories/jenkins/jenkins/tags/2.580.2-lts-jdk21>.
  The `lts-jdk21` alias returned the same digest. The versioned tag plus digest
  is committed in `Dockerfile`; mutable `lts` alone is never used.
- The manifest supports Linux amd64 (GitHub runner) and arm64 (Apple Silicon
  Docker Desktop), among other architectures. The API version assertion also
  checks the running controller's `X-Jenkins` header.

Plugin versions and Node 22 follow their upstream distributions; plugin
installation output is captured in the Docker build log. Jenkins core remains
pinned. Updating the pin must also update the verifier's expected core version.

Automated testing only. Not a WCAG audit, certification or legal advice.
