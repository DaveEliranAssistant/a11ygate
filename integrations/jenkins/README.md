# A11yGate Jenkins shared library

This directory is a [Jenkins shared library](https://www.jenkins.io/doc/book/pipeline/shared-libraries/): `vars/a11yGate.groovy` defines the `a11yGate` step.

Example pipelines (declarative and scripted) live in [`examples/jenkins/`](../../examples/jenkins/) and are the files the tests include — do not recopy them into docs.

```groovy
@Library('a11ygate') _
a11yGate(url: 'https://staging.example.com/', crawl: 10, failOn: 'serious', formats: ['junit', 'sarif'])
```

The step runs the CLI (`scan`), publishes JUnit, archives HTML/SARIF/JSON/Markdown, and sets the build **UNSTABLE** when findings meet `--fail-on`, **SUCCESS** when they do not, and **FAILURE** if the tool cannot run.

Automated testing only. Not a WCAG audit, certification or legal advice.

Full install, parameters, agent requirements and troubleshooting: [docs/integrations/jenkins.md](../../docs/integrations/jenkins.md). Until a release includes `scan` and `--format`, pass `cli: 'node packages/cli/dist/cli.mjs'` (or another source build). Published `@qe-atlas/a11ygate@0.1.0` does not include those flags.

## Tests

Groovy unit tests (JenkinsPipelineUnit) live in `src/test/groovy`. They need Java 21:

```bash
cd integrations/jenkins && ./gradlew test
```

A Dockerized Jenkins LTS + JCasC acceptance script is at `test/docker/run.sh`. It is skipped when Docker is not available (this is checked, not assumed).
