import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Minimal, dependency-free ZIP writer/reader for evidence packs.
 * Deterministic: entries are written in the given order with a fixed DOS timestamp
 * (1980-01-01 00:00), no extra fields and no comments. No ZIP64; callers enforce size caps.
 */

export type ZipEntry = { path: string; data: Uint8Array };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const MAX_ZIP_BYTES = 0xffffffff - 1;

/** Already-compressed image formats are stored; everything else is deflated. */
function shouldStore(path: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(path);
}

export function createZip(entries: readonly ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.path)) throw new Error(`Duplicate zip entry ${entry.path}.`);
    if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(entry.path) || entry.path.split('/').some((p) => p === '..' || p === '.')) {
      throw new Error(`Unsafe zip entry name ${entry.path}.`);
    }
    seen.add(entry.path);
    const name = Buffer.from(entry.path, 'utf8');
    const raw = Buffer.from(entry.data);
    const store = shouldStore(entry.path);
    const body = store ? raw : deflateRawSync(raw, { level: 9 });
    const method = store ? 0 : 8;
    const crc = crc32(raw);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, body);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(0, 38); // external attributes
    record.writeUInt32LE(offset, 42);
    central.push(record, name);

    offset += header.length + name.length + body.length;
    if (offset > MAX_ZIP_BYTES) throw new Error('Evidence pack exceeds the 4 GB ZIP limit.');
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

export type ReadZipLimits = {
  /** Largest declared or actual uncompressed size of one entry. Default 64 MB (the evidence-pack per-file cap). */
  maxEntryBytes?: number;
  /** Largest sum of uncompressed sizes. Default 256 MB (the evidence-pack total cap). */
  maxTotalBytes?: number;
  /** Most entries in one archive. Default 10 000. */
  maxEntries?: number;
};

/** Thrown for any archive A11yGate refuses to read. Messages are plain English and never include a stack by default. */
export class ZipError extends Error {}

/**
 * Entry names that would escape an extraction directory (zip-slip) or are ambiguous across platforms:
 * absolute paths, drive letters, backslashes, NUL, empty segments and `.`/`..` segments.
 */
export function unsafeZipEntryName(name: string): boolean {
  if (!name || name.length > 1024 || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return true;
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  return segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

/**
 * Reads archives produced by createZip (and other simple non-ZIP64 archives) fully in memory.
 * Nothing is extracted to disk. Every offset is bounds-checked; unsafe names, encrypted or
 * ZIP64 entries, unsupported compression and entries whose declared size exceeds the limits are
 * rejected before any data is inflated. Directory entries are skipped.
 */
export function readZip(zip: Uint8Array, limits: ReadZipLimits = {}): ZipEntry[] {
  const maxEntryBytes = limits.maxEntryBytes ?? 64 * 1024 * 1024;
  const maxTotalBytes = limits.maxTotalBytes ?? 256 * 1024 * 1024;
  const maxEntries = limits.maxEntries ?? 10_000;
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  const need = (at: number, length: number, what: string) => {
    if (!Number.isInteger(at) || at < 0 || at + length > buf.length) throw new ZipError(`Corrupt zip: ${what} is outside the file.`);
  };
  // The end-of-central-directory record sits in the last 22 + 65535 bytes (comment length is 16-bit).
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let endAt = buf.lastIndexOf(signature);
  while (endAt >= 0 && endAt + 22 > buf.length) endAt = endAt > 0 ? buf.lastIndexOf(signature, endAt - 1) : -1;
  if (endAt < 0 || buf.length - endAt > 22 + 0xffff) throw new ZipError('Not a zip archive.');
  const count = buf.readUInt16LE(endAt + 10);
  const centralSize = buf.readUInt32LE(endAt + 12);
  let at = buf.readUInt32LE(endAt + 16);
  if (count === 0xffff || at === 0xffffffff || centralSize === 0xffffffff) throw new ZipError('ZIP64 archives are not supported.');
  if (count > maxEntries) throw new ZipError(`Zip has ${count} entries; at most ${maxEntries} are allowed.`);
  need(at, centralSize, 'central directory');
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    need(at, 46, `central directory record ${i + 1}`);
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new ZipError('Corrupt central directory.');
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compressed = buf.readUInt32LE(at + 20);
    const declared = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    need(at + 46, nameLength, `name of entry ${i + 1}`);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const label = JSON.stringify(name.slice(0, 200));
    if (unsafeZipEntryName(name)) throw new ZipError(`Unsafe zip entry name ${label}: absolute paths, drive letters, backslashes and ".." are refused.`);
    if (seen.has(name)) throw new ZipError(`Duplicate zip entry ${label}.`);
    seen.add(name);
    if (flags & 0x1) throw new ZipError(`Zip entry ${label} is encrypted; encrypted archives are not supported.`);
    if (compressed === 0xffffffff || declared === 0xffffffff) throw new ZipError(`Zip entry ${label} uses ZIP64; ZIP64 archives are not supported.`);
    if (method !== 0 && method !== 8) throw new ZipError(`Zip entry ${label} uses unsupported compression method ${method}.`);
    if (declared > maxEntryBytes) throw new ZipError(`Zip entry ${label} declares ${declared} bytes; the limit is ${maxEntryBytes} bytes per entry.`);
    total += declared;
    if (total > maxTotalBytes) throw new ZipError(`Zip entries declare more than ${maxTotalBytes} bytes in total.`);
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) {
      if (declared !== 0) throw new ZipError(`Zip directory entry ${label} has data.`);
      continue;
    }
    need(localAt, 30, `local header of ${label}`);
    if (buf.readUInt32LE(localAt) !== 0x04034b50) throw new ZipError(`Corrupt local header for ${label}.`);
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    need(dataAt, compressed, `data of ${label}`);
    const body = buf.subarray(dataAt, dataAt + compressed);
    let data: Buffer;
    if (method === 0) {
      if (compressed !== declared) throw new ZipError(`Size mismatch for ${label}.`);
      data = Buffer.from(body);
    } else {
      // Cap inflation at the declared size + 1 so a lying header cannot expand into a zip bomb.
      try { data = inflateRawSync(body, { maxOutputLength: Math.max(1, declared + 1) }); }
      catch { throw new ZipError(`Corrupt compressed data for ${label}.`); }
      if (data.length !== declared) throw new ZipError(`Size mismatch for ${label}.`);
    }
    if (crc32(data) !== crc) throw new ZipError(`CRC mismatch for ${label}.`);
    entries.push({ path: name, data });
  }
  return entries;
}
