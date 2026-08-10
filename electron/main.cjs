const { app, BrowserWindow, dialog, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const {
  assertTrustedSender,
  isAudioPath,
  isBackgroundImagePath,
  isSafeBackgroundFileUrl,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  isSafeSettingsPayload,
} = require('./validation.cjs');
const {
  MEDIA_SCHEME,
  createDesktopLibraryId,
  isDesktopLibraryId,
  isDesktopLibraryRecord,
  selectionFromRecord,
} = require('./mediaLibrary.cjs');
const { createLocalFileResponse, createMediaProtocolHandler } = require('./mediaProtocol.cjs');

const DEFAULT_RENDERER_URL = 'http://localhost:3011/new?view=new';
const AUDIO_FILTERS = [{ name: 'Audio', extensions: ['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'wav', 'webm'] }];
const AUDIO_HEADER_BYTES = 1024 * 1024;
const MAX_BACKGROUND_IMAGE_BYTES = 40 * 1024 * 1024;
const BACKGROUND_IMAGE_FILTERS = [{ name: 'Images', extensions: ['bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'] }];
const DESKTOP_LIBRARY_VERSION = 1;

let mainWindow;
let desktopLibraryLoaded = false;
let desktopLibraryLoadPromise = null;
const desktopLibrary = new Map();

// A local-file URL is an opaque capability, not a renderer-accessible path.
// It is registered before Electron is ready so media elements can stream it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

function settingsPath() {
  return path.join(app.getPath('userData'), 'marea-settings-v1.json');
}

function backgroundDirectory() {
  return path.join(app.getPath('userData'), 'backgrounds');
}

function desktopLibraryPath() {
  return path.join(app.getPath('userData'), 'marea-local-library-v1.json');
}

async function loadDesktopLibrary() {
  if (desktopLibraryLoaded) return;
  if (desktopLibraryLoadPromise) return desktopLibraryLoadPromise;

  desktopLibraryLoadPromise = (async () => {
    try {
      const raw = await fs.readFile(desktopLibraryPath(), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.version !== DESKTOP_LIBRARY_VERSION || !Array.isArray(parsed.records)) return;
      for (const record of parsed.records) {
        if (isDesktopLibraryRecord(record)) desktopLibrary.set(record.id, record);
      }
    } catch {
      // A missing or malformed local-library index is recoverable. Files are
      // never deleted here; the user can import them again if needed.
    } finally {
      desktopLibraryLoaded = true;
      desktopLibraryLoadPromise = null;
    }
  })();

  return desktopLibraryLoadPromise;
}

async function persistDesktopLibrary() {
  const target = desktopLibraryPath();
  const temporary = `${target}.${process.pid}.tmp`;
  const payload = { version: DESKTOP_LIBRARY_VERSION, records: [...desktopLibrary.values()] };
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, target);
}

async function readUsableAudioRecord(id) {
  if (!isDesktopLibraryId(id)) return null;
  await loadDesktopLibrary();
  const record = desktopLibrary.get(id);
  if (!record || !isDesktopLibraryRecord(record)) return null;

  try {
    const realPath = await fs.realpath(record.path);
    if (!isAudioPath(realPath)) return null;
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) return null;
    return {
      ...record,
      path: realPath,
      size: stat.size,
      lastModified: Math.max(0, Math.floor(stat.mtimeMs)),
    };
  } catch {
    return null;
  }
}

async function listDesktopAudio() {
  await loadDesktopLibrary();
  const selections = [];
  let changed = false;

  for (const [id] of desktopLibrary) {
    const record = await readUsableAudioRecord(id);
    if (!record) {
      desktopLibrary.delete(id);
      changed = true;
      continue;
    }
    const stored = desktopLibrary.get(id);
    if (record.path !== stored.path || record.size !== stored.size || record.lastModified !== stored.lastModified) {
      desktopLibrary.set(id, record);
      changed = true;
    }
    selections.push(selectionFromRecord(record));
  }

  if (changed) await persistDesktopLibrary();
  return selections.sort((left, right) => left.name.localeCompare(right.name));
}

async function registerDesktopAudio(filePath) {
  if (!isAudioPath(filePath)) return null;
  const realPath = await fs.realpath(filePath).catch(() => null);
  if (!realPath || !isAudioPath(realPath)) return null;
  const stat = await fs.stat(realPath).catch(() => null);
  if (!stat?.isFile()) return null;

  await loadDesktopLibrary();
  const existing = [...desktopLibrary.values()].find((record) => record.path === realPath);
  const record = {
    id: existing?.id ?? createDesktopLibraryId(),
    path: realPath,
    name: path.basename(realPath),
    size: stat.size,
    lastModified: Math.max(0, Math.floor(stat.mtimeMs)),
  };
  desktopLibrary.set(record.id, record);
  return selectionFromRecord(record);
}

function registerMediaProtocol() {
  protocol.handle(
    MEDIA_SCHEME,
    createMediaProtocolHandler({
      resolveRecord: readUsableAudioRecord,
      fetchFile: createLocalFileResponse,
    }),
  );
}

function rendererUrl() {
  const configured = process.env.MAREA_URL?.trim();
  if (!configured) return DEFAULT_RENDERER_URL;

  // The preload bridge can read local files and settings. Never expose it to a
  // remote MAREA_URL, even when an operator accidentally supplies one.
  return isTrustedRendererUrl(configured) ? configured : DEFAULT_RENDERER_URL;
}

function rendererOrigin() {
  return new URL(rendererUrl()).origin;
}

function assertSender(event) {
  assertTrustedSender(event, rendererOrigin());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f3f8fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === rendererOrigin()) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  void mainWindow.loadURL(rendererUrl());
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

function registerIpc() {
  const { ipcMain } = require('electron');

  ipcMain.handle('dialog:open-audio', async (event) => {
    assertSender(event);
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: AUDIO_FILTERS,
    });
    if (result.canceled) return [];

    const selections = [];
    for (const filePath of result.filePaths) {
      const selection = await registerDesktopAudio(filePath);
      if (selection) selections.push(selection);
    }
    if (selections.length > 0) await persistDesktopLibrary();
    return selections;
  });

  ipcMain.handle('library:list-audio', async (event) => {
    assertSender(event);
    return listDesktopAudio();
  });

  ipcMain.handle('library:read-audio-header', async (event, id) => {
    assertSender(event);
    const record = await readUsableAudioRecord(id);
    if (!record) throw new Error('Desktop audio file is unavailable');

    const handle = await fs.open(record.path, 'r');
    try {
      const byteLength = Math.min(AUDIO_HEADER_BYTES, record.size);
      const bytes = Buffer.alloc(byteLength);
      const { bytesRead } = await handle.read(bytes, 0, byteLength, 0);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytesRead);
    } finally {
      await handle.close();
    }
  });

  ipcMain.handle('library:remove-audio', async (event, id) => {
    assertSender(event);
    if (!isDesktopLibraryId(id)) throw new Error('Invalid desktop audio id');
    await loadDesktopLibrary();
    if (!desktopLibrary.delete(id)) return false;
    await persistDesktopLibrary();
    return true;
  });

  ipcMain.handle('library:clear-audio', async (event) => {
    assertSender(event);
    await loadDesktopLibrary();
    if (desktopLibrary.size === 0) return true;
    desktopLibrary.clear();
    await persistDesktopLibrary();
    return true;
  });

  ipcMain.handle('settings:read', async (event) => {
    assertSender(event);
    try {
      const raw = await fs.readFile(settingsPath(), 'utf8');
      const settings = JSON.parse(raw);
      return isSafeSettingsPayload(settings, { backgroundRoot: backgroundDirectory() }) ? settings : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('settings:write', async (event, settings) => {
    assertSender(event);
    if (!isSafeSettingsPayload(settings, { backgroundRoot: backgroundDirectory() })) {
      throw new Error('Invalid Marea settings payload');
    }
    const target = settingsPath();
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(settings), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, target);
    return true;
  });

  ipcMain.handle('background:import', async (event) => {
    assertSender(event);
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: BACKGROUND_IMAGE_FILTERS,
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const sourcePath = result.filePaths[0];
    if (!isBackgroundImagePath(sourcePath)) return null;
    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile() || sourceStat.size > MAX_BACKGROUND_IMAGE_BYTES) return null;

    const directory = backgroundDirectory();
    await fs.mkdir(directory, { recursive: true });
    const extension = path.extname(sourcePath).toLowerCase();
    const targetPath = path.join(directory, `${randomUUID()}${extension}`);
    await fs.copyFile(sourcePath, targetPath);
    const targetStat = await fs.stat(targetPath);
    return {
      url: pathToFileURL(targetPath).href,
      name: path.basename(sourcePath),
      size: targetStat.size,
    };
  });

  ipcMain.handle('background:remove', async (event, fileUrl) => {
    assertSender(event);
    const directory = backgroundDirectory();
    if (!isSafeBackgroundFileUrl(fileUrl, directory)) throw new Error('Invalid background image');
    const targetPath = fileURLToPath(new URL(fileUrl));
    await fs.unlink(targetPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    return true;
  });

  ipcMain.handle('shell:open-external', async (event, url) => {
    assertSender(event);
    if (!isSafeExternalUrl(url)) throw new Error('Only HTTP(S) links may be opened');
    await shell.openExternal(url);
    return true;
  });
}

app.whenReady().then(async () => {
  await loadDesktopLibrary();
  registerMediaProtocol();
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
