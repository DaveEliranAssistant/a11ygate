export type EnvLike = Record<string, string | undefined>;
const SECRET_ENV_NAME = /(COOKIE|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|API_?KEY|ACCESS_?KEY|AUTH)/i;

/** Values are compared only in memory, never logged or included in reports. */
export function secretEnvValues(env: EnvLike = process.env, minimumLength = 8): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === 'string' && value.length >= minimumLength)
    .map(([, value]) => value as string);
}
