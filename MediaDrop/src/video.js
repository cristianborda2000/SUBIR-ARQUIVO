const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");
const { sanitizeFilename } = require("./storage");

function ffmpegPath() {
  return ffmpegStatic || "ffmpeg";
}

function mp4NameFrom(originalName, storedName) {
  const safeOriginal = sanitizeFilename(originalName);
  const originalBase = path.parse(safeOriginal).name || "video";
  const storedBase = path.parse(storedName).name || originalBase;

  return {
    displayName: `${originalBase}.mp4`,
    storedName: `${storedBase}.mp4`
  };
}

function isMp4File(filePath, mimeType) {
  return path.extname(filePath).toLowerCase() === ".mp4" && (!mimeType || mimeType === "video/mp4");
}

function convertToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
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

    const process = spawn(ffmpegPath(), args, {
      windowsHide: true
    });

    let errorOutput = "";
    process.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });

    process.on("error", (error) => {
      reject(new Error(`Nao foi possivel executar o FFmpeg: ${error.message}`));
    });

    process.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
        return;
      }

      reject(new Error(errorOutput.slice(-1200) || "Falha ao converter video para MP4."));
    });
  });
}

async function normalizeVideoFile(file) {
  const ext = path.extname(file.filename).toLowerCase();
  const names = mp4NameFrom(file.originalname, file.filename);
  const outputPath = path.join(path.dirname(file.path), names.storedName);

  if (ext === ".mp4" && file.mimetype === "video/mp4") {
    return {
      path: file.path,
      filename: file.filename,
      originalname: names.displayName,
      mimetype: "video/mp4",
      size: file.size
    };
  }

  await convertToMp4(file.path, outputPath);

  const outputSize = fs.statSync(outputPath).size;
  fs.unlinkSync(file.path);

  return {
    path: outputPath,
    filename: names.storedName,
    originalname: names.displayName,
    mimetype: "video/mp4",
    size: outputSize
  };
}

module.exports = {
  convertToMp4,
  isMp4File,
  mp4NameFrom,
  normalizeVideoFile
};
