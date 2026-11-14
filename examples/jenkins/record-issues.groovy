// Optional: publish SARIF with the Warnings NG plugin (in addition to junit + archiveArtifacts).
recordIssues(tools: [sarif(pattern: 'a11y-results/*.sarif')])
