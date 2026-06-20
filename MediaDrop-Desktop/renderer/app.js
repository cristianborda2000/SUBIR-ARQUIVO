const tabs = document.querySelector("#tabs");
const filesContainer = document.querySelector("#filesContainer");
const statusBox = document.querySelector("#status");
const settingsDialog = document.querySelector("#settingsDialog");
const settingsForm = document.querySelector("#settingsForm");
const settingsStatus = document.querySelector("#settingsStatus");

const fields = {
  supabaseUrl: document.querySelector("#supabaseUrl"),
  supabaseServiceRoleKey: document.querySelector("#supabaseServiceRoleKey"),
  mediaDropUrl: document.querySelector("#mediaDropUrl"),
  adminUser: document.querySelector("#adminUser"),
  adminPassword: document.querySelector("#adminPassword"),
  downloadFolder: document.querySelector("#downloadFolder"),
  ttlDays: document.querySelector("#ttlDays"),
  deleteYoutubeAfterDownload: document.querySelector("#deleteYoutubeAfterDownload")
};

let state = {
  active: "youtube",
  youtube: [],
  categories: [],
  files: {},
  config: {},
  warnings: []
};
let isRefreshing = false;
let isBusy = false;
const downloadedIds = new Set(JSON.parse(localStorage.getItem("wichayDownloadedIds") || "[]"));

function setStatus(message, type = "") {
  statusBox.textContent = message || "";
  statusBox.className = `status ${type}`;
}

function setSettingsStatus(message, type = "") {
  settingsStatus.textContent = message || "";
  settingsStatus.className = `status ${type}`;
}

function itemKey(item) {
  return `${isYoutubeItem(item) ? "youtube" : "file"}:${item.id}`;
}

function saveDownloadedIds() {
  localStorage.setItem("wichayDownloadedIds", JSON.stringify(Array.from(downloadedIds)));
}

function markDownloaded(item) {
  downloadedIds.add(itemKey(item));
  saveDownloadedIds();
}

function formatSize(bytes) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function tabItems() {
  const items = [{ key: "youtube", label: "YouTube", count: state.youtube.length }];
  state.categories.forEach((category) => {
    if (category.key === "youtube") return;
    items.push({ key: category.key, label: category.label, count: (state.files[category.key] || []).length });
  });
  return items;
}

function renderTabs() {
  tabs.innerHTML = "";
  tabItems().forEach((item) => {
    const button = document.createElement("button");
    button.className = `tab ${state.active === item.key ? "active" : ""}`;
    button.type = "button";
    button.textContent = `${item.label} (${item.count})`;
    button.addEventListener("click", () => {
      state.active = item.key;
      render();
    });
    tabs.appendChild(button);
  });
}

function currentItems() {
  if (state.active !== "youtube") return state.files[state.active] || [];
  return allYoutubeItems();
}

function isYoutubeItem(item) {
  return item && (item.source === "youtube" || item.mimeType === "YouTube pendente");
}

function allYoutubeItems() {
  const grouped = Object.values(state.files)
    .flat()
    .filter((item) => isYoutubeItem(item));
  const byId = new Map();
  [...state.youtube, ...grouped].forEach((item) => {
    byId.set(String(item.id), item);
  });
  return Array.from(byId.values());
}

function allFileItems() {
  return Object.values(state.files)
    .flat()
    .filter((item) => !isYoutubeItem(item));
}

function warningForActiveTab() {
  if (state.active === "youtube") {
    return state.warnings.find((warning) => warning.includes("YouTube"));
  }
  return state.warnings.find((warning) => warning.includes("Arquivos do site"));
}

