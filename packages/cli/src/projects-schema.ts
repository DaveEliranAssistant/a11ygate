import schema from '../../../schema/a11ygate.projects.schema.json';
import { parseConfigYaml, validateConfig, type JsonSchema } from './config-schema';

export const PROJECTS_SCHEMA_PATH = 'schema/a11ygate.projects.schema.json';
export type Project = { name: string; config: string };
export function parseProjects(text: string): { projects: Project[]; errors: string[] } {
  const parsed = parseConfigYaml(text);
  if (!parsed.ok) return { projects: [], errors: parsed.errors };
  const errors = parsed.value == null ? ['the projects file must be a mapping.'] : validateConfig(parsed.value, schema as JsonSchema);
  if (errors.length) return { projects: [], errors };
  const projects = (parsed.value as { projects: Project[] }).projects;
  const names = new Set<string>();
  for (const project of projects) {
    const name = project.name.toLowerCase();
    if (names.has(name)) errors.push(`Duplicate project name '${project.name}' (names are case-insensitive).`);
    names.add(name);
  }
  return { projects, errors };
}
