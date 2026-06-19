require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const archiver = require("archiver");
const config = require("./config");
const { initDb } = require("./db");
const { categories, getCategory, sanitizeFilename, uniqueFilename, upload, withExtension } = require("./storage");
const { convertToMp4, isMp4File, mp4NameFrom, normalizeVideoFile } = require("./video");
const { downloadYoutubeVideo, isYoutubeUrl } = require("./youtube");
const { deleteYoutubeLink, getYoutubeLink, insertYoutubeLink, listYoutubeLinks } = require("./youtube-links");
const {
  deleteAllFiles: deleteSupabaseFileRows,
  deleteFile: deleteSupabaseFileRow,
  deleteObject: deleteSupabaseObject,
  downloadObject: downloadSupabaseObject,
  getFile: getSupabaseFile,
  insertFileRecord: insertSupabaseFileRecord,
  createSignedUploadUrl,
  isSupabaseFilesEnabled,
  listFiles: listSupabaseFiles,
  uploadObject: uploadSupabaseObject
} = require("./supabase-files");

const app = express();
let db;
const dbReady = initDb()
  .then((database) => {
    db = database;
  });

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: "mediadrop.sid",
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(config.rootDir, "public")));

app.use(async (req, res, next) => {
  try {
    await dbReady;
    next();
  } catch (error) {
    res.status(500).json({ error: `Falha ao iniciar o MediaDrop: ${error.message}` });
  }
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    next();
    return;
  }
  res.status(401).json({ error: "Acesso administrativo necessario." });
}

function publicFile(file) {
  return {
    id: file.id,
    originalName: file.original_name,
    storedName: file.stored_name,
    category: file.category,
    mimeType: file.mime_type,
    size: file.size,
    note: file.note,
    uploadedAt: file.uploaded_at
  };
}

function publicSupabaseFile(file) {
  return {
    id: file.id,
    originalName: file.original_name,
    storedName: file.stored_name,
    category: file.category,
    mimeType: file.mime_type,
    size: Number(file.size || 0),
    note: file.note,
    uploadedAt: file.uploaded_at,
    storage: "supabase"
  };
}

function getFileOr404(id, res) {
  const file = db.get("SELECT * FROM files WHERE id = ?", [id]);
  if (!file) {
    res.status(404).json({ error: "Arquivo nao encontrado." });
    return null;
  }
  return file;
}

function absoluteFilePath(file) {
  return path.join(config.rootDir, file.relative_path);
}

function downloadName(file) {
  if (file.category !== "videos") {
    return sanitizeFilename(file.original_name);
  }

  return mp4NameFrom(file.original_name, file.stored_name).displayName;
}

function parseDisplayNames(value) {
  try {
    const names = JSON.parse(value || "[]");
    return Array.isArray(names) ? names : [];
  } catch (error) {
    return [];
  }
}

