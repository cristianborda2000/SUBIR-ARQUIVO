const path = require("path");
const os = require("os");

const rootDir = path.resolve(__dirname, "..");
const runtimeDir = process.env.VERCEL ? path.join(os.tmpdir(), "mediadrop") : rootDir;
const uploadDir = path.join(runtimeDir, "uploads");
const dataDir = path.join(runtimeDir, "data");

module.exports = {
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || "mediadrop-local-secret",
  adminUser: process.env.ADMIN_USER || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 200),
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  youtubeLinkTtlDays: Number(process.env.YOUTUBE_LINK_TTL_DAYS || 7),
  rootDir,
  uploadDir,
  dataDir,
  dbPath: path.join(dataDir, "mediadrop.sqlite")
};
