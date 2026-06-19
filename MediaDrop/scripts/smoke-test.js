const { spawn } = require("child_process");

const port = process.env.PORT || "3100";
const baseUrl = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: port,
      ADMIN_USER: "admin",
      ADMIN_PASSWORD: "admin123",
      SESSION_SECRET: "smoke-test-secret"
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
    form.append("files", new Blob(["Teste MediaDrop"], { type: "text/plain" }), "smoke-test.txt");
    form.append("displayNames", JSON.stringify(["arquivo-renomeado.txt"]));
    form.append("note", "Smoke test");

    const upload = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form
    });
    if (!upload.ok) {
      throw new Error(`Upload falhou: ${upload.status} ${await upload.text()}`);
    }

    const youtubeForm = new FormData();
    youtubeForm.append("youtubeUrl", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    youtubeForm.append("youtubeTitle", "YouTube pendente");

    const youtubeUpload = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: youtubeForm
    });
    if (!youtubeUpload.ok) {
      throw new Error(`Envio de link YouTube falhou: ${youtubeUpload.status} ${await youtubeUpload.text()}`);
    }

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" })
    });
    if (!login.ok) {
      throw new Error(`Login falhou: ${login.status} ${await login.text()}`);
    }

    const cookie = login.headers.get("set-cookie").split(";")[0];
    const files = await fetch(`${baseUrl}/api/admin/files`, {
      headers: { Cookie: cookie }
    });
    if (!files.ok) {
      throw new Error(`Listagem falhou: ${files.status} ${await files.text()}`);
    }

    const body = await files.json();
    const found = body.files.documentos.some((file) => file.originalName === "arquivo-renomeado.txt");
    if (!found) {
      throw new Error("Arquivo de teste nao apareceu na categoria documentos.");
    }

    const youtubeFound = body.files.videos.some((file) => file.source === "youtube" && file.originalName === "YouTube pendente");
    if (!youtubeFound) {
      throw new Error("Link de YouTube nao apareceu como pendente na categoria videos.");
    }

    console.log("Smoke test OK: upload, login e listagem funcionando.");
  } catch (error) {
    console.error(output);
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    child.kill();
  }
}

main();
