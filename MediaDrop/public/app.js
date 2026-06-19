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
  statusBox.textContent = message;
  statusBox.className = `status ${type || ""}`;
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

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentFiles.length && !hasYoutubeLink()) return;

  const formData = new FormData();
  currentFiles.forEach((file) => formData.append("files", file));
  formData.append("displayNames", JSON.stringify(displayNames));
  formData.append("youtubeUrl", youtubeUrl.value.trim());
  formData.append("youtubeTitle", youtubeTitle.value.trim());
  formData.append("note", document.querySelector("#note").value);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/upload");
  submitButton.disabled = true;
  progress.style.width = "0%";
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
      setStatus(response.message || "Arquivo enviado com sucesso. O administrador ja pode baixar.", "success");
      uploadForm.reset();
      currentFiles = [];
      displayNames = [];
      renderFiles();
      progress.style.width = "100%";
      return;
    }

    setStatus(responseErrorMessage(xhr, response), "error");
    submitButton.disabled = currentFiles.length === 0;
  });

  xhr.addEventListener("error", () => {
    setStatus("Erro de conexao durante o envio.", "error");
    submitButton.disabled = currentFiles.length === 0;
  });

  xhr.send(formData);
});

renderFiles();
