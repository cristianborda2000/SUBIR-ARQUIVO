#!/usr/bin/env node

const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const appDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const configPath = path.join(appDir, "config.json");
const examplePath = path.join(appDir, "config.example.json");

function readConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Arquivo config.json nao encontrado. Copie ${path.basename(examplePath)} para config.json e preencha as chaves.`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("Preencha supabaseUrl e supabaseServiceRoleKey no config.json.");
  }

  return {
    downloadFolder: "downloads",
    ttlDays: 7,
    deleteAfterDownload: false,
    ...config
  };
}

function sanitizeName(value) {
  return String(value || "youtube-video")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "youtube-video";
}

function cutoffDate(ttlDays) {
  const date = new Date();
  date.setDate(date.getDate() - Number(ttlDays || 7));
  return date.toISOString();
}

async function supabaseRequest(config, resource, options = {}) {
  const baseUrl = config.supabaseUrl.replace(/\/$/, "");
  const body = options.body || "";
  const url = new URL(`${baseUrl}/rest/v1/${resource}`);
  const headers = {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (body) {
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method || "GET",
      headers
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(text || `Supabase retornou status ${response.statusCode}.`));
          return;
        }

        if (response.statusCode === 204 || !text) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(new Error(`Resposta invalida do Supabase: ${error.message}`));
        }
      });
    });

    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function listPending(config) {
  const query = [
    "select=*",
    "status=eq.pending",
    `created_at=gte.${encodeURIComponent(cutoffDate(config.ttlDays))}`,
    "order=created_at.asc"
  ].join("&");
  return supabaseRequest(config, `youtube_links?${query}`);
}

async function updateLink(config, id, patch) {
  await supabaseRequest(config, `youtube_links?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch)
  });
}

async function deleteLink(config, id) {
  await supabaseRequest(config, `youtube_links?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function htmlPage() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MediaDrop Downloader</title>
  <style>
    :root { font-family: Segoe UI, Arial, sans-serif; color: #172033; background: #f5f7fb; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { width: min(1100px, calc(100% - 28px)); margin: 0 auto; padding: 28px 0; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 2rem; }
    .meta { color: #667085; }
    .toolbar, .card { border: 1px solid #d9e1ec; background: white; border-radius: 8px; box-shadow: 0 14px 40px rgba(23,32,51,.08); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 14px; margin-bottom: 16px; }
    button, a.button { min-height: 40px; border: 0; border-radius: 8px; padding: 0 14px; background: #2563eb; color: white; font-weight: 800; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    button.secondary, a.secondary { border: 1px solid #d9e1ec; background: white; color: #172033; }
    button.danger { background: #dc2626; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .status { font-weight: 800; min-height: 24px; }
    .list { display: grid; gap: 10px; }
    .card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 14px; align-items: center; }
    .title { font-weight: 900; overflow-wrap: anywhere; }
    .url { color: #667085; font-size: .9rem; overflow-wrap: anywhere; margin-top: 4px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .empty { padding: 24px; text-align: center; color: #667085; }
    @media (max-width: 720px) { .card { grid-template-columns: 1fr; } .actions, button, a.button { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>MediaDrop Downloader</h1>
        <div class="meta">Painel local para baixar manualmente os links pendentes neste computador.</div>
      </div>
    </header>
    <section class="toolbar">
      <button id="refresh">Buscar links</button>
      <button id="downloadAll" class="secondary">Baixar todos</button>
      <span id="status" class="status"></span>
    </section>
    <section id="list" class="list"></section>
  </main>
  <script>
    const list = document.querySelector("#list");
    const statusBox = document.querySelector("#status");
    const refreshButton = document.querySelector("#refresh");
    const downloadAllButton = document.querySelector("#downloadAll");
    function setStatus(message) { statusBox.textContent = message || ""; }
    async function api(url, options = {}) {
      const response = await fetch(url, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Operacao nao concluida.");
      return body;
    }
    function render(items) {
      list.innerHTML = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "empty card";
        empty.textContent = "Nenhum link pendente encontrado.";
        list.appendChild(empty);
        return;
      }
      items.forEach((item) => {
        const card = document.createElement("article");
        card.className = "card";
        const info = document.createElement("div");
        const title = document.createElement("div");
        title.className = "title";
        title.textContent = item.title;
        const url = document.createElement("div");
        url.className = "url";
        url.textContent = item.url;
        info.append(title, url);
        const actions = document.createElement("div");
        actions.className = "actions";
        const download = document.createElement("button");
        download.textContent = "Baixar";
        download.addEventListener("click", () => downloadOne(item.id, download));
        const remove = document.createElement("button");
        remove.className = "danger";
        remove.textContent = "Apagar";
        remove.addEventListener("click", () => deleteOne(item.id));
        actions.append(download, remove);
        card.append(info, actions);
        list.appendChild(card);
      });
    }
    async function load() {
      setStatus("Buscando...");
      try {
        const data = await api("/api/links");
        render(data.links);
        setStatus(data.links.length + " link(s) pendente(s).");
      } catch (error) {
        setStatus(error.message);
      }
    }
    async function downloadOne(id, button) {
      button.disabled = true;
      button.textContent = "Baixando...";
      setStatus("Baixando video...");
      try {
        await api("/api/download/" + encodeURIComponent(id), { method: "POST" });
        setStatus("Download concluido.");
        await load();
      } catch (error) {
        setStatus(error.message);
        button.disabled = false;
        button.textContent = "Baixar";
      }
    }
    async function deleteOne(id) {
      if (!confirm("Apagar este link pendente?")) return;
      setStatus("Apagando...");
      try {
        await api("/api/delete/" + encodeURIComponent(id), { method: "POST" });
        await load();
      } catch (error) {
        setStatus(error.message);
      }
    }
    async function downloadAll() {
      if (!confirm("Baixar todos os links pendentes agora?")) return;
      refreshButton.disabled = true;
      downloadAllButton.disabled = true;
      setStatus("Baixando todos...");
      try {
        const result = await api("/api/download-all", { method: "POST" });
        setStatus("Concluidos: " + result.downloaded + " | Erros: " + result.errors);
        await load();
      } catch (error) {
        setStatus(error.message);
      } finally {
        refreshButton.disabled = false;
        downloadAllButton.disabled = false;
      }
    }
    refreshButton.addEventListener("click", load);
    downloadAllButton.addEventListener("click", downloadAll);
    load();
  </script>
</body>
</html>`;
}

function openBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

function findYtDlp() {
  const exeName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const candidates = [
    path.join(appDir, "tools", exeName),
    path.join(appDir, exeName),
    path.join(appDir, "..", "MediaDrop", "tools", exeName),
    "yt-dlp"
  ];

  return candidates.find((candidate) => candidate === "yt-dlp" || fs.existsSync(candidate)) || "yt-dlp";
}

function findFfmpegDirectory() {
  const exeName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    path.join(appDir, "tools", exeName),
    path.join(appDir, "..", "MediaDrop", "node_modules", "ffmpeg-static", exeName)
  ];
  const ffmpegPath = candidates.find((candidate) => fs.existsSync(candidate));
  return ffmpegPath ? path.dirname(ffmpegPath) : null;
}

