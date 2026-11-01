import { run } from './run';

void run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : 'A11yGate failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  },
);
