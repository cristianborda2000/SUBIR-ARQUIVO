const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const uploadDir = path.join(rootDir, "uploads");
const dataDir = path.join(rootDir, "data");

module.exports = {
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || "mediadrop-local-secret",
  adminUser: process.env.ADMIN_USER || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 200),
  rootDir,
  uploadDir,
  dataDir,
  dbPath: path.join(dataDir, "mediadrop.sqlite")
};
