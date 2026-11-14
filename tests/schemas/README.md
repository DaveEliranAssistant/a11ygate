# Vendored schemas for report-format tests

These files are read-only fixtures used by `tests/formats.test.ts`. They are not shipped in the npm package.

- `sarif-schema-2.1.0.json` — official SARIF Version 2.1.0 JSON Schema (OASIS Standard), retrieved from https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json
- `junit-4.xsd` — JUnit XML schema used by the Jenkins JUnit plugin (dtkit junit-4 / Thales, MIT License), retrieved from https://raw.githubusercontent.com/junit-team/junit5/main/platform-tests/src/test/resources/jenkins-junit.xsd (source note in the file header: svn.jenkins-ci.org dtkit-junit-model).
