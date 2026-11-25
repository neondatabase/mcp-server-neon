import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A throwaway key and certificate for 127.0.0.1, valid for a day. */
export const selfSignedCertificate = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'self-signed-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');

  const openssl = spawn(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
    ],
    { stdio: 'ignore' },
  );

  await once(openssl, 'exit');

  const pair = { key: await readFile(key), cert: await readFile(cert) };

  await rm(dir, { recursive: true, force: true });

  return pair;
};
