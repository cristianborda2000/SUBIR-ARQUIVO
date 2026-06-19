const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const sourceDir = path.join(__dirname, "payload");
const installDir = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE, "MediaDrop Downloader");
const desktopDir = path.join(process.env.USERPROFILE, "Desktop");

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function createShortcut(name, target, workingDirectory) {
  const shortcutPath = path.join(desktopDir, `${name}.lnk`);
  const command = [
    "$shell = New-Object -ComObject WScript.Shell",
    `$shortcut = $shell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')`,
    `$shortcut.TargetPath = '${target.replace(/'/g, "''")}'`,
    `$shortcut.WorkingDirectory = '${workingDirectory.replace(/'/g, "''")}'`,
    "$shortcut.Save()"
  ].join("; ");

  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: "ignore",
    windowsHide: true
  });
}

function readAdminUrl(configPath) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const baseUrl = String(config.mediaDropUrl || config.adminUrl || "https://subir-arquivo.vercel.app").replace(/\/admin\/?$/, "").replace(/\/$/, "");
    return `${baseUrl}/admin`;
  } catch (error) {
    return "https://subir-arquivo.vercel.app/admin";
  }
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error("Payload do instalador nao encontrado.");
  }

  fs.mkdirSync(path.join(installDir, "tools"), { recursive: true });

  copyFile(path.join(sourceDir, "MediaDrop-Downloader.exe"), path.join(installDir, "MediaDrop-Downloader.exe"));
  copyFile(path.join(sourceDir, "config.example.json"), path.join(installDir, "config.example.json"));
  copyFile(path.join(sourceDir, "README.txt"), path.join(installDir, "README.txt"));
  copyFile(path.join(sourceDir, "yt-dlp.exe"), path.join(installDir, "tools", "yt-dlp.exe"));
  copyFile(path.join(sourceDir, "ffmpeg.exe"), path.join(installDir, "tools", "ffmpeg.exe"));

  const configPath = path.join(installDir, "config.json");
  if (!fs.existsSync(configPath)) {
    copyFile(path.join(sourceDir, "config.example.json"), configPath);
  }

  createShortcut("MediaDrop Downloader", path.join(installDir, "MediaDrop-Downloader.exe"), installDir);
  createShortcut("MediaDrop Downloader - Config", configPath, installDir);
  createShortcut("MediaDrop Admin", readAdminUrl(configPath), installDir);

  console.log("MediaDrop Downloader instalado com sucesso.");
  console.log(`Pasta: ${installDir}`);
  console.log("");
  console.log("Antes de usar, abra o atalho \"MediaDrop Downloader - Config\" e preencha as chaves do Supabase.");
  console.log("Use \"MediaDrop Admin\" para abrir o painel online no navegador.");
  console.log("Use \"MediaDrop Downloader\" para abrir o painel local de downloads.");
  console.log("");
  console.log("Pressione Enter para sair.");
  process.stdin.resume();
  process.stdin.once("data", () => process.exit(0));
}

try {
  main();
} catch (error) {
  console.error(`Erro ao instalar: ${error.message}`);
  console.log("");
  console.log("Pressione Enter para sair.");
  process.stdin.resume();
  process.stdin.once("data", () => process.exit(1));
}
