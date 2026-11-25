import dns from 'node:dns/promises';
import https from 'node:https';
import { createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    if (parsed.kind() === 'ipv6' && (!parsed.match(ipaddr.parse('2000::'), 3) ||
      parsed.match(ipaddr.parse('2002::'), 16) || parsed.match(ipaddr.parse('2001::'), 32))) return false;
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

async function request(url, redirects, signal) {
  if (redirects > 4) throw new Error('Too many PDF redirects');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('PDF download URL must be a public HTTPS address');
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
    throw new Error('PDF download address is not public');
  }
  const chosen = addresses[0];
  const response = await new Promise((resolve, reject) => {
    const req = https.get(parsed, {
      signal,
      family: chosen.family,
      headers: { 'User-Agent': 'PaperReader/1.0', Accept: 'application/pdf' },
      lookup: (_hostname, _options, callback) => callback(null, chosen.address, chosen.family)
    }, resolve);
    req.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    const location = response.headers.location;
    response.resume();
    if (!location) throw new Error('PDF redirect is missing a destination');
    return request(new URL(location, parsed).href, redirects + 1, signal);
  }
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`PDF download failed (HTTP ${response.statusCode})`);
  }
  return response;
}

export async function downloadPdf(url, destination, maxBytes) {
  const response = await request(url, 0, AbortSignal.timeout(60000));
  const length = Number(response.headers['content-length']);
  if (Number.isFinite(length) && length > maxBytes) {
    response.destroy();
    throw new Error('PDF exceeds the file size limit');
  }
  let total = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      callback(total > maxBytes ? new Error('PDF exceeds the file size limit') : null, chunk);
    }
  });
  await pipeline(response, limit, createWriteStream(destination, { flags: 'wx' }));
  const file = await open(destination, 'r');
  try {
    const header = Buffer.alloc(1024);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (!header.subarray(0, bytesRead).includes(Buffer.from('%PDF-'))) throw new Error('Downloaded file is not a PDF');
  } finally {
    await file.close();
  }
}
