export const CI_FILES = {
  github: '.github/workflows/a11ygate.yml',
  jenkins: 'Jenkinsfile',
  gitlab: '.gitlab-ci.a11ygate.yml',
  'azure-devops': 'azure-pipelines.a11ygate.yml',
} as const;

export type CiTarget = keyof typeof CI_FILES;
export const CI_TARGETS = Object.keys(CI_FILES);
