const config = require("./config");

const bucketName = process.env.SUPABASE_STORAGE_BUCKET || "mediadrop-files";
let bucketReady = false;

function isSupabaseFilesEnabled() {
  return Boolean(config.supabaseFilesEnabled && config.supabaseUrl && config.supabaseServiceRoleKey);
}

async function supabaseApi(path, options = {}) {
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase retornou status ${response.status}.`);
  }

  return response;
}

async function supabaseRest(resource, options = {}) {
  const response = await supabaseApi(`/rest/v1/${resource}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function ensureBucket() {
  if (bucketReady) return;

  const list = await supabaseApi("/storage/v1/bucket");
  const buckets = await list.json();
  if (!buckets.some((bucket) => bucket.id === bucketName)) {
    await supabaseApi("/storage/v1/bucket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: bucketName,
        name: bucketName,
        public: false
      })
    });
  }
  bucketReady = true;
}

async function uploadObject(storagePath, buffer, contentType) {
  await ensureBucket();
  await supabaseApi(`/storage/v1/object/${bucketName}/${storagePath}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true"
    },
    body: buffer
  });
}

async function createSignedUploadUrl(storagePath) {
  await ensureBucket();
  const response = await supabaseApi(`/storage/v1/object/upload/sign/${bucketName}/${storagePath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-upsert": "false"
    },
    body: JSON.stringify({})
  });
  const data = await response.json();
  const rawUrl = data.url || data.signedURL || data.signedUrl;
  if (!rawUrl) {
    throw new Error("Supabase nao retornou URL assinada para upload.");
  }
  const relativePath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  const signedUrl = rawUrl.startsWith("http")
    ? rawUrl
    : `${config.supabaseUrl.replace(/\/$/, "")}/storage/v1${relativePath}`;
  const token = new URL(signedUrl).searchParams.get("token");
  if (!token) {
    throw new Error("Supabase nao retornou token de upload.");
  }
  return { signedUrl, token, path: storagePath };
}

async function downloadObject(storagePath) {
  await ensureBucket();
  const response = await supabaseApi(`/storage/v1/object/${bucketName}/${storagePath}`);
  return Buffer.from(await response.arrayBuffer());
}

async function deleteObject(storagePath) {
  await ensureBucket();
  await supabaseApi(`/storage/v1/object/${bucketName}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [storagePath] })
  });
}

async function insertFileRecord(file) {
  const rows = await supabaseRest("media_files", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(file)
  });
  return rows[0];
}

async function listFiles() {
  return supabaseRest("media_files?select=*&order=uploaded_at.desc");
}

async function getFile(id) {
  const rows = await supabaseRest(`media_files?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

async function deleteFile(id) {
  await supabaseRest(`media_files?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

async function deleteAllFiles() {
  await supabaseRest("media_files", {
    method: "DELETE"
  });
}

module.exports = {
  bucketName,
  createSignedUploadUrl,
  deleteAllFiles,
  deleteFile,
  deleteObject,
  downloadObject,
  getFile,
  insertFileRecord,
  isSupabaseFilesEnabled,
  listFiles,
  uploadObject
};
