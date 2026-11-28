import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const fixtureCertificate = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'oauth-issuer-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');

  try {
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

    if (openssl.exitCode !== 0) {
      throw new Error('OpenSSL could not generate the fixture certificate');
    }

    return { key: await readFile(key), cert: await readFile(cert) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
