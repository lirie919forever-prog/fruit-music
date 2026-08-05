const { randomUUID } = require('node:crypto');
const { isAudioPath } = require('./validation.cjs');

const MEDIA_SCHEME = 'marea-media';
const MEDIA_HOST = 'audio';
const DESKTOP_LIBRARY_ID = /^local-desktop-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDesktopLibraryId(value) {
  return typeof value === 'string' && DESKTOP_LIBRARY_ID.test(value);
}

function createDesktopLibraryId() {
  return `local-desktop-${randomUUID()}`;
}

function mediaUrlForId(id) {
  if (!isDesktopLibraryId(id)) throw new Error('Invalid desktop audio id');
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encodeURIComponent(id)}`;
}

function mediaIdFromUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== MEDIA_HOST || url.search || url.hash) return null;
    const encodedId = url.pathname.slice(1);
    if (!encodedId || encodedId.includes('/')) return null;
    const id = decodeURIComponent(encodedId);
    return isDesktopLibraryId(id) ? id : null;
  } catch {
    return null;
  }
}

function isDesktopLibraryRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value;
  return (
    isDesktopLibraryId(record.id) &&
    isAudioPath(record.path) &&
    typeof record.name === 'string' &&
    record.name.length > 0 &&
    record.name.length <= 1024 &&
    typeof record.size === 'number' &&
    Number.isSafeInteger(record.size) &&
    record.size >= 0 &&
    typeof record.lastModified === 'number' &&
    Number.isSafeInteger(record.lastModified) &&
    record.lastModified >= 0
  );
}

function selectionFromRecord(record) {
  return {
    id: record.id,
    name: record.name,
    size: record.size,
    lastModified: record.lastModified,
    url: mediaUrlForId(record.id),
  };
}

module.exports = {
  MEDIA_SCHEME,
  createDesktopLibraryId,
  isDesktopLibraryId,
  isDesktopLibraryRecord,
  mediaIdFromUrl,
  mediaUrlForId,
  selectionFromRecord,
};
