# A11yGate Jenkins shared library

This directory is a [Jenkins shared library](https://www.jenkins.io/doc/book/pipeline/shared-libraries/): `vars/a11yGate.groovy` defines the `a11yGate` step.

Example pipelines (declarative and scripted) live in [`examples/jenkins/`](../../examples/jenkins/) and are the files the tests include — do not recopy them into docs.

```groovy
@Library('a11ygate') _
a11yGate(url: 'https://staging.example.com/', crawl: 10, failOn: 'serious', formats: ['junit', 'sarif'])
```

The step runs the CLI (`scan`), publishes JUnit, archives HTML/SARIF/JSON/Markdown, and sets the build **UNSTABLE** when findings meet `--fail-on`, **SUCCESS** when they do not, and **FAILURE** if the tool cannot run.

Automated testing only. Not a WCAG audit, certification or legal advice.

Full install, parameters, agent requirements and troubleshooting: [docs/integrations/jenkins.md](../../docs/integrations/jenkins.md). npm serves only `@qe-atlas/a11ygate@0.1.0` (`latest`), which does not include `scan` or `--format`; 0.2.0 is not published and there is no npm `next` tag yet. Until a release is published, install the [pilot tarball](../../docs/pilot/quickstart.md#1-install-the-tarball-you-received-5-minutes) or use the [source build](../../docs/pilot/quickstart.md#source-build-fallback) built on the agent (`cli: 'node /path/to/a11ygate/packages/cli/dist/cli.mjs'`, or vendor it as in the [quickstart's CI step](../../docs/pilot/quickstart.md#6-wire-the-gate-into-ci-10-minutes) and set `cli: 'npx --no-install a11ygate'`).

## Tests

Groovy unit tests (JenkinsPipelineUnit) live in `src/test/groovy`. They need Java 21:

```bash
cd integrations/jenkins && ./gradlew test
```

A Dockerized Jenkins LTS + JCasC acceptance script is at `test/docker/run.sh`. It is skipped when Docker is not available (this is checked, not assumed).
