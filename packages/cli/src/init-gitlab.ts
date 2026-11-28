import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';
import { CI_FILES } from './ci-targets';

/**
 * GitLab creates a merge request pipeline only when the root `.gitlab-ci.yml` itself has a matching
 * rule; rules that come only from `include:` files do not count. `init --target gitlab` therefore
 * creates the root file when it is absent. An existing root file is never read or written (owner
 * decision, A11Y-R72): init prints GITLAB_ROOT_SNIPPET for the customer to paste in and exits 2.
 */
export const GITLAB_ROOT_FILE = '.gitlab-ci.yml';

// Branch and tag rules keep the pipelines GitLab creates by default when a root file has no
// `workflow:` block, so the merge request rule never silently disables them.
/** The single source for the include and the root `workflow: rules`, used by the created file and the printed snippet. */
export const GITLAB_ROOT_SNIPPET = `include:
  - local: '${CI_FILES.gitlab}'

workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH'
    - if: '$CI_COMMIT_TAG'
`;

export const GITLAB_ROOT_TEMPLATE = `# ${AUTOMATED_TESTING_DISCLAIMER}
# Root pipeline written by a11ygate init. The A11yGate job lives in ${CI_FILES.gitlab}.
# GitLab creates merge request pipelines only when the root .gitlab-ci.yml has a
# matching rule; rules inside included files do not count. The branch and tag rules
# keep branch and tag pipelines running. See integrations/gitlab/README.md.
${GITLAB_ROOT_SNIPPET}`;

export function gitlabRootLeftUnchanged(): string {
  return `Left existing ${GITLAB_ROOT_FILE} unchanged (init never edits it). GitLab creates merge request pipelines only when the root ${GITLAB_ROOT_FILE} itself has a merge_request_event rule; an include alone is not enough. The other starter files were written as usual. Add this to ${GITLAB_ROOT_FILE} yourself (merge it into an existing include: list or workflow: rules), then open a test merge request:\n${GITLAB_ROOT_SNIPPET}`;
}
