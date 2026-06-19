const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mime = require("mime-types");
const multer = require("multer");
const config = require("./config");

const categories = {
  fotos: {
    label: "Fotos",
    dir: "fotos",
    mimes: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "image/bmp", "image/tiff"],
    extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".bmp", ".tif", ".tiff"]
  },
  videos: {
    label: "Videos",
    dir: "videos",
    mimes: [
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-matroska",
      "video/webm",
      "video/mpeg",
      "video/x-ms-wmv",
      "video/x-flv",
      "video/ogg",
      "video/3gpp",
      "video/3gpp2",
      "video/mp2t"
    ],
    extensions: [".mp4", ".mov", ".avi", ".mkv", ".webm", ".mpeg", ".mpg", ".m4v", ".wmv", ".flv", ".ogv", ".3gp", ".3g2", ".ts", ".mts", ".m2ts"]
  },
  audios: {
    label: "Audios",
    dir: "audios",
    mimes: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/flac"],
    extensions: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".webm", ".flac"]
  },
  documentos: {
    label: "Documentos",
    dir: "documentos",
    mimes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/csv",
      "application/rtf",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.presentation",
      "application/vnd.oasis.opendocument.spreadsheet"
    ],
    extensions: [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".csv", ".rtf", ".odt", ".odp", ".ods"]
  },
  outros: {
    label: "Outros",
    dir: "outros",
    mimes: ["application/zip", "application/x-zip-compressed", "application/json"],
    extensions: [".zip", ".json"]
  }
};

const blockedExtensions = new Set([
  ".exe", ".bat", ".cmd", ".com", ".scr", ".pif", ".msi", ".ps1", ".vbs", ".js", ".mjs", ".cjs",
  ".jar", ".sh", ".bash", ".zsh", ".php", ".asp", ".aspx", ".jsp", ".cgi", ".pl", ".py", ".rb",
  ".dll", ".so", ".dylib", ".hta", ".reg", ".lnk"
]);

function ensureDirectories() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  Object.values(categories).forEach((category) => {
    fs.mkdirSync(path.join(config.uploadDir, category.dir), { recursive: true });
  });
}

function sanitizeFilename(filename) {
  const parsed = path.parse(filename || "arquivo");
  const ext = parsed.ext.toLowerCase();
  const base = parsed.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "arquivo";

  return `${base}${ext}`;
}

function getCategory(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const detectedMime = file.mimetype || mime.lookup(ext) || "application/octet-stream";

  if (blockedExtensions.has(ext)) {
    return null;
  }

  for (const [key, category] of Object.entries(categories)) {
    if (category.mimes.includes(detectedMime) || category.extensions.includes(ext)) {
      return key;
    }
  }

  return "outros";
}

function uniqueFilename(originalname) {
  const safe = sanitizeFilename(originalname);
  const parsed = path.parse(safe);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${parsed.name}-${stamp}-${suffix}${parsed.ext}`;
}

function withExtension(name, fallbackName) {
  const safeName = sanitizeFilename(name);
  const fallbackExt = path.extname(sanitizeFilename(fallbackName)).toLowerCase();
  const parsed = path.parse(safeName);

  if (parsed.ext) {
    return safeName;
  }

  return `${safeName}${fallbackExt}`;
}

function isAllowedFile(file) {
  return Boolean(getCategory(file));
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const category = getCategory(file);
      if (!category) {
        cb(new Error("Tipo de arquivo bloqueado."));
        return;
      }
      cb(null, path.join(config.uploadDir, categories[category].dir));
    },
    filename(req, file, cb) {
      cb(null, uniqueFilename(file.originalname));
    }
  }),
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024,
    files: 50
  },
  fileFilter(req, file, cb) {
    if (!isAllowedFile(file)) {
      cb(new Error("Tipo de arquivo nao permitido."));
      return;
    }
    cb(null, true);
  }
});

module.exports = {
  categories,
  blockedExtensions,
  ensureDirectories,
  getCategory,
  sanitizeFilename,
  uniqueFilename,
  withExtension,
  upload
};
