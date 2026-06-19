const config = require("./config");

function isSupabaseEnabled() {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

function cutoffDate() {
  const date = new Date();
  date.setDate(date.getDate() - config.youtubeLinkTtlDays);
  return date.toISOString();
}

async function supabaseRequest(path, options = {}) {
  const url = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase retornou status ${response.status}.`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function insertYoutubeLink(db, link) {
  if (!isSupabaseEnabled()) {
    const result = db.run(`
      INSERT INTO youtube_links (title, url, note, created_at)
      VALUES (?, ?, ?, ?)
    `, [link.title, link.url, link.note, link.createdAt]);
    return { ...link, id: result.lastInsertRowid, created_at: link.createdAt };
  }

  const rows = await supabaseRequest("youtube_links", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      title: link.title,
      url: link.url,
      note: link.note || null,
      status: "pending",
      created_at: link.createdAt
    })
  });
  return rows[0];
}

async function listYoutubeLinks(db) {
  if (!isSupabaseEnabled()) {
    db.run("DELETE FROM youtube_links WHERE created_at < ?", [cutoffDate()]);
    return db.all("SELECT * FROM youtube_links ORDER BY created_at DESC, id DESC");
  }

  await supabaseRequest(`youtube_links?created_at=lt.${encodeURIComponent(cutoffDate())}`, {
    method: "DELETE"
  });
  return supabaseRequest(`youtube_links?select=*&created_at=gte.${encodeURIComponent(cutoffDate())}&order=created_at.desc`);
}

async function getYoutubeLink(db, id) {
  if (!isSupabaseEnabled()) {
    return db.get("SELECT * FROM youtube_links WHERE id = ?", [id]);
  }

  const rows = await supabaseRequest(`youtube_links?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

async function deleteYoutubeLink(db, id) {
  if (!isSupabaseEnabled()) {
    db.run("DELETE FROM youtube_links WHERE id = ?", [id]);
    return;
  }

  await supabaseRequest(`youtube_links?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

module.exports = {
  deleteYoutubeLink,
  getYoutubeLink,
  insertYoutubeLink,
  isSupabaseEnabled,
  listYoutubeLinks
};
