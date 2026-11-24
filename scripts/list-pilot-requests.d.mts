interface PilotRequestReader {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export function listPilotRequests(options?: {
  args?: readonly string[];
  env?: Record<string, string | undefined>;
  Client?: new (options: { connectionString: string }) => PilotRequestReader;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}): Promise<number>;
