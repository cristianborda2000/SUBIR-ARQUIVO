const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const ffmpeg = require("ffmpeg-static");

const port = process.env.PORT || "3101";
const baseUrl = `http://127.0.0.1:${port}`;
const tempDir = path.join(process.cwd(), "tmp-test");
const webmPath = path.join(tempDir, "video-teste.webm");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWebm() {
  fs.mkdirSync(tempDir, { recursive: true });
  const result = spawnSync(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=size=160x120:rate=12",
    "-t", "1",
    "-c:v", "libvpx-vp9",
    webmPath
  ], { stdio: "pipe" });

  if (result.status !== 0) {
    throw new Error(result.stderr.toString() || "Nao foi possivel criar video WebM de teste.");
  }
}

async function waitForServer(child) {
  for (let i = 0; i < 30; i += 1) {
    if (child.exitCode !== null) {
      throw new Error("Servidor encerrou antes de responder.");
    }

    try {
      const response = await fetch(`${baseUrl}/api/admin/session`);
      if (response.ok) return;
    } catch (error) {
      await wait(300);
    }
  }

  throw new Error("Servidor nao respondeu a tempo.");
}

async function main() {
  createWebm();

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: port,
      ADMIN_USER: "admin",
      ADMIN_PASSWORD: "admin123",
      SESSION_SECRET: "video-test-secret"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForServer(child);

    const form = new FormData();
    form.append("files", new Blob([fs.readFileSync(webmPath)], { type: "video/webm" }), "video-teste.webm");

    const upload = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form
    });
    if (!upload.ok) {
      throw new Error(`Upload de video falhou: ${upload.status} ${await upload.text()}`);
    }

    const uploadBody = await upload.json();
    const uploadedName = uploadBody.files[0].originalName;
    if (uploadedName !== "video-teste.mp4") {
      throw new Error(`Nome convertido inesperado: ${uploadedName}`);
    }

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const files = await fetch(`${baseUrl}/api/admin/files`, {
      headers: { Cookie: cookie }
    });
    const body = await files.json();
    const found = body.files.videos.some((file) => file.originalName === "video-teste.mp4" && file.mimeType === "video/mp4");
    if (!found) {
      throw new Error("Video convertido nao apareceu como MP4 no painel.");
    }

    console.log("Video conversion OK: WebM enviado e salvo como MP4.");
  } catch (error) {
    console.error(output);
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    child.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
