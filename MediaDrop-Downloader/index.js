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
    mediaDropUrl: "",
    adminUser: "",
    adminPassword: "",
    localPort: 37417,
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

function httpRequest(urlValue, options = {}) {
  const body = options.body || "";
  const url = new URL(urlValue);
  const transport = url.protocol === "https:" ? https : http;
  const headers = {
    ...(options.headers || {})
  };

  if (body) {
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: options.method || "GET",
      headers
    }, (response) => {
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

function mediaDropBaseUrl(config) {
  return String(config.mediaDropUrl || config.adminUrl || "").replace(/\/admin\/?$/, "").replace(/\/$/, "");
}

async function mediaDropLogin(config) {
  const baseUrl = mediaDropBaseUrl(config);
  if (!baseUrl || !config.adminUser || !config.adminPassword) {
    throw new Error("Configure mediaDropUrl, adminUser e adminPassword no config.json para baixar arquivos do sistema web.");
  }

  const response = await httpRequest(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: config.adminUser,
      password: config.adminPassword
    })
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.text() || "Login admin falhou.");
  }

  const setCookie = response.headers["set-cookie"] || [];
  const cookie = setCookie.map((item) => item.split(";")[0]).join("; ");
  if (!cookie) {
    throw new Error("Login admin nao retornou cookie de sessao.");
  }
  return { baseUrl, cookie };
}

async function mediaDropJson(config, pathValue) {
  const { baseUrl, cookie } = await mediaDropLogin(config);
  const response = await httpRequest(`${baseUrl}${pathValue}`, {
    headers: { Cookie: cookie }
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.text() || `MediaDrop retornou status ${response.statusCode}.`);
  }

  return response.json();
}