function render() {
  renderTabs();
  const items = currentItems();
  const activeTab = tabItems().find((item) => item.key === state.active);
  filesContainer.innerHTML = "";

  const head = document.createElement("div");
  head.className = "panel-head";
  const titleWrap = document.createElement("div");
  titleWrap.append(
    textElement("h2", "", activeTab ? activeTab.label : "Arquivos"),
    textElement("div", "meta", `${items.length} item(ns) nesta categoria`)
  );
  const zipButton = document.createElement("button");
  zipButton.className = "button secondary";
  zipButton.type = "button";
  zipButton.textContent = state.active === "youtube" ? "Baixar todos" : "Baixar ZIP";
  zipButton.addEventListener("click", () => {
    if (state.active === "youtube") downloadAllYoutube();
    else downloadCategory(state.active);
  });
  head.append(titleWrap, zipButton);
  filesContainer.appendChild(head);

  const warning = warningForActiveTab();
  if (warning) {
    filesContainer.appendChild(textElement("p", "empty warning-text", warning));
  }

  if (!items.length) {
    filesContainer.appendChild(textElement("p", "empty", state.active === "youtube" ? "Nenhum link pendente encontrado." : "Nenhum arquivo enviado nesta categoria."));
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "file-row";
    const nameBlock = document.createElement("div");
    const youtubeItem = state.active === "youtube" || isYoutubeItem(item);
    nameBlock.appendChild(textElement("div", "file-name", youtubeItem ? (item.title || item.originalName) : item.originalName));
    nameBlock.appendChild(textElement("div", "file-note", youtubeItem ? (item.url || item.note || "Link do YouTube pendente") : (item.needsConversion ? "Sera convertido para MP4 no desktop" : (item.note || item.mimeType || ""))));
    const sizeBlock = document.createElement("div");
    sizeBlock.append(
      textElement("strong", "", youtubeItem ? "Pendente" : formatSize(item.size)),
      textElement("div", "meta", youtubeItem ? "MP4 local" : (item.mimeType || ""))
    );
    const dateBlock = textElement("div", "meta", formatDate(youtubeItem ? (item.created_at || item.uploadedAt) : item.uploadedAt));
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const download = document.createElement("button");
    const wasDownloaded = downloadedIds.has(itemKey(item));
    download.className = `button small secondary ${wasDownloaded ? "downloaded" : ""}`;
    download.type = "button";
    download.textContent = wasDownloaded ? "Baixado" : "Baixar";
    download.addEventListener("click", () => {
      if (youtubeItem) downloadYoutube(item, download);
      else downloadFile(item, download);
    });
    const remove = document.createElement("button");
    remove.className = "button small danger";
    remove.type = "button";
    remove.textContent = "Apagar";
    remove.addEventListener("click", () => {
      if (youtubeItem) deleteYoutube(item);
      else deleteFile(item.id);
    });
    actions.append(download, remove);
    row.append(nameBlock, sizeBlock, dateBlock, actions);
    filesContainer.appendChild(row);
  });
}

async function action(button, busyText, work) {
  const oldText = button ? button.textContent : "";
  isBusy = true;
  if (button) {
    button.disabled = true;
    button.textContent = busyText;
  }
  try {
    const result = await work();
    setStatus(result.message || "Concluido.", "success");
    await loadState();
    return result;
  } catch (error) {
    setStatus(error.message, "error");
    return null;
  } finally {
    isBusy = false;
    if (button) {
      button.disabled = false;
      button.textContent = oldText;
    }
  }
}

async function loadState() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    const data = await window.mediaDrop.loadState();
    state.youtube = data.youtube || [];
    state.categories = data.categories || [];
    state.files = data.files || {};
    state.config = data.config || {};
    state.warnings = data.warnings || [];
    if (!tabItems().find((item) => item.key === state.active)) state.active = "youtube";
    render();
    setStatus(state.warnings.length ? state.warnings.join(" | ") : "", state.warnings.length ? "" : "");
  } catch (error) {
    renderTabs();
    filesContainer.innerHTML = "";
    filesContainer.appendChild(textElement("p", "empty", error.message));
    setStatus(error.message, "error");
    if (/Configure/.test(error.message)) openSettings();
  } finally {
    isRefreshing = false;
  }
}

function downloadYoutube(item, button) {
  action(button, "Baixando...", () => {
    if (typeof item === "object") return window.mediaDrop.downloadYoutubeItem(item);
    return window.mediaDrop.downloadYoutube(item);
  }).then((result) => {
    if (!result) return;
    if (typeof item === "object") markDownloaded(item);
    render();
  });
}

async function downloadOneYoutube(link) {
  await window.mediaDrop.downloadYoutubeItem(link);
  markDownloaded(link);
  render();
  return true;
}

async function deleteAllItems() {
  const files = allFileItems();
  const youtube = allYoutubeItems();

  try {
    return await window.mediaDrop.deleteAll();
  } catch (error) {
    if (!files.length && !youtube.length) throw error;
    return window.mediaDrop.deleteAllItems({ files, youtube });
  }
}

function clearDownloadedForItems(files, youtube) {
  [...files, ...youtube].forEach((item) => downloadedIds.delete(itemKey(item)));
  saveDownloadedIds();
}

function deleteAllFromDesktop() {
  const files = allFileItems();
  const youtube = allYoutubeItems();
  return deleteAllItems().then((result) => {
    clearDownloadedForItems(files, youtube);
    return result;
  });
}

function downloadAllYoutube() {
  const links = allYoutubeItems();
  if (!links.length) return setStatus("Nao ha links pendentes.", "error");
  if (!confirm("Baixar todos os links do YouTube pendentes?")) return;
  action(document.querySelector("#downloadYoutubeAllButton"), "Baixando...", async () => {
    let downloaded = 0;
    let errors = 0;
    for (const link of links) {
      try {
        await downloadOneYoutube(link);
        downloaded += 1;
      } catch (_error) {
        errors += 1;
      }
    }
    return { message: `Concluidos: ${downloaded} | Erros: ${errors}` };
  });
}

