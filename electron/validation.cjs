const path = require('node:path');
const { fileURLToPath } = require('node:url');

const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.wav', '.webm']);
const BACKGROUND_IMAGE_EXTENSIONS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
const SETTINGS_THEMES = new Set(['ocean', 'midnight', 'system']);
const SETTINGS_FONT_SCALES = new Set(['small', 'standard', 'large']);
const SETTINGS_APP_BACKGROUNDS = new Set(['ocean', 'plain', 'image']);
const SETTINGS_BACKGROUNDS = new Set(['wash', 'plain', 'gradient', 'image']);
const SETTINGS_SIDEBAR_MODES = new Set(['expanded', 'collapsed']);
const SETTINGS_QUEUE_PANEL_MODES = new Set(['expanded', 'collapsed', 'hidden']);
const SETTINGS_FONT_FAMILIES = new Set(['body', 'system', 'display']);
const SETTINGS_FONT_WEIGHTS = new Set(['regular', 'medium', 'semibold']);
const SETTINGS_LYRIC_SCALES = new Set(['small', 'standard', 'large']);
const SETTINGS_LETTER_SPACING = new Set(['standard', 'relaxed', 'wide']);
const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isBoundedNumber(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isAudioPath(filePath) {
  return (
    typeof filePath === 'string' &&
    filePath.length > 0 &&
    filePath.length <= 4096 &&
    AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  );
}

function isBackgroundImagePath(filePath) {
  return (
    typeof filePath === 'string' &&
    filePath.length > 0 &&
    filePath.length <= 4096 &&
    BACKGROUND_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  );
}

function isContainedPath(filePath, rootDirectory) {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(filePath));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isSafeBackgroundFileUrl(value, rootDirectory) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') return false;
    const filePath = fileURLToPath(url);
    return isBackgroundImagePath(filePath) && (rootDirectory ? isContainedPath(filePath, rootDirectory) : true);
  } catch {
    return false;
  }
}

function isSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isTrustedRendererUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function assertTrustedSender(event, allowedOrigin) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!senderUrl.startsWith(`${allowedOrigin}/`) && senderUrl !== allowedOrigin) {
    throw new Error('Untrusted renderer');
  }
}

function isSafeSettingsPayload(value, options = {}) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    if (JSON.stringify(value).length > 32_768) return false;
  } catch {
    return false;
  }

  const settings = value;
  return (
    SETTINGS_THEMES.has(settings.theme) &&
    typeof settings.accentColor === 'string' &&
    HEX_COLOR.test(settings.accentColor) &&
    SETTINGS_FONT_SCALES.has(settings.fontScale) &&
    SETTINGS_APP_BACKGROUNDS.has(settings.appBackground) &&
    (settings.appBackgroundImage === null ||
      isSafeBackgroundFileUrl(settings.appBackgroundImage, options.backgroundRoot)) &&
    SETTINGS_BACKGROUNDS.has(settings.background) &&
    (settings.playerBackgroundImage === null ||
      isSafeBackgroundFileUrl(settings.playerBackgroundImage, options.backgroundRoot)) &&
    isBoundedNumber(settings.backgroundOpacity, 0, 1) &&
    isBoundedNumber(settings.backgroundBlur, 0, 180) &&
    isBoundedNumber(settings.backgroundBrightness, 0.6, 1.4) &&
    isBoundedNumber(settings.backgroundSaturation, 0.5, 1.8) &&
    SETTINGS_SIDEBAR_MODES.has(settings.sidebarMode) &&
    SETTINGS_QUEUE_PANEL_MODES.has(settings.queuePanelMode) &&
    SETTINGS_FONT_FAMILIES.has(settings.fontFamily) &&
    SETTINGS_FONT_WEIGHTS.has(settings.fontWeight) &&
    SETTINGS_LYRIC_SCALES.has(settings.lyricScale) &&
    SETTINGS_LETTER_SPACING.has(settings.letterSpacing) &&
    typeof settings.reducedMotion === 'boolean'
  );
}

module.exports = {
  assertTrustedSender,
  isAudioPath,
  isBackgroundImagePath,
  isSafeBackgroundFileUrl,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  isSafeSettingsPayload,
};
