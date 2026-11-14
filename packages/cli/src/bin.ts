import { debugRequested, formatFatal, setDebug, stripDebugFlag } from './fatal';
import { run } from './run';

const argv = process.argv.slice(2);
const debug = debugRequested(argv);
setDebug(debug);

void run(stripDebugFlag(argv)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(formatFatal(error, debug));
    process.exitCode = 2;
  },
);