function downloadFile(file, button) {
  action(button, "Baixando...", () => window.mediaDrop.downloadFile(file))
    .then((result) => {
      if (!result) return;
      markDownloaded(file);
      render();
    });
}

function downloadCategory(category) {
  action(null, "Baixando...", () => window.mediaDrop.downloadCategory(category));
}

function deleteYoutube(item) {
  if (!confirm("Apagar este link pendente?")) return;
  action(null, "Apagando...", () => {
    if (typeof item === "object") return window.mediaDrop.deleteYoutubeItem(item);
    return window.mediaDrop.deleteYoutube(item);
  });
}

function deleteFile(id) {
  if (!confirm("Apagar este arquivo do sistema web?")) return;
  action(null, "Apagando...", () => window.mediaDrop.deleteFile(id));
}

function fillConfigForm(config) {
  fields.supabaseUrl.value = config.supabaseUrl || "";
  fields.supabaseServiceRoleKey.value = "";
  fields.supabaseServiceRoleKey.placeholder = config.hasSupabaseKey ? "Chave salva. Digite outra para trocar." : "Cole a secret key";
  fields.mediaDropUrl.value = config.mediaDropUrl || "";
  fields.adminUser.value = config.adminUser || "";
  fields.adminPassword.value = "";
  fields.adminPassword.placeholder = config.hasAdminPassword ? "Senha salva. Digite outra para trocar." : "Senha admin";
  fields.downloadFolder.value = config.downloadFolder || "";
  fields.ttlDays.value = config.ttlDays || 7;
  fields.deleteYoutubeAfterDownload.checked = Boolean(config.deleteYoutubeAfterDownload);
}

async function openSettings() {
  const config = await window.mediaDrop.getConfig();
  fillConfigForm(config);
  setSettingsStatus("");
  settingsDialog.showModal();
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setSettingsStatus("Salvando...");
  try {
    const current = await window.mediaDrop.getConfig();
    const saved = await window.mediaDrop.saveConfig({
      supabaseUrl: fields.supabaseUrl.value,
      supabaseServiceRoleKey: fields.supabaseServiceRoleKey.value.replace(/\s+/g, "") || (current.hasSupabaseKey ? undefined : ""),
      mediaDropUrl: fields.mediaDropUrl.value,
      adminUser: fields.adminUser.value,
      adminPassword: fields.adminPassword.value || (current.hasAdminPassword ? undefined : ""),
      downloadFolder: fields.downloadFolder.value,
      ttlDays: fields.ttlDays.value,
      deleteYoutubeAfterDownload: fields.deleteYoutubeAfterDownload.checked
    });
    fillConfigForm(saved);
    setSettingsStatus("Salvo.", "success");
    settingsDialog.close();
    await loadState();
  } catch (error) {
    setSettingsStatus(error.message, "error");
  }
});

document.querySelector("#settingsButton").addEventListener("click", openSettings);
document.querySelector("#closeSettingsButton").addEventListener("click", () => settingsDialog.close());
document.querySelector("#refreshButton").addEventListener("click", loadState);
document.querySelector("#downloadYoutubeAllButton").addEventListener("click", downloadAllYoutube);
document.querySelector("#downloadAllButton").addEventListener("click", () => {
  if (!confirm("Baixar todos os arquivos comuns em ZIP?")) return;
  action(document.querySelector("#downloadAllButton"), "Baixando...", () => window.mediaDrop.downloadAllFiles());
});
document.querySelector("#deleteAllButton").addEventListener("click", () => {
  const confirmation = prompt("Digite APAGAR para apagar todos os arquivos e links do sistema web.");
  if (confirmation !== "APAGAR") return;
  action(document.querySelector("#deleteAllButton"), "Apagando...", deleteAllFromDesktop);
});
document.querySelector("#chooseFolderButton").addEventListener("click", async () => {
  const folder = await window.mediaDrop.chooseFolder();
  if (folder) fields.downloadFolder.value = folder;
});
document.querySelector("#openConfigFolderButton").addEventListener("click", () => window.mediaDrop.openConfigFolder());
document.querySelector("#openFolderButton").addEventListener("click", () => window.mediaDrop.openFolder());
document.querySelector("#openWebButton").addEventListener("click", () => window.mediaDrop.openAdminWeb());

loadState();
setInterval(() => {
  if (!isBusy && !settingsDialog.open) {
    loadState();
  }
}, 8000);