async function mediaDropDownload(config, pathValue, outputName) {
  const { baseUrl, cookie } = await mediaDropLogin(config);
  const response = await httpRequest(`${baseUrl}${pathValue}`, {
    headers: { Cookie: cookie }
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.text() || `Download retornou status ${response.statusCode}.`);
  }

  const folder = path.resolve(appDir, config.downloadFolder, "mediadrop");
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, sanitizeName(outputName));
  fs.writeFileSync(filePath, response.body);
  return filePath;
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
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
    :root { font-family: Inter, Segoe UI, Arial, sans-serif; color: #172033; background: #f5f7fb; --line:#d9e1ec; --muted:#667085; --primary:#2563eb; --danger:#dc2626; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(135deg, #eefdfc, #f5f7fb 48%, #eef4ff); }
    main { width: min(1400px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0; }
    .topbar, .head { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 34px; }
    .brand { display:flex; align-items:center; gap:12px; font-weight:900; }
    .brand-mark { display:grid; place-items:center; width:42px; height:42px; border-radius:8px; color:white; background:linear-gradient(135deg,#2563eb,#14b8a6); }
    h1 { margin: 0 0 12px; font-size: 2.55rem; }
    h2 { margin:0; font-size:1.5rem; }
    .meta { color: var(--muted); }
    .actions, .tabs { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
    button, a.button { min-height: 44px; border: 0; border-radius: 8px; padding: 0 18px; background: var(--primary); color: white; font-weight: 800; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    button.secondary, a.secondary { border: 1px solid var(--line); background: white; color: #172033; }
    button.danger { background: var(--danger); }
    button.small { min-height:36px; padding:0 12px; font-size:.9rem; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .status { font-weight: 800; min-height: 24px; }
    .tabs { margin-bottom: 28px; }
    .tab { border:1px solid var(--line); color:var(--muted); background:white; }
    .tab.active { border-color:var(--primary); color:var(--primary); background:#e8f0ff; }
    .panel { border: 1px solid var(--line); background: rgba(255,255,255,.9); border-radius: 8px; box-shadow: 0 18px 50px rgba(23,32,51,.12); padding: 24px; }
    .panel-head { display:flex; justify-content:space-between; gap:14px; align-items:center; margin-bottom:18px; }
    .list { display: grid; gap: 10px; }
    .card { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(130px,.4fr) auto; gap: 12px; padding: 14px; align-items: center; border:1px solid var(--line); border-radius:8px; background:white; }
    .title { font-weight: 900; overflow-wrap: anywhere; }
    .url { color: var(--muted); font-size: .9rem; overflow-wrap: anywhere; margin-top: 4px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .empty { padding: 24px; color: var(--muted); }
    @media (max-width: 820px) { main{width:min(100% - 16px,1400px); padding:16px 0;} .topbar,.head,.panel-head{align-items:stretch; flex-direction:column;} .card { grid-template-columns: 1fr; } .actions, button, a.button { width: 100%; } h1{font-size:2rem;} }
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <div class="brand"><span class="brand-mark">MD</span><span>MediaDrop Downloader</span></div>
      <a class="button secondary" id="adminLink" href="#" target="_blank">Painel admin web</a>
    </header>
    <section class="head">
      <div>
        <h1>Downloads locais</h1>
        <div class="meta">Baixe links do YouTube e arquivos do MediaDrop neste computador.</div>
      </div>
      <div class="actions">
        <button id="refresh">Atualizar</button>
        <button id="downloadAll" class="secondary">Baixar tudo</button>
        <span id="status" class="status"></span>
      </div>
    </section>
    <nav id="tabs" class="tabs"></nav>
    <section class="panel">
      <div class="panel-head">
        <div><h2 id="panelTitle">YouTube</h2><div id="panelMeta" class="meta"></div></div>
      </div>
      <div id="list" class="list"></div>
    </section>
  </main>
  <script>
    const list = document.querySelector("#list");
    const tabs = document.querySelector("#tabs");
    const statusBox = document.querySelector("#status");
    const panelTitle = document.querySelector("#panelTitle");
    const panelMeta = document.querySelector("#panelMeta");
    const refreshButton = document.querySelector("#refresh");
    const downloadAllButton = document.querySelector("#downloadAll");
    const adminLink = document.querySelector("#adminLink");
    let state = { active: "youtube", youtube: [], categories: [], files: {}, adminUrl: "" };
    function setStatus(message) { statusBox.textContent = message || ""; }
    async function api(url, options = {}) {
      try {
        const response = await fetch(url, options);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Operacao nao concluida.");
        return body;
      } catch (error) {
        if (error instanceof TypeError) {
          throw new Error("Nao foi possivel conectar ao app local. Feche esta aba, abra o executavel novamente e tente outra vez.");
        }
        throw error;
      }
    }
    function formatSize(bytes) {
      if (!bytes) return "-";
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
      return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
    }
    function tabItems() {
      const items = [{ key: "youtube", label: "YouTube", count: state.youtube.length }];
      state.categories.forEach((category) => items.push({ key: category.key, label: category.label, count: (state.files[category.key] || []).length }));
      return items;
    }
    function renderTabs() {
      tabs.innerHTML = "";
      tabItems().forEach((item) => {
        const button = document.createElement("button");
        button.className = "tab " + (state.active === item.key ? "active" : "");
        button.textContent = item.label + " (" + item.count + ")";
        button.addEventListener("click", () => { state.active = item.key; render(); });
        tabs.appendChild(button);
      });
    }
    function currentItems() {
      return state.active === "youtube" ? state.youtube : (state.files[state.active] || []);
    }
    function render() {
      renderTabs();
      const items = currentItems();
      const activeTab = tabItems().find((item) => item.key === state.active);
      panelTitle.textContent = activeTab ? activeTab.label : "Arquivos";
      panelMeta.textContent = items.length + " item(ns)";
      list.innerHTML = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = state.active === "youtube" ? "Nenhum link pendente encontrado." : "Nenhum arquivo nesta categoria.";
        list.appendChild(empty);
        return;
      }
      items.forEach((item) => {
        const card = document.createElement("article");
        card.className = "card";
        const info = document.createElement("div");
        const title = document.createElement("div");
        title.className = "title";
        title.textContent = state.active === "youtube" ? item.title : item.originalName;
        const url = document.createElement("div");
        url.className = "url";
        url.textContent = state.active === "youtube" ? item.url : (item.mimeType || "");
        info.append(title, url);
        const size = document.createElement("div");
        size.className = "meta";
        size.textContent = state.active === "youtube" ? "Pendente" : formatSize(item.size);
        const actions = document.createElement("div");
        actions.className = "actions";
        const download = document.createElement("button");
        download.className = "small secondary";
        download.textContent = "Baixar";
        download.addEventListener("click", () => state.active === "youtube" ? downloadYoutube(item.id, download) : downloadFile(item.id, item.originalName, download));
        actions.append(download);
        if (state.active === "youtube") {
          const remove = document.createElement("button");
          remove.className = "small danger";
          remove.textContent = "Apagar";
          remove.addEventListener("click", () => deleteOne(item.id));
          actions.append(remove);
        }
        card.append(info, size, actions);
        list.appendChild(card);
      });
    }
    async function load() {
      setStatus("Buscando...");
      try {
        const data = await api("/api/state");
        state.youtube = data.youtube || [];
        state.categories = data.categories || [];
        state.files = data.files || {};
        state.adminUrl = data.adminUrl || "";
        if (state.adminUrl) adminLink.href = state.adminUrl;
        render();
        setStatus("Atualizado.");
      } catch (error) {
        setStatus(error.message);
      }
    }
    async function waitJob(id) {
      for (;;) {
        const job = await api("/api/job/" + encodeURIComponent(id));
        setStatus(job.message || job.status);
        if (job.status === "done") return job;
        if (job.status === "error") throw new Error(job.error || "Falha no download.");
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
    async function downloadYoutube(id, button) {
      button.disabled = true;
      button.textContent = "Baixando...";
      setStatus("Baixando video...");
      try {
        const job = await api("/api/download/" + encodeURIComponent(id), { method: "POST" });
        await waitJob(job.id);
        setStatus("Download concluido.");
        await load();
      } catch (error) {
        setStatus(error.message);
        button.disabled = false;
        button.textContent = "Baixar";
      }
    }
    async function downloadFile(id, name, button) {
      button.disabled = true;
      button.textContent = "Baixando...";
      try {
        const job = await api("/api/file/" + encodeURIComponent(id), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        });
        await waitJob(job.id);
        setStatus("Arquivo baixado.");
      } catch (error) {
        setStatus(error.message);
      } finally {
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
        const endpoint = state.active === "youtube" ? "/api/download-all" : "/api/category/" + encodeURIComponent(state.active);
        const job = await api(endpoint, { method: "POST" });
        const result = await waitJob(job.id);
        setStatus(result.message || "Concluido.");
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
  const jobs = new Map();

  function createJob(message, task) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const job = { id, status: "running", message };
    jobs.set(id, job);
    Promise.resolve()
      .then(task)
      .then((result = {}) => {
        jobs.set(id, { ...job, ...result, status: "done", message: result.message || "Concluido." });
      })
      .catch((error) => {
        jobs.set(id, { ...job, status: "error", error: error.message, message: error.message });
      });
    return job;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");

      if (req.method === "OPTIONS") {
        sendJson(res, 204, {});
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        const body = htmlPage();
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        });
        res.end(body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        const youtube = await listPending(config);
        let categories = [];
        let files = {};
        let adminUrl = "";
        try {
          const baseUrl = mediaDropBaseUrl(config);
          adminUrl = baseUrl ? `${baseUrl}/admin` : "";
          const data = await mediaDropJson(config, "/api/admin/files");
          categories = data.categories || [];
          files = data.files || {};
        } catch (error) {
          categories = [];
          files = {};
        }
        sendJson(res, 200, { youtube, categories, files, adminUrl });
        return;
      }

      const jobMatch = url.pathname.match(/^\/api\/job\/(.+)$/);
      if (req.method === "GET" && jobMatch) {
        const job = jobs.get(decodeURIComponent(jobMatch[1]));
        if (!job) {
          sendJson(res, 404, { error: "Tarefa nao encontrada." });
          return;
        }
        sendJson(res, 200, job);
        return;
      }

      const downloadMatch = url.pathname.match(/^\/api\/download\/(.+)$/);
      if (req.method === "POST" && downloadMatch) {
        if (busy) {
          sendJson(res, 409, { error: "Ja existe um download em andamento." });
          return;
        }
        const job = createJob("Baixando video...", async () => {
          busy = true;
          try {
            const id = decodeURIComponent(downloadMatch[1]);
            const links = await listPending(config);
            const link = links.find((item) => String(item.id) === id);
            if (!link) {
              throw new Error("Link nao encontrado ou nao esta pendente.");
            }
            await downloadLink(config, link, downloadFolder);
            return { message: "Video baixado." };
          } finally {
            busy = false;
          }
        });
        sendJson(res, 202, job);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/download-all") {
        if (busy) {
          sendJson(res, 409, { error: "Ja existe um download em andamento." });
          return;
        }
        const job = createJob("Baixando todos os videos...", async () => {
          busy = true;
          try {
            let downloaded = 0;
            let errors = 0;
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
            return { downloaded, errors, message: `Concluidos: ${downloaded} | Erros: ${errors}` };
          } finally {
            busy = false;
          }
        });
        sendJson(res, 202, job);
        return;
      }

      const fileMatch = url.pathname.match(/^\/api\/file\/(.+)$/);
      if (req.method === "POST" && fileMatch) {
        if (busy) {
          sendJson(res, 409, { error: "Ja existe um download em andamento." });
          return;
        }
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        await new Promise((resolve) => req.on("end", resolve));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const id = decodeURIComponent(fileMatch[1]);
        const job = createJob("Baixando arquivo...", async () => {
          busy = true;
          try {
            const savedPath = await mediaDropDownload(config, `/api/admin/files/${id}/download`, body.name || `arquivo-${id}`);
            return { path: savedPath, message: "Arquivo baixado." };
          } finally {
            busy = false;
          }
        });
        sendJson(res, 202, job);
        return;
      }

      const categoryMatch = url.pathname.match(/^\/api\/category\/(.+)$/);
      if (req.method === "POST" && categoryMatch) {
        if (busy) {
          sendJson(res, 409, { error: "Ja existe um download em andamento." });
          return;
        }
        const category = decodeURIComponent(categoryMatch[1]);
        const job = createJob("Baixando ZIP...", async () => {
          busy = true;
          try {
            const savedPath = await mediaDropDownload(config, `/api/admin/download/category/${category}`, `mediadrop-${category}.zip`);
            return { path: savedPath, message: "ZIP baixado." };
          } finally {
            busy = false;
          }
        });
        sendJson(res, 202, job);
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

  server.listen(Number(config.localPort || 37417), "127.0.0.1", () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    console.log(`MediaDrop Downloader aberto em ${url}`);
    openBrowser(url);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`A porta local ${config.localPort} ja esta em uso. Feche outro MediaDrop Downloader aberto e tente novamente.`);
      return;
    }
    console.error(error.message);
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
