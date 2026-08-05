const { app, net, protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createLocalFileResponse, createMediaProtocolHandler } = require('./mediaProtocol.cjs');
const { mediaUrlForId } = require('./mediaLibrary.cjs');

const id = 'local-desktop-7b9a7a63-f3cb-48c1-97c1-a7409af04c6b';
const mediaPath = path.join(app.getPath('temp'), `marea-media-smoke-${process.pid}.mp3`);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'marea-media',
    privileges: { corsEnabled: true, secure: true, standard: true, stream: true, supportFetchAPI: true },
  },
]);

async function main() {
  await fs.writeFile(mediaPath, Buffer.from('0123456789abcdef'), { mode: 0o600 });
  await app.whenReady();
  protocol.handle(
    'marea-media',
    createMediaProtocolHandler({
      resolveRecord: async (requestedId) => (requestedId === id ? { path: mediaPath } : null),
      fetchFile: createLocalFileResponse,
    }),
  );

  const url = mediaUrlForId(id);
  const full = await net.fetch(url);
  const fullBody = Buffer.from(await full.arrayBuffer()).toString('utf8');
  const ranged = await net.fetch(url, { headers: { Range: 'bytes=2-5' } });
  const rangedBody = Buffer.from(await ranged.arrayBuffer()).toString('utf8');

  if (full.status !== 200 || fullBody !== '0123456789abcdef') {
    throw new Error(`Unexpected full response: ${full.status} ${fullBody}`);
  }
  if (ranged.status !== 206 || rangedBody !== '2345') {
    throw new Error(`Unexpected range response: ${ranged.status} ${rangedBody}`);
  }
  console.log(`media protocol smoke passed: full=${full.status}, range=${ranged.status}, bytes=${rangedBody}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await fs.unlink(mediaPath).catch(() => {});
    app.quit();
  });
