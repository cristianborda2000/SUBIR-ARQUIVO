const loginView = document.querySelector("#loginView");
const adminView = document.querySelector("#adminView");
const loginForm = document.querySelector("#loginForm");
const loginStatus = document.querySelector("#loginStatus");
const logoutButton = document.querySelector("#logoutButton");
const tabs = document.querySelector("#tabs");
const filesContainer = document.querySelector("#filesContainer");
const downloadAll = document.querySelector("#downloadAll");
const deleteAll = document.querySelector("#deleteAll");
const settingsButton = document.querySelector("#settingsButton");
const passwordForm = document.querySelector("#passwordForm");
const passwordStatus = document.querySelector("#passwordStatus");

let state = {
  categories: [],
  files: {},
  active: "fotos"
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function showAdmin(show) {
  loginView.classList.toggle("hidden", show);
  adminView.classList.toggle("hidden", !show);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Operacao nao concluida.");
  }

  return response.json();
}

function renderTabs() {
  tabs.innerHTML = "";
  state.categories.forEach((category) => {
    const count = (state.files[category.key] || []).length;
    const button = document.createElement("button");
    button.className = `tab ${state.active === category.key ? "active" : ""}`;
    button.type = "button";
    button.textContent = `${category.label} (${count})`;
    button.addEventListener("click", () => {
      state.active = category.key;
      renderTabs();
      renderFiles();
    });
    tabs.appendChild(button);
  });
}

function renderFiles() {
  const category = state.categories.find((item) => item.key === state.active);
  const files = state.files[state.active] || [];
  filesContainer.innerHTML = "";

  const head = document.createElement("div");
  head.className = "panel-head";
  const titleWrap = document.createElement("div");
  titleWrap.append(
    textElement("h2", "", category ? category.label : "Arquivos"),
    textElement("div", "meta", `${files.length} arquivo(s) nesta categoria`)
  );
  const zipLink = document.createElement("a");
  zipLink.className = "button secondary";
  zipLink.href = `/api/admin/download/category/${state.active}`;
  zipLink.textContent = "Baixar ZIP";
  head.append(titleWrap, zipLink);
  filesContainer.appendChild(head);

  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nenhum arquivo enviado nesta categoria.";
    filesContainer.appendChild(empty);
    return;
  }

  files.forEach((file) => {
    const row = document.createElement("div");
    row.className = "file-row";
    const nameBlock = document.createElement("div");
    nameBlock.appendChild(textElement("div", "file-name", file.originalName));
    if (file.note) {
      nameBlock.appendChild(textElement("div", "file-note", file.note));
    }

    const sizeBlock = document.createElement("div");
    sizeBlock.append(
      textElement("strong", "", formatSize(file.size)),
      textElement("div", "meta", file.mimeType)
    );

    const dateBlock = textElement("div", "meta", formatDate(file.uploadedAt));
    const actions = document.createElement("div");
    actions.className = "row-actions";

    const download = document.createElement("a");
    download.className = "button small secondary";
    download.href = `/api/admin/files/${file.id}/download`;
    download.textContent = "Baixar";

    const remove = document.createElement("button");
    remove.className = "button small danger";
    remove.type = "button";
    remove.dataset.delete = file.id;
    remove.textContent = "Apagar";

    actions.append(download, remove);
    row.append(nameBlock, sizeBlock, dateBlock, actions);
    filesContainer.appendChild(row);
  });
}

async function loadFiles() {
  const data = await api("/api/admin/files");
  state.categories = data.categories;
  state.files = data.files;
  if (!state.categories.find((item) => item.key === state.active)) {
    state.active = state.categories[0]?.key || "fotos";
  }
  renderTabs();
  renderFiles();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "Entrando...";
  loginStatus.className = "status";

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.querySelector("#username").value,
        password: document.querySelector("#password").value
      })
    });
    showAdmin(true);
    await loadFiles();
  } catch (error) {
    loginStatus.textContent = error.message;
    loginStatus.className = "status error";
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => null);
  passwordForm.classList.add("hidden");
  showAdmin(false);
});

filesContainer.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;

  const id = button.getAttribute("data-delete");
  const ok = window.confirm("Apagar este arquivo?");
  if (!ok) return;

  button.disabled = true;
  try {
    await api(`/api/admin/files/${id}`, { method: "DELETE" });
    await loadFiles();
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
  }
});

downloadAll.addEventListener("click", () => {
  window.location.href = "/api/admin/download/all";
});

deleteAll.addEventListener("click", async () => {
  const total = Object.values(state.files).reduce((sum, files) => sum + files.length, 0);
  if (!total) {
    window.alert("Nao ha arquivos para apagar.");
    return;
  }

  const confirmation = window.prompt(`Digite APAGAR para remover todos os ${total} arquivo(s).`);
  if (confirmation !== "APAGAR") return;

  deleteAll.disabled = true;
  try {
    await api("/api/admin/files", { method: "DELETE" });
    await loadFiles();
  } catch (error) {
    window.alert(error.message);
  } finally {
    deleteAll.disabled = false;
  }
});

settingsButton.addEventListener("click", () => {
  passwordForm.classList.toggle("hidden");
  passwordStatus.textContent = "";
  passwordStatus.className = "status";
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPassword = document.querySelector("#currentPassword").value;
  const newPassword = document.querySelector("#newPassword").value;
  const confirmPassword = document.querySelector("#confirmPassword").value;

  passwordStatus.textContent = "Alterando...";
  passwordStatus.className = "status";

  if (newPassword !== confirmPassword) {
    passwordStatus.textContent = "A confirmacao nao confere.";
    passwordStatus.className = "status error";
    return;
  }

  try {
    const response = await api("/api/admin/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
    passwordForm.reset();
    passwordStatus.textContent = response.message || "Senha alterada com sucesso.";
    passwordStatus.className = "status success";
  } catch (error) {
    passwordStatus.textContent = error.message;
    passwordStatus.className = "status error";
  }
});

(async function init() {
  const session = await api("/api/admin/session").catch(() => ({ authenticated: false }));
  showAdmin(session.authenticated);
  if (session.authenticated) {
    await loadFiles();
  }
})();
