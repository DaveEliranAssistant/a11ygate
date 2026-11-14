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

/** Reads archives produced by createZip (and other simple non-ZIP64 archives). */
export function readZip(zip: Uint8Array): ZipEntry[] {
  const buf = Buffer.from(zip);
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('Not a zip archive.');
  const count = buf.readUInt16LE(endAt + 10);
  let at = buf.readUInt32LE(endAt + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('Corrupt central directory.');
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const body = buf.subarray(dataAt, dataAt + compressed);
    const data = method === 0 ? Buffer.from(body) : inflateRawSync(body);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}.`);
    entries.push({ path: name, data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
