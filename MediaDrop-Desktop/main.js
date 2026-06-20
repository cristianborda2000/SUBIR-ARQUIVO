const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");

const isDev = !app.isPackaged;
const appRoot = __dirname;
const resourceRoot = app.isPackaged ? process.resourcesPath : appRoot;

function defaultDownloadFolder() {
  return path.join(app.getPath("downloads"), "Wichay");
}

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function defaultConfig() {
  return {
    supabaseUrl: "",
    supabaseServiceRoleKey: "",
    mediaDropUrl: "https://subir-arquivo.vercel.app",
    adminUser: "admin",
    adminPassword: "",
    downloadFolder: defaultDownloadFolder(),
    ttlDays: 7,
    deleteYoutubeAfterDownload: false
  };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readConfig() {
  const localConfig = readJson(configPath());
  const legacyConfig = readJson(path.join(appRoot, "config.json"));
  return { ...defaultConfig(), ...(legacyConfig || {}), ...(localConfig || {}) };
}

function saveConfig(config) {
  const current = readConfig();
  const secretKey = String(config.supabaseServiceRoleKey ?? current.supabaseServiceRoleKey ?? "").replace(/\s+/g, "");
  const next = {
    ...current,
    ...config,
    supabaseUrl: String(config.supabaseUrl ?? current.supabaseUrl ?? "").trim(),
    supabaseServiceRoleKey: secretKey,
    mediaDropUrl: String(config.mediaDropUrl ?? current.mediaDropUrl ?? "").trim().replace(/\/admin\/?$/, "").replace(/\/$/, ""),
    adminUser: String(config.adminUser ?? current.adminUser ?? "").trim(),
    adminPassword: String(config.adminPassword ?? current.adminPassword ?? ""),
    downloadFolder: String(config.downloadFolder ?? current.downloadFolder ?? defaultDownloadFolder()).trim(),
    ttlDays: Number(config.ttlDays ?? current.ttlDays ?? 7),
    deleteYoutubeAfterDownload: Boolean(config.deleteYoutubeAfterDownload)
  };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return safeConfig(next);
}

function safeConfig(config) {
  return {
    ...config,
    hasSupabaseKey: Boolean(config.supabaseServiceRoleKey),
    supabaseServiceRoleKey: config.supabaseServiceRoleKey ? "********" : "",
    hasAdminPassword: Boolean(config.adminPassword),
    adminPassword: config.adminPassword ? "********" : ""
  };
}

function requireSupabaseConfig(config) {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("Configure Supabase URL e Secret Key na engrenagem.");
  }
}

function requireMediaDropConfig(config) {
  if (!config.mediaDropUrl || !config.adminUser || !config.adminPassword) {
    throw new Error("Configure URL do MediaDrop, usuario e senha admin na engrenagem.");
  }
}

function hasSupabaseConfig(config) {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

function hasMediaDropConfig(config) {
  return Boolean(config.mediaDropUrl && config.adminUser && config.adminPassword);
}

function sanitizeName(value) {
  return String(value || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "arquivo";
}

function cutoffDate(ttlDays) {
  const date = new Date();
  date.setDate(date.getDate() - Number(ttlDays || 7));
  return date.toISOString();
}

function requestBuffer(urlValue, options = {}) {
  const body = options.body || "";
  const url = new URL(urlValue);
  const transport = url.protocol === "https:" ? https : http;
  const headers = { ...(options.headers || {}) };
  if (body) headers["Content-Length"] = Buffer.byteLength(body);

  return new Promise((resolve, reject) => {
    const request = transport.request(url, { method: options.method || "GET", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: buffer,
          text: () => buffer.toString("utf8"),
          json: () => JSON.parse(buffer.toString("utf8") || "{}")
        });
      });
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function supabaseRequest(config, resource, options = {}) {
  requireSupabaseConfig(config);
  const body = options.body || "";
  const url = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/${resource}`;
  const response = await requestBuffer(url, {
    method: options.method || "GET",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.text() || `Supabase retornou status ${response.statusCode}.`);
  }
  if (response.statusCode === 204 || !response.body.length) return null;
  return response.json();
}

async function listYoutubeLinks(config) {
  const query = [
    "select=*",
    "status=eq.pending",
    `created_at=gte.${encodeURIComponent(cutoffDate(config.ttlDays))}`,
    "order=created_at.desc"
  ].join("&");
  return supabaseRequest(config, `youtube_links?${query}`);
}

async function updateYoutubeLink(config, id, patch) {
  await supabaseRequest(config, `youtube_links?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch)
  });
}

