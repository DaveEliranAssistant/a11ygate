import {
  CI_AXE_SNIPPET,
  CI_CLI_COMMANDS,
  CI_FIRST_RUN_STEPS,
  CI_INSTALL_COMMAND,
  CI_WORKFLOW,
  CLI_PACKAGE,
} from '@/lib/copy';

function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <pre role="group" aria-label={label} tabIndex={0}>
      <code>{children}</code>
    </pre>
  );
}

export function CiCommands({ stepHeading: StepHeading }: { stepHeading: 'h3' | 'h4' }) {
  return (
    <div className="ci-commands">
      <p>
        The CLI is on npm as <code>{CLI_PACKAGE}</code>. The GitHub Action is listed on the{' '}
        <a href="https://github.com/marketplace/actions/a11ygate-axe-core-regression-gate">
          GitHub Marketplace as A11yGate axe-core Regression Gate
        </a>{' '}
        by DaveEliranAssistant. The browser demo is on this page. The waitlist does not gate any of them.
      </p>
      <p>
        The CLI and the Action read scan files inside your own job and send nothing to A11yGate. With{' '}
        <code>comment: true</code>, the Action posts its summary to your pull request.
      </p>

      <StepHeading>1. Write axe JSON from Playwright</StepHeading>
      <p>In the project you are auditing:</p>
      <CodeBlock label="Install command">{CI_INSTALL_COMMAND}</CodeBlock>
      <p>
        Save this as <code>tests/a11y.spec.ts</code> and change the URL. Write one file per page.
      </p>
      <CodeBlock label="Playwright test">{CI_AXE_SNIPPET}</CodeBlock>

      <StepHeading>2. Run the CLI</StepHeading>
      <CodeBlock label="CLI commands">{CI_CLI_COMMANDS}</CodeBlock>
      <p>
        With no baseline, every finding is new. The <code>--update-baseline</code> run writes the file
        and exits 1 if the scan has a serious or critical finding. The <code>--baseline</code> run
        exits 1 only when a new one appears. Commit the file, and the same command works in any CI
        job.
      </p>

      <StepHeading>3. Add the GitHub Action</StepHeading>
      <p>
        Put this in <code>.github/workflows/accessibility.yml</code>. Let the
        Playwright test write JSON and let A11yGate be the gate. Do not also assert{' '}
        <code>violations.length === 0</code> in that test, or the job fails before the summary is
        posted.
      </p>
      <CodeBlock label="GitHub Actions workflow">{CI_WORKFLOW}</CodeBlock>
      <p>
        Record the Action&apos;s baseline on the runner. Do not reuse the file from step 2. The Action at{' '}
        <code>v1</code> also compares scan configuration and browser environment, so a baseline from
        CLI 0.1.0 or from your laptop stops it with INCOMPLETE and exit 2.
      </p>
      <p>For the first run, replace the A11yGate step with these steps:</p>
      <CodeBlock label="First-run workflow steps">{CI_FIRST_RUN_STEPS}</CodeBlock>
      <p>
        Download the <code>a11y-baseline</code> artifact, review it, and commit{' '}
        <code>a11y/baseline.json</code>. Then restore the A11yGate step above.
      </p>
    </div>
  );
}