function runYtDlp(link, outputFolder) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outputFolder, { recursive: true });

    const outputTemplate = path.join(outputFolder, `${sanitizeName(link.title)}-%(id)s.%(ext)s`);
    const args = [
      "--no-playlist",
      "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "--recode-video", "mp4",
      "-o", outputTemplate,
    ];
    const ffmpegDirectory = findFfmpegDirectory();

    if (ffmpegDirectory) {
      args.push("--ffmpeg-location", ffmpegDirectory);
    }

    args.push(link.url);

    const child = spawn(findYtDlp(), args, {
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error("yt-dlp nao foi encontrado. Coloque yt-dlp.exe na pasta tools ou instale no PATH."));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`yt-dlp terminou com codigo ${code}.`));
    });
  });
}

async function downloadLink(config, link, downloadFolder) {
  await updateLink(config, link.id, { status: "downloading", error: null });
  await runYtDlp(link, downloadFolder);

  if (config.deleteAfterDownload) {
    await deleteLink(config, link.id);
    return;
  }

  await updateLink(config, link.id, {
    status: "downloaded",
    downloaded_at: new Date().toISOString(),
    error: null
  });
}

async function runOnce() {
  const config = readConfig();
  const downloadFolder = path.resolve(appDir, config.downloadFolder);
  const links = await listPending(config);

  if (!links.length) {
    console.log("Nenhum link pendente encontrado.");
    return;
  }

  console.log(`${links.length} link(s) pendente(s) encontrado(s).`);

  for (const link of links) {
    console.log(`\nBaixando: ${link.title}`);
    try {
      await downloadLink(config, link, downloadFolder);
      console.log(`Concluido: ${link.title}`);
    } catch (error) {
      await updateLink(config, link.id, {
        status: "error",
        error: error.message.slice(0, 1000)
      }).catch(() => null);
      console.error(`Erro em "${link.title}": ${error.message}`);
    }
  }
}

function startPanel() {
  const config = readConfig();
  const downloadFolder = path.resolve(appDir, config.downloadFolder);
  let busy = false;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        const body = htmlPage();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/links") {
        const links = await listPending(config);
        sendJson(res, 200, { links });
        return;
      }

      const downloadMatch = url.pathname.match(/^\/api\/download\/(.+)$/);
      if (req.method === "POST" && downloadMatch) {
        if (busy) {
          sendJson(res, 409, { error: "Ja existe um download em andamento." });
          return;
        }
        busy = true;
        try {
          const id = decodeURIComponent(downloadMatch[1]);
          const links = await listPending(config);
          const link = links.find((item) => String(item.id) === id);
          if (!link) {
            sendJson(res, 404, { error: "Link nao encontrado ou nao esta pendente." });
            return;
          }
          await downloadLink(config, link, downloadFolder);
          sendJson(res, 200, { ok: true });
        } finally {
          busy = false;
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/download-all") {
        if (busy) {
          sendJson(res, 409, { error: "Ja existe um download em andamento." });
          return;
        }
        busy = true;
        let downloaded = 0;
        let errors = 0;
        try {
          const links = await listPending(config);
          for (const link of links) {
            try {
              await downloadLink(config, link, downloadFolder);
              downloaded += 1;
            } catch (error) {
              errors += 1;
              await updateLink(config, link.id, {
                status: "error",
                error: error.message.slice(0, 1000)
              }).catch(() => null);
            }
          }
          sendJson(res, 200, { ok: true, downloaded, errors });
        } finally {
          busy = false;
        }
        return;
      }

      const deleteMatch = url.pathname.match(/^\/api\/delete\/(.+)$/);
      if (req.method === "POST" && deleteMatch) {
        await deleteLink(config, decodeURIComponent(deleteMatch[1]));
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: "Rota nao encontrada." });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    console.log(`MediaDrop Downloader aberto em ${url}`);
    openBrowser(url);
  });
}

if (process.argv.includes("--once")) {
  runOnce().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else {
  try {
    startPanel();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
