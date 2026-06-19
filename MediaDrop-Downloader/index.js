#!/usr/bin/env node

const fs = require("fs");
const https = require("https");
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

async function main() {
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
      await updateLink(config, link.id, { status: "downloading", error: null });
      await runYtDlp(link, downloadFolder);

      if (config.deleteAfterDownload) {
        await deleteLink(config, link.id);
      } else {
        await updateLink(config, link.id, {
          status: "downloaded",
          downloaded_at: new Date().toISOString(),
          error: null
        });
      }

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

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
