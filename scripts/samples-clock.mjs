// A11Y-R79: preload for `npm run samples` only. Freezes "now" (new Date() with no arguments and Date.now())
// at A11YGATE_SAMPLES_NOW so offline CLI steps (evidence pack, pilot report, prospect, trend) write fixed dates.
// Never used for scans (they wait on real time) and never loaded by the CLI itself.
const fixed = Date.parse(process.env.A11YGATE_SAMPLES_NOW ?? '');
if (!Number.isNaN(fixed)) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  globalThis.Date = FixedDate;
}