async function deleteYoutubeLink(config, id) {
  await supabaseRequest(config, `youtube_links?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

async function mediaDropLogin(config) {
  requireMediaDropConfig(config);
  const response = await requestBuffer(`${config.mediaDropUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: config.adminUser, password: config.adminPassword })
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.text() || "Login admin falhou.");
  }

  const cookie = (response.headers["set-cookie"] || []).map((item) => item.split(";")[0]).join("; ");
  if (!cookie) throw new Error("Login admin nao retornou cookie de sessao.");
  return cookie;
}

async function mediaDropJson(config, pathValue) {
  const cookie = await mediaDropLogin(config);
  const response = await requestBuffer(`${config.mediaDropUrl}${pathValue}`, { headers: { Cookie: cookie } });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.text() || `MediaDrop retornou status ${response.statusCode}.`);
  }
  return response.json();
}

async function mediaDropDownload(config, pathValue, outputName, subfolder) {
  const cookie = await mediaDropLogin(config);
  const response = await requestBuffer(`${config.mediaDropUrl}${pathValue}`, { headers: { Cookie: cookie } });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.text() || `Download retornou status ${response.statusCode}.`);
  }

  const folder = path.join(config.downloadFolder || defaultDownloadFolder(), subfolder || "arquivos");
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, sanitizeName(outputName));
  fs.writeFileSync(filePath, response.body);
  return filePath;
}

function toolPath(exeName) {
  const candidates = [
    path.join(resourceRoot, "tools", exeName),
    path.join(appRoot, "tools", exeName),
    path.join(appRoot, "..", "MediaDrop", "tools", exeName),
    path.join(appRoot, "..", "MediaDrop", "node_modules", "ffmpeg-static", exeName)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || exeName.replace(/\.exe$/, "");
}

function mp4NameFrom(value) {
  const parsed = path.parse(sanitizeName(value || "video"));
  return `${parsed.name || "video"}.mp4`;
}

function convertLocalVideoToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = toolPath(process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const args = [
      "-y",
      "-i", inputPath,
      "-map", "0:v:0?",
      "-map", "0:a:0?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      outputPath
    ];
    const child = spawn(ffmpeg, args, { windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => {
      if (error.code === "ENOENT") reject(new Error("ffmpeg nao foi encontrado no aplicativo."));
      else reject(error);
    });
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(output.trim() || `FFmpeg terminou com codigo ${code}.`));
    });
  });
}