function parseYoutubeUrls(body) {
  const raw = String(body.youtubeUrls || body.youtubeUrl || "");
  return raw
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function publicYoutubeLink(link) {
  return {
    id: link.id,
    source: "youtube",
    originalName: link.title,
    storedName: "",
    category: "videos",
    mimeType: "YouTube pendente",
    size: 0,
    note: link.note,
    uploadedAt: link.created_at,
    url: link.url
  };
}

function displayNameForFile(file, displayNames, index) {
  const name = String(displayNames[index] || "").trim();
  return name ? withExtension(name, file.originalname) : file.originalname;
}

function displayNameForDirectFile(originalName, displayName) {
  const name = String(displayName || "").trim();
  return name ? withExtension(name, originalName) : originalName;
}

function insertFileRecord(file, category, note, uploadedAt) {
  const relativePath = path.relative(config.rootDir, file.path).replace(/\\/g, "/");
  const result = db.run(`
    INSERT INTO files (original_name, stored_name, category, mime_type, size, note, relative_path, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    file.originalname,
    file.filename,
    category,
    file.mimetype || "application/octet-stream",
    file.size,
    note,
    relativePath,
    uploadedAt
  ]);

  return {
    id: result.lastInsertRowid,
    originalName: file.originalname,
    category,
    size: file.size
  };
}

async function insertUploadedFileRecord(file, category, note, uploadedAt) {
  if (!isSupabaseFilesEnabled()) {
    return insertFileRecord(file, category, note, uploadedAt);
  }

  const storagePath = `${category}/${file.filename}`;
  await uploadSupabaseObject(storagePath, fs.readFileSync(file.path), file.mimetype || "application/octet-stream");
  const row = await insertSupabaseFileRecord({
    original_name: file.originalname,
    stored_name: file.filename,
    category,
    mime_type: file.mimetype || "application/octet-stream",
    size: file.size,
    note: note || null,
    storage_path: storagePath,
    uploaded_at: uploadedAt
  });

  if (fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }

  return {
    id: row.id,
    originalName: row.original_name,
    category: row.category,
    size: Number(row.size || 0),
    storage: "supabase"
  };
}

async function ensureVideoDownloadIsMp4(file) {
  if (file.category !== "videos") {
    return file;
  }

  const currentPath = absoluteFilePath(file);
  if (!fs.existsSync(currentPath)) {
    return file;
  }

  if (isMp4File(currentPath, file.mime_type)) {
    const names = mp4NameFrom(file.original_name, file.stored_name);
    if (file.original_name !== names.displayName || file.mime_type !== "video/mp4") {
      db.run(`
        UPDATE files
        SET original_name = ?, mime_type = ?
        WHERE id = ?
      `, [names.displayName, "video/mp4", file.id]);
      return { ...file, original_name: names.displayName, mime_type: "video/mp4" };
    }

    return file;
  }

  const names = mp4NameFrom(file.original_name, file.stored_name);
  const outputPath = path.join(path.dirname(currentPath), names.storedName);
  await convertToMp4(currentPath, outputPath);

  const outputSize = fs.statSync(outputPath).size;
  fs.unlinkSync(currentPath);
  const relativePath = path.relative(config.rootDir, outputPath).replace(/\\/g, "/");

  db.run(`
    UPDATE files
    SET original_name = ?, stored_name = ?, mime_type = ?, size = ?, relative_path = ?
    WHERE id = ?
  `, [names.displayName, names.storedName, "video/mp4", outputSize, relativePath, file.id]);

  return {
    ...file,
    original_name: names.displayName,
    stored_name: names.storedName,
    mime_type: "video/mp4",
    size: outputSize,
    relative_path: relativePath
  };
}

async function prepareFilesForDownload(files) {
  const prepared = [];
  for (const file of files) {
    prepared.push(await ensureVideoDownloadIsMp4(file));
  }
  return prepared;
}

async function addFilesToZip(res, files, zipName) {
  res.attachment(zipName);
  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Nao foi possivel gerar o ZIP." });
    }
  });

  archive.pipe(res);
  for (const file of files) {
    if (file.storage_path) {
      const buffer = await downloadSupabaseObject(file.storage_path);
      archive.append(buffer, {
        name: `${file.category}/${sanitizeFilename(file.original_name)}`
      });
      continue;
    }

    const filePath = absoluteFilePath(file);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, {
        name: `${file.category}/${downloadName(file)}`
      });
    }
  }
  archive.finalize();
}

app.post("/api/upload", (req, res) => {
  upload.array("files", 50)(req, res, async (error) => {
    if (error) {
      const maxMessage = `Cada arquivo deve ter no maximo ${config.maxFileSizeMb} MB.`;
      const message = error.code === "LIMIT_FILE_SIZE" ? maxMessage : error.message;
      res.status(400).json({ error: message });
      return;
    }

    const note = String(req.body.note || "").trim().slice(0, 1000);
    const displayNames = parseDisplayNames(req.body.displayNames);
    const youtubeUrl = String(req.body.youtubeUrl || "").trim();
    const youtubeTitle = String(req.body.youtubeTitle || "").trim().slice(0, 120);
    const uploadedAt = new Date().toISOString();
    const saved = [];

    try {
      for (const [index, uploadedFile] of (req.files || []).entries()) {
        const category = getCategory(uploadedFile);
        const renamedFile = {
          ...uploadedFile,
          originalname: displayNameForFile(uploadedFile, displayNames, index)
        };
        const file = category === "videos" ? await normalizeVideoFile(renamedFile) : renamedFile;
        saved.push(await insertUploadedFileRecord(file, category, note, uploadedAt));
      }

      if (youtubeUrl) {
        if (!isYoutubeUrl(youtubeUrl)) {
          res.status(400).json({ error: "Informe um link valido do YouTube." });
          return;
        }

        const title = youtubeTitle || "Video do YouTube";
        const link = await insertYoutubeLink(db, {
          title,
          url: youtubeUrl,
          note,
          createdAt: uploadedAt
        });
        saved.push({
          id: link.id,
          originalName: title,
          category: "videos",
          size: 0,
          source: "youtube"
        });
      }

      res.json({
        message: youtubeUrl ? "Link do YouTube enviado para o admin baixar." : "Envio concluido com sucesso.",
        files: saved
      });
    } catch (conversionError) {
      for (const file of req.files || []) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }

      res.status(500).json({
        error: `Nao foi possivel concluir o envio. ${conversionError.message}`
      });
    }
  });
});

app.post("/api/upload/direct/sign", async (req, res) => {
  if (!isSupabaseFilesEnabled()) {
    res.status(400).json({ error: "Upload direto nao esta ativo. Configure SUPABASE_FILES_ENABLED=1." });
    return;
  }

  const originalName = String(req.body.originalName || "").trim();
  const mimeType = String(req.body.mimeType || "application/octet-stream").trim();
  const size = Number(req.body.size || 0);
  const displayName = String(req.body.displayName || "").trim();
  const category = getCategory({ originalname: originalName, mimetype: mimeType });

  if (!originalName || !size) {
    res.status(400).json({ error: "Arquivo invalido para upload direto." });
    return;
  }

  if (!category) {
    res.status(400).json({ error: "Tipo de arquivo bloqueado." });
    return;
  }

  const finalOriginalName = displayNameForDirectFile(originalName, displayName);
  const storedName = uniqueFilename(finalOriginalName);
  const storagePath = `${category}/${storedName}`;

  try {
    const signed = await createSignedUploadUrl(storagePath);
    res.json({
      ...signed,
      supabaseUrl: config.supabaseUrl,
      bucket: process.env.SUPABASE_STORAGE_BUCKET || "mediadrop-files",
      file: {
        originalName: finalOriginalName,
        storedName,
        category,
        mimeType,
        size,
        storagePath
      }
    });
  } catch (error) {
    res.status(500).json({ error: `Nao foi possivel preparar upload direto. ${error.message}` });
  }
});

app.post("/api/upload/direct/complete", async (req, res) => {
  if (!isSupabaseFilesEnabled()) {
    res.status(400).json({ error: "Upload direto nao esta ativo." });
    return;
  }

  const file = req.body.file || {};
  const note = String(req.body.note || "").trim().slice(0, 1000);

  try {
    const row = await insertSupabaseFileRecord({
      original_name: String(file.originalName || "arquivo"),
      stored_name: String(file.storedName || "arquivo"),
      category: String(file.category || "outros"),
      mime_type: String(file.mimeType || "application/octet-stream"),
      size: Number(file.size || 0),
      note: note || null,
      storage_path: String(file.storagePath || ""),
      uploaded_at: new Date().toISOString()
    });

    res.json({
      message: "Arquivo enviado com sucesso. O administrador ja pode baixar.",
      file: {
        id: row.id,
        originalName: row.original_name,
        category: row.category,
        size: Number(row.size || 0),
        storage: "supabase"
      }
    });
  } catch (error) {
    res.status(500).json({ error: `Upload concluido, mas nao foi possivel registrar o arquivo. ${error.message}` });
  }
});

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const admin = db.get("SELECT * FROM admins WHERE username = ?", [username]);

  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    res.status(401).json({ error: "Usuario ou senha invalidos." });
    return;
  }

  req.session.adminId = admin.id;
  req.session.username = admin.username;
  res.json({ ok: true, username: admin.username });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("mediadrop.sid");
    res.json({ ok: true });
  });
});

app.post("/api/admin/password", requireAdmin, (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const admin = db.get("SELECT * FROM admins WHERE id = ?", [req.session.adminId]);

  if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
    res.status(400).json({ error: "Senha atual incorreta." });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  db.run("UPDATE admins SET password_hash = ? WHERE id = ?", [hash, admin.id]);
  res.json({ ok: true, message: "Senha alterada com sucesso." });
});

app.get("/api/admin/session", (req, res) => {
  res.json({
    authenticated: Boolean(req.session && req.session.adminId),
    username: req.session ? req.session.username : null
  });
});

app.get("/api/admin/files", requireAdmin, async (req, res) => {
  const rows = db.all("SELECT * FROM files ORDER BY uploaded_at DESC, id DESC");
  const supabaseRows = isSupabaseFilesEnabled() ? await listSupabaseFiles() : [];
  const youtubeRows = await listYoutubeLinks(db);
  const grouped = Object.keys(categories).reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});

  rows.forEach((row) => {
    if (!grouped[row.category]) grouped.outros.push(publicFile(row));
    else grouped[row.category].push(publicFile(row));
  });

  supabaseRows.forEach((row) => {
    if (!grouped[row.category]) grouped.outros.push(publicSupabaseFile(row));
    else grouped[row.category].push(publicSupabaseFile(row));
  });

  youtubeRows.forEach((row) => {
    grouped.videos.push(publicYoutubeLink(row));
  });

  res.json({
    categories: Object.entries(categories).map(([key, category]) => ({
      key,
      label: category.label
    })),
    files: grouped
  });
});

app.get("/api/admin/files/:id/download", requireAdmin, async (req, res) => {
  if (isSupabaseFilesEnabled()) {
    const supabaseFile = await getSupabaseFile(req.params.id);
    if (supabaseFile) {
      try {
        const buffer = await downloadSupabaseObject(supabaseFile.storage_path);
        res.setHeader("Content-Type", supabaseFile.mime_type || "application/octet-stream");
        res.attachment(sanitizeFilename(supabaseFile.original_name));
        res.send(buffer);
      } catch (error) {
        res.status(500).json({ error: `Nao foi possivel baixar o arquivo do Supabase. ${error.message}` });
      }
      return;
    }
  }

  const file = getFileOr404(req.params.id, res);
  if (!file) return;

  let preparedFile;
  try {
    preparedFile = await ensureVideoDownloadIsMp4(file);
  } catch (error) {
    res.status(500).json({ error: `Nao foi possivel preparar o video em MP4. ${error.message}` });
    return;
  }

  const filePath = absoluteFilePath(preparedFile);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Arquivo fisico nao encontrado." });
    return;
  }

  res.download(filePath, downloadName(preparedFile));
});

app.post("/api/admin/youtube/:id/download", requireAdmin, async (req, res) => {
  const link = await getYoutubeLink(db, req.params.id);
  if (!link) {
    res.status(404).json({ error: "Link do YouTube nao encontrado." });
    return;
  }

  try {
    const youtubeFile = await downloadYoutubeVideo(link.url, link.title);
    const saved = insertFileRecord(youtubeFile, "videos", link.note || "", new Date().toISOString());
    await deleteYoutubeLink(db, link.id);
    res.json({ ok: true, file: saved, message: "Video baixado em MP4 no computador do admin." });
  } catch (error) {
    res.status(500).json({ error: `Nao foi possivel baixar o video. ${error.message}` });
  }
});

app.delete("/api/admin/youtube/:id", requireAdmin, async (req, res) => {
  const link = await getYoutubeLink(db, req.params.id);
  if (!link) {
    res.status(404).json({ error: "Link do YouTube nao encontrado." });
    return;
  }

  await deleteYoutubeLink(db, link.id);
  res.json({ ok: true });
});

app.delete("/api/admin/files/:id", requireAdmin, async (req, res) => {
  if (isSupabaseFilesEnabled()) {
    try {
      const supabaseFile = await getSupabaseFile(req.params.id);
      if (supabaseFile) {
        await deleteSupabaseObject(supabaseFile.storage_path);
        await deleteSupabaseFileRow(supabaseFile.id);
        res.json({ ok: true });
        return;
      }
    } catch (error) {
      res.status(500).json({ error: `Nao foi possivel apagar o arquivo. ${error.message}` });
      return;
    }
  }

  const file = getFileOr404(req.params.id, res);
  if (!file) return;

  const filePath = absoluteFilePath(file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  db.run("DELETE FROM files WHERE id = ?", [file.id]);
  res.json({ ok: true });
});

app.delete("/api/admin/files", requireAdmin, async (req, res) => {
  const files = db.all("SELECT * FROM files");
  const supabaseRows = isSupabaseFilesEnabled() ? await listSupabaseFiles() : [];
  const youtubeRows = await listYoutubeLinks(db);
  files.forEach((file) => {
    const filePath = absoluteFilePath(file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  db.run("DELETE FROM files");
  for (const file of supabaseRows) {
    await deleteSupabaseObject(file.storage_path).catch(() => null);
  }
  if (supabaseRows.length) {
    await deleteSupabaseFileRows();
  }
  for (const link of youtubeRows) {
    await deleteYoutubeLink(db, link.id);
  }
  res.json({ ok: true, deleted: files.length + supabaseRows.length + youtubeRows.length });
});

app.get("/api/admin/download/category/:category", requireAdmin, async (req, res) => {
  const category = req.params.category;
  if (!categories[category]) {
    res.status(404).json({ error: "Categoria invalida." });
    return;
  }

  try {
    const files = db.all("SELECT * FROM files WHERE category = ? ORDER BY uploaded_at DESC", [category]);
    const supabaseRows = isSupabaseFilesEnabled() ? (await listSupabaseFiles()).filter((file) => file.category === category) : [];
    await addFilesToZip(res, [...await prepareFilesForDownload(files), ...supabaseRows], `mediadrop-${category}.zip`);
  } catch (error) {
    res.status(500).json({ error: `Nao foi possivel preparar os arquivos. ${error.message}` });
  }
});

app.get("/api/admin/download/all", requireAdmin, async (req, res) => {
  try {
    const files = db.all("SELECT * FROM files ORDER BY category, uploaded_at DESC");
    const supabaseRows = isSupabaseFilesEnabled() ? await listSupabaseFiles() : [];
    await addFilesToZip(res, [...await prepareFilesForDownload(files), ...supabaseRows], "mediadrop-todos-arquivos.zip");
  } catch (error) {
    res.status(500).json({ error: `Nao foi possivel preparar os arquivos. ${error.message}` });
  }
});

app.get("/api/admin/desktop-app", requireAdmin, (req, res) => {
  const installerCandidates = [
    path.resolve(config.rootDir, "..", "MediaDrop-Desktop", "dist", "Wichay Admin Setup 1.0.0.exe"),
    path.resolve(config.rootDir, "..", "MediaDrop-Desktop", "dist", "MediaDrop Admin Setup 1.0.0.exe")
  ];
  const installerPath = installerCandidates.find((candidate) => fs.existsSync(candidate));
  if (!installerPath) {
    res.status(404).json({
      error: "Instalador desktop nao encontrado neste servidor. Gere o instalador em MediaDrop-Desktop/dist ou baixe pelo computador onde o projeto foi compilado."
    });
    return;
  }

  res.download(installerPath, "Wichay Admin Setup.exe");
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(config.rootDir, "public", "admin.html"));
});

app.use((req, res) => {
  res.status(404).json({ error: "Rota nao encontrada." });
});

if (require.main === module) {
  dbReady
    .then(() => {
      app.listen(config.port, () => {
        console.log(`MediaDrop rodando em http://localhost:${config.port}`);
      });
    })
    .catch((error) => {
      console.error("Falha ao iniciar o MediaDrop:", error);
      process.exit(1);
    });
}

module.exports = app;
