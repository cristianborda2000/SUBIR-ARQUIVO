const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");
const config = require("./config");
const { uniqueFilename, withExtension } = require("./storage");

const youtubeHostPattern = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i;
const localYtDlpPath = path.join(config.rootDir, "tools", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

function isYoutubeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && youtubeHostPattern.test(url.hostname);
  } catch (error) {
    return false;
  }
}

function ffmpegDirectory() {
  return ffmpegStatic ? path.dirname(ffmpegStatic) : null;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const executable = fs.existsSync(localYtDlpPath) ? localYtDlpPath : "yt-dlp";
    const process = spawn(executable, args, {
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    process.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    process.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error("yt-dlp nao foi encontrado. Instale o yt-dlp para baixar videos do YouTube."));
        return;
      }
      reject(new Error(`Nao foi possivel executar o yt-dlp: ${error.message}`));
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.slice(-1200) || "Falha ao baixar o video do YouTube."));
    });
  });
}

async function getYoutubeTitle(url) {
  try {
    const title = await runYtDlp(["--no-playlist", "--get-title", url]);
    return title.split(/\r?\n/).filter(Boolean).pop() || "youtube-video";
  } catch (error) {
    return "youtube-video";
  }
}

async function downloadYoutubeVideo(url, displayName) {
  if (!isYoutubeUrl(url)) {
    throw new Error("Informe um link valido do YouTube.");
  }

  const title = displayName || await getYoutubeTitle(url);
  const originalname = withExtension(title, "video.mp4");
  const filename = uniqueFilename(originalname).replace(/\.[^.]+$/, ".mp4");
  const outputPath = path.join(config.uploadDir, "videos", filename);
  const args = [
    "--no-playlist",
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--recode-video", "mp4",
    "-o", outputPath
  ];
  const ffmpegDir = ffmpegDirectory();

  if (ffmpegDir) {
    args.push("--ffmpeg-location", ffmpegDir);
  }

  args.push(url);

  await runYtDlp(args);

  if (!fs.existsSync(outputPath)) {
    throw new Error("O download terminou, mas o arquivo MP4 nao foi encontrado.");
  }

  return {
    path: outputPath,
    filename,
    originalname: originalname.replace(/\.[^.]+$/, ".mp4"),
    mimetype: "video/mp4",
    size: fs.statSync(outputPath).size
  };
}

module.exports = {
  downloadYoutubeVideo,
  isYoutubeUrl
};
