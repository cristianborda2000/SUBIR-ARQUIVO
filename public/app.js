const fileInput = document.querySelector("#fileInput");
const dropzone = document.querySelector("#dropzone");
const selectedFiles = document.querySelector("#selectedFiles");
const uploadForm = document.querySelector("#uploadForm");
const progress = document.querySelector("#progressBar");
const statusBox = document.querySelector("#status");
const submitButton = document.querySelector("#submitButton");
const youtubeUrl = document.querySelector("#youtubeUrl");
const youtubeTitle = document.querySelector("#youtubeTitle");

let currentFiles = [];
let displayNames = [];
const directUploadThreshold = 3.8 * 1024 * 1024;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function renderFiles() {
  selectedFiles.innerHTML = "";
  currentFiles.forEach((file, index) => {
    const item = document.createElement("li");
    const details = document.createElement("div");
    const originalName = document.createElement("span");
    const nameInput = document.createElement("input");
    const size = document.createElement("strong");

    originalName.className = "file-original";
    originalName.textContent = file.name;
    nameInput.type = "text";
    nameInput.value = displayNames[index] || file.name;
    nameInput.setAttribute("aria-label", `Nome para salvar ${file.name}`);
    nameInput.addEventListener("input", () => {
      displayNames[index] = nameInput.value;
    });
    size.textContent = formatSize(file.size);
    details.append(originalName, nameInput);
    item.append(details, size);
    selectedFiles.appendChild(item);
  });
  updateSubmitState();
}

function setStatus(message, type) {
  statusBox.className = `status ${type || ""}`;
  statusBox.innerHTML = "";
  if (type === "success") {
    const icon = document.createElement("span");
    icon.className = "success-circle";
    icon.textContent = "✓";
    const text = document.createElement("span");
    text.textContent = message || "Arquivo enviado com sucesso.";
    statusBox.append(icon, text);
  } else {
    statusBox.textContent = message;
  }
  document.body.classList.toggle("upload-success-screen", type === "success");
}

function updateFiles(files) {
  document.body.classList.remove("upload-success-screen");
  currentFiles = Array.from(files);
  displayNames = currentFiles.map((file) => file.name);
  renderFiles();
  setStatus(currentFiles.length ? `${currentFiles.length} arquivo(s) pronto(s) para envio.` : "", "");
}

function hasYoutubeLink() {
  return youtubeUrl.value.trim().length > 0;
}

function updateSubmitState() {
  submitButton.disabled = currentFiles.length === 0 && !hasYoutubeLink();
}

function shouldUseDirectUpload() {
  return currentFiles.some((file) => file.size > directUploadThreshold);
}

function isNonMp4Video(file) {
  return file.type.startsWith("video/") && !/\.mp4$/i.test(file.name) && file.type !== "video/mp4";
}

function responseErrorMessage(xhr, response) {
  if (response && response.error) {
    return response.error;
  }

  if (xhr.status === 413) {
    return "Arquivo grande demais para a Vercel. Teste com imagem pequena ou envie videos grandes pelo servidor/app local.";
  }

  if (xhr.status === 504) {
    return "O envio demorou demais para a Vercel. Videos grandes podem passar do limite de tempo.";
  }

  const text = String(xhr.responseText || "").replace(/\s+/g, " ").trim();
  if (text) {
    return `Erro ${xhr.status}: ${text.slice(0, 280)}`;
  }

  return `Nao foi possivel enviar os arquivos. Codigo ${xhr.status || "desconhecido"}.`;
}

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
});

dropzone.addEventListener("drop", (event) => {
  updateFiles(event.dataTransfer.files);
});

fileInput.addEventListener("change", () => {
  updateFiles(fileInput.files);
});

youtubeUrl.addEventListener("input", updateSubmitState);
youtubeUrl.addEventListener("input", () => document.body.classList.remove("upload-success-screen"));

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Erro ${response.status}`);
  }
  return body;
}

async function uploadFileDirect(file, index, note) {
  const signed = await apiJson("/api/upload/direct/sign", {
    method: "POST",
    body: JSON.stringify({
      originalName: file.name,
      displayName: displayNames[index] || file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      needsConversion: isNonMp4Video(file)
    })
  });

  const headers = {
    ...(signed.uploadHeaders || {}),
    "content-type": file.type || "application/octet-stream",
    "cache-control": "max-age=3600",
    "x-upsert": "false"
  };
  const putResponse = await fetch(signed.signedUrl, {
    method: "PUT",
    headers,
    body: file
  });

  let uploadResponse = putResponse;
  let putError = "";
  if (!uploadResponse.ok) {
    putError = await putResponse.text().catch(() => "");
    uploadResponse = await fetch(signed.signedUrl, {
      method: "PUT",
      headers,
      body: file
    });
  }

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => "");
    const details = [putError, text].filter(Boolean).join(" | ");
    throw new Error(details || `Supabase retornou erro ${uploadResponse.status} no upload.`);
  }

  return apiJson("/api/upload/direct/complete", {
    method: "POST",
    body: JSON.stringify({
      file: signed.file,
      note
    })
  });
}

async function submitDirectUpload() {
  const note = document.querySelector("#note").value;
  const hasYoutube = hasYoutubeLink();
  if (hasYoutube) {
    throw new Error("Envie links do YouTube separados dos arquivos grandes.");
  }

  const uploaded = [];
  for (const [index, file] of currentFiles.entries()) {
    setStatus(`Enviando ${index + 1} de ${currentFiles.length} direto para o Supabase...`, "");
    const result = await uploadFileDirect(file, index, note);
    uploaded.push(result.file);
    progress.style.width = `${Math.round(((index + 1) / currentFiles.length) * 100)}%`;
  }

  return {
    message: `${uploaded.length} arquivo(s) enviado(s) com sucesso. Videos MOV/nao-MP4 serao convertidos para MP4 no app desktop.`,
    files: uploaded
  };
}

function submitServerUpload() {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    currentFiles.forEach((file) => formData.append("files", file));
    formData.append("displayNames", JSON.stringify(displayNames));
    formData.append("youtubeUrl", youtubeUrl.value.trim());
    formData.append("youtubeTitle", youtubeTitle.value.trim());
    formData.append("note", document.querySelector("#note").value);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    const hasVideo = currentFiles.some((file) => file.type.startsWith("video/"));
    const hasYoutube = hasYoutubeLink();
    setStatus(hasYoutube ? "Registrando link do YouTube para o admin..." : hasVideo ? "Enviando e convertendo videos para MP4..." : "Enviando arquivos...", "");

    xhr.upload.addEventListener("progress", (progressEvent) => {
      if (!progressEvent.lengthComputable) return;
      const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
      progress.style.width = `${percent}%`;
    });

    xhr.addEventListener("load", () => {
      let response = {};
      try {
        response = JSON.parse(xhr.responseText || "{}");
      } catch (error) {
        response = {};
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(response);
        return;
      }

      reject(new Error(responseErrorMessage(xhr, response)));
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Erro de conexao durante o envio."));
    });

    xhr.send(formData);
  });
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentFiles.length && !hasYoutubeLink()) return;

  submitButton.disabled = true;
  progress.style.width = "0%";

  try {
    const response = shouldUseDirectUpload() ? await submitDirectUpload() : await submitServerUpload();
    setStatus(response.message || "Arquivo enviado com sucesso. O administrador ja pode baixar.", "success");
    uploadForm.reset();
    currentFiles = [];
    displayNames = [];
    renderFiles();
    progress.style.width = "100%";
  } catch (error) {
    setStatus(error.message, "error");
    submitButton.disabled = currentFiles.length === 0;
  }
});

renderFiles();