function runYtDlp(config, link) {
  return new Promise((resolve, reject) => {
    const outputFolder = path.join(config.downloadFolder || defaultDownloadFolder(), "youtube");
    fs.mkdirSync(outputFolder, { recursive: true });
    const ytDlp = toolPath(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    const ffmpeg = toolPath(process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const outputTemplate = path.join(outputFolder, `${sanitizeName(link.title)}-%(id)s.%(ext)s`);
    const args = [
      "--no-playlist",
      "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "--recode-video", "mp4",
      "-o", outputTemplate
    ];
    if (fs.existsSync(ffmpeg)) args.push("--ffmpeg-location", path.dirname(ffmpeg));
    args.push(link.url);

    const child = spawn(ytDlp, args, { windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => {
      if (error.code === "ENOENT") reject(new Error("yt-dlp nao foi encontrado no aplicativo."));
      else reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output.trim() || `yt-dlp terminou com codigo ${code}.`));
    });
  });
}

async function downloadYoutube(config, id) {
  requireSupabaseConfig(config);
  const links = await listYoutubeLinks(config);
  const link = links.find((item) => String(item.id) === String(id));
  if (!link) throw new Error("Link nao encontrado ou ja baixado.");
  await updateYoutubeLink(config, id, { status: "downloading", error: null });
  try {
    await runYtDlp(config, link);
    if (config.deleteYoutubeAfterDownload) {
      await deleteYoutubeLink(config, id);
    } else {
      await updateYoutubeLink(config, id, {
        status: "downloaded",
        downloaded_at: new Date().toISOString(),
        error: null
      });
    }
    return { ok: true, message: "Video baixado no computador." };
  } catch (error) {
    await updateYoutubeLink(config, id, { status: "error", error: error.message.slice(0, 1000) }).catch(() => null);
    throw error;
  }
}

async function downloadYoutubeItem(config, item) {
  const link = {
    id: item.id,
    title: item.title || item.originalName || "Video do YouTube",
    url: item.url
  };
  if (!link.url) {
    throw new Error("Este link do YouTube nao tem URL para baixar.");
  }

  await runYtDlp(config, link);

  if (hasSupabaseConfig(config)) {
    await updateYoutubeLink(config, link.id, {
      status: "downloaded",
      downloaded_at: new Date().toISOString(),
      error: null
    }).catch(() => null);
  } else if (hasMediaDropConfig(config)) {
    await mediaDropDelete(config, `/api/admin/youtube/${encodeURIComponent(link.id)}`);
  }

  return { ok: true, message: "Video baixado no computador." };
}

async function mediaDropDelete(config, pathValue) {
  const cookie = await mediaDropLogin(config);
  const response = await requestBuffer(`${config.mediaDropUrl}${pathValue}`, {
    method: "DELETE",
    headers: { Cookie: cookie }
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.text() || "Nao foi possivel apagar.");
  }
  return response.body.length ? response.json() : { ok: true };
}

function publicConfig() {
  return safeConfig(readConfig());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Wichay Admin",
    backgroundColor: "#f5f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (isDev && process.argv.includes("--devtools")) win.webContents.openDevTools();
}

ipcMain.handle("config:get", () => publicConfig());
ipcMain.handle("config:save", (_event, config) => saveConfig(config));
ipcMain.handle("config:openFolder", async () => {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  await shell.openPath(path.dirname(configPath()));
  return { ok: true };
});
ipcMain.handle("folder:choose", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("folder:open", async () => {
  const config = readConfig();
  fs.mkdirSync(config.downloadFolder || defaultDownloadFolder(), { recursive: true });
  await shell.openPath(config.downloadFolder || defaultDownloadFolder());
  return { ok: true };
});
ipcMain.handle("admin:openWeb", async () => {
  const config = readConfig();
  if (config.mediaDropUrl) await shell.openExternal(`${config.mediaDropUrl}/admin`);
  return { ok: true };
});
ipcMain.handle("state:load", async () => {
  const config = readConfig();
  const warnings = [];
  let youtube = [];
  let categories = [];
  let files = {};

  if (hasSupabaseConfig(config)) {
    try {
      youtube = await listYoutubeLinks(config);
    } catch (error) {
      warnings.push(`YouTube: ${error.message}`);
    }
  } else {
    warnings.push("YouTube desativado: configure Supabase URL e Secret Key para ver links.");
  }

  if (hasMediaDropConfig(config)) {
    const data = await mediaDropJson(config, "/api/admin/files");
    categories = data.categories || [];
    files = data.files || {};
  } else {
    warnings.push("Arquivos do site desativados: configure URL do MediaDrop, usuario e senha admin.");
  }

  if (!hasSupabaseConfig(config) && !hasMediaDropConfig(config)) {
    throw new Error("Configure pelo menos os dados do MediaDrop na engrenagem.");
  }

  return { youtube, categories, files, warnings, config: publicConfig() };
});
ipcMain.handle("youtube:download", async (_event, id) => downloadYoutube(readConfig(), id));
ipcMain.handle("youtube:downloadItem", async (_event, item) => downloadYoutubeItem(readConfig(), item));
ipcMain.handle("youtube:downloadAll", async () => {
  const config = readConfig();
  requireSupabaseConfig(config);
  const links = await listYoutubeLinks(config);
  let downloaded = 0;
  let errors = 0;
  for (const link of links) {
    try {
      await downloadYoutube(config, link.id);
      downloaded += 1;
    } catch (_error) {
      errors += 1;
    }
  }
  return { ok: true, message: `Concluidos: ${downloaded} | Erros: ${errors}` };
});
ipcMain.handle("youtube:delete", async (_event, id) => {
  await deleteYoutubeLink(readConfig(), id);
  return { ok: true };
});
ipcMain.handle("youtube:deleteItem", async (_event, item) => {
  const config = readConfig();
  if (hasSupabaseConfig(config)) {
    await deleteYoutubeLink(config, item.id).catch(async () => {
      if (hasMediaDropConfig(config)) {
        await mediaDropDelete(config, `/api/admin/youtube/${encodeURIComponent(item.id)}`);
      }
    });
    return { ok: true };
  }
  await mediaDropDelete(config, `/api/admin/youtube/${encodeURIComponent(item.id)}`);
  return { ok: true };
});
ipcMain.handle("file:download", async (_event, file) => {
  const config = readConfig();
  requireMediaDropConfig(config);
  const savedPath = await mediaDropDownload(config, `/api/admin/files/${file.id}/download`, file.originalName, file.category || "arquivos");
  if (file.needsConversion || (file.category === "videos" && path.extname(savedPath).toLowerCase() !== ".mp4")) {
    const outputPath = path.join(path.dirname(savedPath), mp4NameFrom(file.originalName));
    await convertLocalVideoToMp4(savedPath, outputPath);
    fs.unlinkSync(savedPath);
    return { ok: true, path: outputPath, message: "Video baixado e convertido para MP4." };
  }
  return { ok: true, path: savedPath, message: "Arquivo baixado." };
});
ipcMain.handle("category:download", async (_event, category) => {
  const config = readConfig();
  requireMediaDropConfig(config);
  const savedPath = await mediaDropDownload(config, `/api/admin/download/category/${category}`, `mediadrop-${category}.zip`, "zips");
  return { ok: true, path: savedPath, message: "ZIP baixado." };
});
ipcMain.handle("files:downloadAll", async () => {
  const config = readConfig();
  requireMediaDropConfig(config);
  const savedPath = await mediaDropDownload(config, "/api/admin/download/all", "mediadrop-todos-arquivos.zip", "zips");
  return { ok: true, path: savedPath, message: "ZIP com todos os arquivos baixado." };
});
ipcMain.handle("file:delete", async (_event, id) => {
  const config = readConfig();
  requireMediaDropConfig(config);
  return mediaDropDelete(config, `/api/admin/files/${encodeURIComponent(id)}`);
});
ipcMain.handle("all:delete", async () => {
  const config = readConfig();
  requireMediaDropConfig(config);
  try {
    const cookie = await mediaDropLogin(config);
    const response = await requestBuffer(`${config.mediaDropUrl}/api/admin/delete-all`, {
      method: "POST",
      headers: { Cookie: cookie }
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(response.text() || "Nao foi possivel apagar tudo.");
    }
    return response.body.length ? response.json() : { ok: true };
  } catch (_error) {
    return mediaDropDelete(config, "/api/admin/files");
  }
});
ipcMain.handle("all:deleteItems", async (_event, items = {}) => {
  const config = readConfig();
  requireMediaDropConfig(config);
  const files = Array.isArray(items.files) ? items.files : [];
  const youtube = Array.isArray(items.youtube) ? items.youtube : [];
  let deleted = 0;
  const errors = [];

  for (const file of files) {
    try {
      await mediaDropDelete(config, `/api/admin/files/${encodeURIComponent(file.id)}`);
      deleted += 1;
    } catch (error) {
      errors.push(`${file.originalName || file.id}: ${error.message}`);
    }
  }

  for (const item of youtube) {
    try {
      if (hasSupabaseConfig(config)) {
        await deleteYoutubeLink(config, item.id).catch(async () => {
          await mediaDropDelete(config, `/api/admin/youtube/${encodeURIComponent(item.id)}`);
        });
      } else {
        await mediaDropDelete(config, `/api/admin/youtube/${encodeURIComponent(item.id)}`);
      }
      deleted += 1;
    } catch (error) {
      errors.push(`${item.title || item.originalName || item.id}: ${error.message}`);
    }
  }

  if (errors.length) {
    throw new Error(`Apagados: ${deleted}. Erros: ${errors.slice(0, 3).join(" | ")}`);
  }
  return { ok: true, deleted, message: `${deleted} item(ns) apagado(s).` };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
