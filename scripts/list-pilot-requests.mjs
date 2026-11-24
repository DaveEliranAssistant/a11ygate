import { pathToFileURL } from 'node:url';
import pg from 'pg';

const columns = ['created_at', 'email', 'role', 'company', 'source'];
const query = `SELECT created_at, email, role, company, source
FROM waitlist_signups WHERE source = 'pilot-request' ORDER BY created_at DESC`;

function csvCell(value) {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  // Prefix spreadsheet formula markers before applying CSV quoting.
  const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export async function listPilotRequests({
  args = process.argv.slice(2),
  env = process.env,
  Client = pg.Client,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (!args.includes('--i-am-the-owner')) {
    stderr.write('This command is for Eliran only. Pass --i-am-the-owner.\n');
    return 1;
  }
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) {
    stderr.write('Set DATABASE_URL in your shell before listing pilot requests.\n');
    return 1;
  }

  try {
    const client = new Client({ connectionString });
    let rows;
    try {
      await client.connect();
      ({ rows } = await client.query(query));
    } finally {
      await client.end();
    }

    const lines = rows.map((row) => columns.map((column) => csvCell(row[column])).join(','));
    stdout.write([columns.join(','), ...lines].join('\r\n') + '\r\n');
    return 0;
  } catch {
    stderr.write('Could not list pilot requests. Check the database connection and read permissions.\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await listPilotRequests();
}
