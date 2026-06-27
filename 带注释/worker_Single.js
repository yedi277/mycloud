/**
 * name = "mycloud-single"
 * 单用户精简版 —— 仅管理员密码登录，全功能文件管理
 *
 * [[kv_namespaces]]
 * binding = "KV_STORE"
 * id = "你的KV命名空间ID"
 *
 * [[r2_buckets]]
 * binding = "R2_BUCKET"
 * bucket_name = "你的R2桶名"
 *
 * [vars]
 * ADMIN_PASSWORD = "你的管理员密码"
 */

function makeTokenCookie(token, maxAge = 86400) {
  return { 'Set-Cookie': `token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` };
}

function base64UrlEncode(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${encodedHeader}.${encodedPayload}`)
  );

  const encodedSignature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureData = Uint8Array.from(atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureData,
      encoder.encode(`${encodedHeader}.${encodedPayload}`)
    );

    if (!valid) return null;

    const payload = JSON.parse(atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/')));

    if (payload.exp && Date.now() > payload.exp) return null;

    return payload;
  } catch (e) {
    return null;
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const mmdd = pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.getFullYear() === now.getFullYear()) return mmdd + ' ' + hhmm;
  return String(d.getFullYear()).slice(2) + '-' + mmdd + ' ' + hhmm;
}

function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const mimeTypes = {
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'mp3': 'audio/mpeg',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function getPreviewType(filename) {
  const ext = filename.split('.').pop().toLowerCase();

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) {
    return 'image';
  }

  if (ext === 'pdf') {
    return 'pdf';
  }

  if (['txt', 'md', 'json', 'js', 'ts', 'css', 'html', 'htm', 'xml', 'yaml', 'yml', 'ini', 'conf', 'cfg', 'sh', 'bash', 'zsh', 'py', 'php', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'rb', 'lua', 'swift', 'kt', 'scala', 'r', 'vue', 'tsx', 'jsx', 'toml', 'csv', 'sql', 'log', 'bat', 'ps1', 'makefile', 'dockerfile', 'gitignore', 'env', 'properties', 'pl', 'pm', 'coffee', 'dart', 'tf', 'proto'].includes(ext)) {
    return 'text';
  }

  if (ext === 'docx') {
    return 'word';
  }

  if (['mp4', 'webm', 'ogg'].includes(ext)) {
    return 'video';
  }

  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
    return 'audio';
  }

  return null;
}

function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });
  return cookies;
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

function htmlResponse(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...headers
    }
  });
}

// --- R2 辅助函数 ---

// 递归删除 R2 文件夹（前缀 key + '/' 的所有对象 + 文件夹本身）
async function deleteR2Folder(env, key) {
  let cursor;
  do {
    const batch = await env.R2_BUCKET.list({ prefix: key + '/', cursor });
    if (batch.objects?.length) {
      await env.R2_BUCKET.delete(batch.objects.map(obj => obj.key));
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
  await env.R2_BUCKET.delete(key);
}

// 递归复制 R2 文件夹（srcKey -> dstKey），不删除源
async function copyR2Folder(env, srcKey, dstKey) {
  let cursor;
  do {
    const batch = await env.R2_BUCKET.list({ prefix: srcKey + '/', cursor });
    if (batch.objects?.length) {
      const srcObjects = await Promise.all(
        batch.objects.map(obj => env.R2_BUCKET.get(obj.key))
      );
      await Promise.all(
        batch.objects.map((obj, i) => {
          const srcObj = srcObjects[i];
          if (!srcObj) return Promise.resolve();
          const newKey = dstKey + obj.key.slice(srcKey.length);
          return env.R2_BUCKET.put(newKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
        })
      );
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
}

// 解析 WebDAV MOVE/COPY 的 Destination header，返回 { srcKey, dstKey }
// 解析失败直接返回 Response 错误
async function parseDavDestination(request, davPath) {
  const destHeader = request.headers.get('Destination');
  if (!destHeader) return new Response('Missing Destination header', { status: 400 });
  try {
    const destUrl = new URL(destHeader);
    let destPath = destUrl.pathname;
    if (destPath.startsWith('/dav/')) destPath = destPath.slice(5);
    if (destPath.startsWith('/')) destPath = destPath.slice(1);
    return { srcKey: davPath, dstKey: destPath.replace(/\/$/, '') };
  } catch {
    return new Response('Invalid Destination URL', { status: 400 });
  }
}

// --- 认证相关 ---

async function handleLogin(request, env) {
  try {
    const { password } = await request.json();
    if (!password) return jsonResponse({ success: false, message: '请输入密码' }, 400);
    if (password !== env.ADMIN_PASSWORD) return jsonResponse({ success: false, message: '密码错误' }, 401);
    return jsonResponse({ success: true, role: 'admin' }, 200,
      makeTokenCookie(await createJWT({ role: 'admin', exp: Date.now() + 86400000 }, env.ADMIN_PASSWORD)));
  } catch (e) {
    return jsonResponse({ success: false, message: '登录失败: ' + e.message }, 500);
  }
}

async function handleLogout() {
  return jsonResponse(
    { success: true },
    200,
    { 'Set-Cookie': 'token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' }
  );
}

async function verifyAuth(request, env) {
  const cookies = parseCookies(request);
  const token = cookies.token;
  if (!token) return null;
  return await verifyJWT(token, env.ADMIN_PASSWORD);
}

async function requireAuth(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) {
    return jsonResponse({ success: false, message: '未授权' }, 401);
  }
  return auth;
}

// --- 文件操作辅助函数 ---

function normalizePath(p) {
  if (!p) return '';
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

function normalizeFolder(f) {
  if (!f) return '';
  return f.replace(/^\/+|\/+$/g, '');
}

async function handleListFiles(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    let prefix = normalizePath(path);
    if (prefix && !prefix.endsWith('/')) prefix += '/';

    const listed = await env.R2_BUCKET.list({ prefix, delimiter: '/' });

    const files = [];
    const folders = [];

    if (listed.delimitedPrefixes) {
      for (const folderPath of listed.delimitedPrefixes) {
        const name = folderPath.slice(prefix.length, -1);
        if (name) {
          folders.push({ name, path: '/' + folderPath.slice(0, -1) });
        }
      }
    }

    if (listed.objects) {
      for (const obj of listed.objects) {
        const name = obj.key.slice(prefix.length);
        if (name && !name.includes('/')) {
          const previewType = getPreviewType(name);
          files.push({
            name,
            path: '/' + obj.key,
            size: obj.size,
            sizeFormatted: formatFileSize(obj.size),
            timeFormatted: formatTime(obj.uploaded.toISOString()),
            lastModified: obj.uploaded.toISOString(),
            previewType
          });
        }
      }
    }

    return jsonResponse({ success: true, files, folders, currentPath: '/' + prefix.slice(0, -1) || '/' });
  } catch (e) {
    return jsonResponse({ success: false, message: '获取文件列表失败: ' + e.message }, 500);
  }
}

async function handleSearchFiles(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim().toLowerCase();
  const mode = url.searchParams.get('mode') || 'quick';
  if (!query) return jsonResponse({ success: true, results: [] });

  try {
    const results = [];
    let cursor = undefined;
    let pages = 0;
    const maxPages = mode === 'full' ? 9999 : 10;

    do {
      pages++;
      const options = cursor ? { cursor, limit: 1000 } : { limit: 1000 };
      const listed = await env.R2_BUCKET.list(options);
      if (!listed.objects) break;

      for (const obj of listed.objects) {
        const name = obj.key.split('/').pop();
        if (name && name.toLowerCase().includes(query)) {
          const parts = obj.key.split('/');
          const folderPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/';
          results.push({
            name,
            path: '/' + obj.key,
            folder: folderPath,
            size: obj.size,
            sizeFormatted: formatFileSize(obj.size),
            timeFormatted: formatTime(obj.uploaded.toISOString()),
            lastModified: obj.uploaded.toISOString()
          });
        }
        if (results.length >= 50) break;
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor && pages < maxPages && results.length < 50);

    results.sort((a, b) => a.name.localeCompare(b.name));
    return jsonResponse({ success: true, results: results.slice(0, 50), mode, scannedPages: pages });
  } catch (e) {
    return jsonResponse({ success: false, message: '搜索失败: ' + e.message }, 500);
  }
}

async function handleGetFavorites(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  const data = await env.KV_STORE.get(getFavoritesKey());
  return jsonResponse({ success: true, favorites: data ? JSON.parse(data) : [] }, 200, { 'Cache-Control': 'private, max-age=5' });
}

async function handleAddFavorite(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const { name, path } = await request.json();
  if (!name || !path) return jsonResponse({ success: false, message: '缺少参数' }, 400);

  const key = getFavoritesKey();
  const favorites = JSON.parse((await env.KV_STORE.get(key)) || '[]');
  if (favorites.some(f => f.path === path)) return jsonResponse({ success: false, message: '已在收藏夹中' });
  favorites.push({ name, path });
  await env.KV_STORE.put(key, JSON.stringify(favorites));
  return jsonResponse({ success: true, favorites });
}

async function handleRemoveFavorite(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const index = parseInt(new URL(request.url).searchParams.get('index'));
  const key = getFavoritesKey();
  const favorites = JSON.parse((await env.KV_STORE.get(key)) || '[]');
  if (isNaN(index) || index < 0 || index >= favorites.length) return jsonResponse({ success: false, message: '无效索引' }, 400);

  favorites.splice(index, 1);
  await env.KV_STORE.put(key, JSON.stringify(favorites));
  return jsonResponse({ success: true, favorites });
}

async function handleReorderFavorites(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const { favorites } = await request.json();
    if (!Array.isArray(favorites)) return jsonResponse({ success: false, message: '无效数据' }, 400);
    const key = getFavoritesKey();
    await env.KV_STORE.put(key, JSON.stringify(favorites));
    return jsonResponse({ success: true, favorites });
  } catch (e) {
    return jsonResponse({ success: false, message: '保存顺序失败: ' + e.message }, 500);
  }
}

function getFavoritesKey() {
  return 'favorites:admin';
}

async function handleUploadFile(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return jsonResponse({ success: false, message: '没有上传文件' }, 400);

    let filePath = normalizePath(path);
    if (filePath && !filePath.endsWith('/')) filePath += '/';

    const key = filePath + file.name;
    await env.R2_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || getMimeType(file.name) }
    });
    return jsonResponse({ success: true, message: '文件上传成功', path: '/' + key });
  } catch (e) {
    return jsonResponse({ success: false, message: '文件上传失败: ' + e.message }, 500);
  }
}

async function handleDeleteFile(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const key = normalizePath(path);
    await deleteR2Folder(env, key);
    return jsonResponse({ success: true, message: '删除成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '删除失败: ' + e.message }, 500);
  }
}

async function handleRenameFile(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const { newName } = body;

    if (!newName) {
      return jsonResponse({ success: false, message: '请提供新名称' }, 400);
    }

    let oldKey = normalizePath(path);

    const parentPath = oldKey.includes('/') ? oldKey.substring(0, oldKey.lastIndexOf('/') + 1) : '';
    const newKey = parentPath + newName;

    const oldObject = await env.R2_BUCKET.get(oldKey);
    if (!oldObject) {
      return jsonResponse({ success: false, message: '文件不存在' }, 404);
    }

    await env.R2_BUCKET.put(newKey, oldObject.body, {
      httpMetadata: oldObject.httpMetadata
    });

    await env.R2_BUCKET.delete(oldKey);

    return jsonResponse({ success: true, message: '重命名成功', newPath: '/' + newKey });
  } catch (e) {
    return jsonResponse({ success: false, message: '重命名失败: ' + e.message }, 500);
  }
}

async function handleCreateFolder(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    let folderPath = normalizePath(body.path || '');
    if (!folderPath) return jsonResponse({ success: false, message: '请提供文件夹路径' }, 400);

    if (!folderPath.endsWith('/')) folderPath += '/';

    await env.R2_BUCKET.put(folderPath + '.folder', new Uint8Array(0));

    return jsonResponse({ success: true, message: '文件夹创建成功', path: '/' + folderPath.slice(0, -1) });
  } catch (e) {
    return jsonResponse({ success: false, message: '创建文件夹失败: ' + e.message }, 500);
  }
}

async function handleCreateFile(request, env) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    let { path: filePath, content } = body;
    if (!filePath) return jsonResponse({ success: false, message: '请提供文件路径' }, 400);

    filePath = normalizePath(filePath);

    const existing = await env.R2_BUCKET.get(filePath);
    if (existing) return jsonResponse({ success: false, message: '文件已存在' }, 409);

    await env.R2_BUCKET.put(filePath, new TextEncoder().encode(content || ''));

    return jsonResponse({ success: true, message: '文件创建成功', path: '/' + filePath });
  } catch (e) {
    return jsonResponse({ success: false, message: '创建文件失败: ' + e.message }, 500);
  }
}

async function serveFile(request, env, path, { download = false, cache = false } = {}) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  try {
    let key = normalizePath(path);
    const object = await env.R2_BUCKET.get(key);
    if (!object) return jsonResponse({ success: false, message: '文件不存在' }, 404);

    const filename = key.split('/').pop();
    const headers = {
      'Content-Type': object.httpMetadata?.contentType || getMimeType(filename),
      'Content-Length': object.size
    };
    if (download) headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(filename)}"`;
    if (cache) headers['Cache-Control'] = 'private, max-age=3600';
    return new Response(object.body, { headers });
  } catch (e) {
    return jsonResponse({ success: false, message: (download ? '下载' : '预览') + '失败: ' + e.message }, 500);
  }
}

async function handleEditFile(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  const key = normalizePath(path);

  if (request.method === 'GET') {
    try {
      const object = await env.R2_BUCKET.get(key);
      if (!object) return jsonResponse({ success: false, message: '文件不存在' }, 404);
      return new Response(await object.text(), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    } catch (e) {
      return jsonResponse({ success: false, message: '读取失败: ' + e.message }, 500);
    }
  }

  if (request.method === 'PUT') {
    try {
      const content = await request.text();
      await env.R2_BUCKET.put(key, content, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
      return jsonResponse({ success: true, message: '保存成功' });
    } catch (e) {
      return jsonResponse({ success: false, message: '保存失败: ' + e.message }, 500);
    }
  }

  return jsonResponse({ success: false, message: '不支持的请求方法' }, 405);
}

async function handleCheckAuth(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ authenticated: false });
  return jsonResponse({ authenticated: true });
}

// ============================================================
//  WebDAV 支持 —— 挂载在 /dav/ 路径下
// ============================================================

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rfc1123Date(d) {
  return d.toUTCString();
}

function davXmlResponse(body, status = 207) {
  const xml = '<?xml version="1.0" encoding="utf-8"?>\n' + body;
  return new Response(xml, {
    status,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
}

// WebDAV Basic Auth 验证
async function verifyDavAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    // 也尝试 Cookie JWT（方便浏览器调试）
    return await verifyAuth(request, env);
  }
  const base64 = authHeader.slice(6);
  let user, pass;
  try {
    const decoded = atob(base64);
    const colon = decoded.indexOf(':');
    user = decoded.slice(0, colon);
    pass = decoded.slice(colon + 1);
  } catch {
    return null;
  }
  if (pass !== env.ADMIN_PASSWORD) return null;
  return { role: 'admin', user };
}

function requireDavAuth(request, env, resType = 'json') {
  // 返回 WWW-Authenticate 头让客户端弹出登录框
  if (resType === 'xml') {
    return davXmlResponse(
      '<d:error xmlns:d="DAV:"><d:responsedescription>Unauthorized</d:responsedescription></d:error>',
      401
    );
  }
  return new Response(null, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="EdgeStash WebDAV", charset="UTF-8"',
      'Content-Type': 'text/plain'
    }
  });
}

// OPTIONS — 声明 WebDAV 能力
function handleDavOptions(path) {
  const headers = {
    'Allow': 'OPTIONS,GET,HEAD,PUT,DELETE,PROPFIND,MKCOL,MOVE,COPY,LOCK,UNLOCK',
    'DAV': '1, 2',
    'MS-Author-Via': 'DAV',
    'Content-Length': '0'
  };
  return new Response(null, { status: 200, headers });
}

// PROPFIND — 列出文件和文件夹
async function handleDavPropfind(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, env, 'xml');

  try {
    const depth = request.headers.get('Depth') || 'infinity';
    const baseUrl = new URL(request.url).origin + '/dav/';

    // 先检查路径是否是文件 —— 文件路径的 PROPFIND 返回单文件属性
    const fileObj = davPath ? await env.R2_BUCKET.get(davPath) : null;
    if (fileObj) {
      const name = davPath.split('/').pop();
      const mtime = fileObj.uploaded || new Date();
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${xmlEscape(baseUrl + davPath)}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(name)}</d:displayname>
        <d:resourcetype/>
        <d:getlastmodified>${rfc1123Date(new Date(mtime))}</d:getlastmodified>
        <d:getcontentlength>${fileObj.size || 0}</d:getcontentlength>
        <d:getetag>"${fileObj.etag || ''}"</d:getetag>
        <d:getcontenttype>${xmlEscape(fileObj.httpMetadata?.contentType || 'application/octet-stream')}</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
    }

    // 目录路径 —— 列出内容
    const prefix = davPath ? davPath + '/' : '';
    const objects = [];
    let folders = new Set();
    let cursor;
    do {
      const batch = await env.R2_BUCKET.list({
        prefix,
        delimiter: '/',
        limit: 1000,
        cursor
      });
      if (batch.objects) {
        for (const obj of batch.objects) {
          if (obj.key.endsWith('/.keep')) continue;
          objects.push(obj);
        }
      }
      if (batch.delimitedPrefixes) {
        for (const dp of batch.delimitedPrefixes) {
          const folderName = dp.replace(prefix, '').replace(/\/$/, '');
          if (folderName) folders.add(folderName);
        }
      }
      cursor = batch.truncated ? batch.cursor : null;
    } while (cursor);

    let xml = '<d:multistatus xmlns:d="DAV:">\n';

    // 当前目录本身
    if (depth !== '1') {
      xml += `  <d:response>
    <d:href>${xmlEscape(baseUrl + (davPath ? davPath + '/' : ''))}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(davPath ? davPath.split('/').pop() : '/')}</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>${rfc1123Date(new Date())}</d:getlastmodified>
        <d:getcontentlength>0</d:getcontentlength>
        <d:getcontenttype>httpd/unix-directory</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>\n`;
    }

    if (depth === '0') {
      xml += '</d:multistatus>';
      return davXmlResponse(xml);
    }

    // 子文件夹
    for (const folderName of folders) {
      const folderPath = (davPath ? davPath + '/' : '') + folderName;
      xml += `  <d:response>
    <d:href>${xmlEscape(baseUrl + folderPath + '/')}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(folderName)}</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getlastmodified>${rfc1123Date(new Date())}</d:getlastmodified>
        <d:getcontentlength>0</d:getcontentlength>
        <d:getcontenttype>httpd/unix-directory</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>\n`;
    }

    // 子文件
    for (const obj of objects) {
      const objPath = obj.key;
      const name = objPath.split('/').pop();
      const href = baseUrl + objPath;
      const mtime = obj.uploaded || new Date();
      xml += `  <d:response>
    <d:href>${xmlEscape(href)}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(name)}</d:displayname>
        <d:resourcetype/>
        <d:getlastmodified>${rfc1123Date(new Date(mtime))}</d:getlastmodified>
        <d:getcontentlength>${obj.size || 0}</d:getcontentlength>
        <d:getetag>"${obj.etag || ''}"</d:getetag>
        <d:getcontenttype>${xmlEscape(obj.httpMetadata?.contentType || 'application/octet-stream')}</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>\n`;
    }

    xml += '</d:multistatus>';
    return davXmlResponse(xml);

  } catch (e) {
    return davXmlResponse(
      `<d:error xmlns:d="DAV:"><d:responsedescription>${xmlEscape(e.message)}</d:responsedescription></d:error>`,
      500
    );
  }
}

// GET —— 下载文件（WebDAV 路径）
async function handleDavGet(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, env);

  try {
    let key = davPath;
    // 如果是目录，返回 PROPFIND
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) {
      // 可能是目录
      const list = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
      if (list.objects?.length > 0 || list.delimitedPrefixes?.length > 0) {
        return handleDavPropfind(request, env, davPath);
      }
      return new Response('Not Found', { status: 404 });
    }

    const filename = key.split('/').pop();
    const headers = {
      'Content-Type': obj.httpMetadata?.contentType || getMimeType(filename),
      'Content-Length': obj.size,
      'ETag': obj.etag ? `"${obj.etag}"` : '',
      'Last-Modified': rfc1123Date(new Date(obj.uploaded))
    };

    // 支持 Range 请求
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : obj.size - 1;
        headers['Content-Range'] = `bytes ${start}-${end}/${obj.size}`;
        headers['Content-Length'] = end - start + 1;
        // R2 range 通过自定义读取实现...
        // Cloudflare Worker 环境下简单返回完整内容
      }
    }

    return new Response(obj.body, { status: 200, headers });
  } catch (e) {
    return new Response('Internal Server Error: ' + e.message, { status: 500 });
  }
}

// HEAD —— 获取文件头信息
async function handleDavHead(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, env);

  try {
    const key = davPath;
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) {
      // 检查是否是目录
      const list = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
      if (list.objects?.length > 0 || list.delimitedPrefixes?.length > 0) {
        return new Response(null, { status: 200, headers: { 'Content-Type': 'httpd/unix-directory' } });
      }
      return new Response(null, { status: 404 });
    }

    const filename = key.split('/').pop();
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || getMimeType(filename),
        'Content-Length': obj.size,
        'ETag': obj.etag ? `"${obj.etag}"` : '',
        'Last-Modified': rfc1123Date(new Date(obj.uploaded))
      }
    });
  } catch (e) {
    return new Response(null, { status: 500 });
  }
}

// PUT —— 上传文件（WebDAV raw body）
async function handleDavPut(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, env);

  try {
    const key = davPath;
    const overwrite = request.headers.get('Overwrite') !== 'F';

    // 检查目标是否是文件夹（文件夹不能被 PUT 覆盖）
    const folderCheck = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
    if (folderCheck.objects?.length > 0 || folderCheck.delimitedPrefixes?.length > 0) {
      return new Response('Target is a collection', { status: 405 });
    }

    // 检查目标文件是否已存在，若不允覆盖则返回 412
    if (!overwrite) {
      const existing = await env.R2_BUCKET.get(key);
      if (existing) return new Response(null, { status: 412 });
    }

    const contentType = request.headers.get('Content-Type') || getMimeType(key) || 'application/octet-stream';

    await env.R2_BUCKET.put(key, request.body, {
      httpMetadata: { contentType }
    });

    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('Upload failed: ' + e.message, { status: 500 });
  }
}

// DELETE —— 删除文件/文件夹
async function handleDavDelete(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, env);

  try {
    await deleteR2Folder(env, davPath);
    return new Response(null, { status: 204 });
  } catch (e) {
    return new Response('Delete failed: ' + e.message, { status: 500 });
  }
}

// MKCOL —— 创建目录
async function handleDavMkcol(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, env);

  try {
    const key = davPath;

    // 检查是否已有同名文件
    const existing = await env.R2_BUCKET.get(key);
    if (existing) {
      return new Response(null, { status: 405, headers: { 'Allow': 'GET,OPTIONS,PROPFIND' } });
    }

    // 检查目录是否已存在
    const existingDir = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
    if (existingDir.objects?.length > 0 || existingDir.delimitedPrefixes?.length > 0) {
      return new Response(null, { status: 201 }); // 目录已存在，返回成功
    }

    // R2 没有真正目录，写一个 .keep 占位文件
    const keepKey = key + '/.keep';
    await env.R2_BUCKET.put(keepKey, '', {
      httpMetadata: { contentType: 'text/plain' }
    });

    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('MKCOL failed: ' + e.message, { status: 500 });
  }
}

// MOVE —— 移动/重命名
async function handleDavMove(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, env);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    const { srcKey, dstKey } = parsed;

    const overwrite = request.headers.get('Overwrite') !== 'F';

    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (!srcObj) {
      // 源是文件夹
      const srcCheck = await env.R2_BUCKET.list({ prefix: srcKey + '/', delimiter: '/', limit: 1 });
      if (!srcCheck.objects?.length && !srcCheck.delimitedPrefixes?.length) {
        return new Response('Not Found', { status: 404 });
      }
      await copyR2Folder(env, srcKey, dstKey);
      await deleteR2Folder(env, srcKey);
      return new Response(null, { status: 201 });
    }

    // 移动单个文件
    if (!overwrite) {
      const destExists = await env.R2_BUCKET.get(dstKey);
      if (destExists) return new Response(null, { status: 412 });
    }
    await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
    await env.R2_BUCKET.delete(srcKey);
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('MOVE failed: ' + e.message, { status: 500 });
  }
}

// COPY —— 复制
async function handleDavCopy(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, env);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    const { srcKey, dstKey } = parsed;

    const overwrite = request.headers.get('Overwrite') !== 'F';
    const depth = request.headers.get('Depth') || 'infinity';

    const srcObj = await env.R2_BUCKET.get(srcKey);

    if (srcObj) {
      // 复制单个文件
      if (!overwrite) {
        const destExists = await env.R2_BUCKET.get(dstKey);
        if (destExists) return new Response(null, { status: 412 });
      }
      await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
      return new Response(null, { status: 201 });
    }

    // 检查是否是文件夹
    const srcList = await env.R2_BUCKET.list({ prefix: srcKey + '/', limit: 1 });
    if (srcList.objects?.length > 0 || srcList.delimitedPrefixes?.length > 0) {
      if (depth === '0') {
        await env.R2_BUCKET.put(dstKey + '/.keep', '', { httpMetadata: { contentType: 'text/plain' } });
        return new Response(null, { status: 201 });
      }
      await copyR2Folder(env, srcKey, dstKey);
      return new Response(null, { status: 201 });
    }

    return new Response('Not Found', { status: 404 });
  } catch (e) {
    return new Response('COPY failed: ' + e.message, { status: 500 });
  }
}

// LOCK —— 锁存根（返回 unsupported 但客户端能继续）
function handleDavLock() {
  // 部分客户端需要 LOCK 响应才能写入，返回一个假的锁 token
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:prop xmlns:d="DAV:">
  <d:lockdiscovery>
    <d:activelock>
      <d:locktype><d:write/></d:locktype>
      <d:lockscope><d:exclusive/></d:lockscope>
      <d:depth>infinity</d:depth>
      <d:timeout>Second-3600</d:timeout>
      <d:locktoken>
        <d:href>urn:uuid:00000000-0000-0000-0000-000000000000</d:href>
      </d:locktoken>
    </d:activelock>
  </d:lockdiscovery>
</d:prop>`;
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Lock-Token': '<urn:uuid:00000000-0000-0000-0000-000000000000>' }
  });
}

// UNLOCK —— 解锁存根
function handleDavUnlock() {
  return new Response(null, { status: 204 });
}

const CSS_STYLES = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --primary: #007AFF;
    --primary-hover: #0062cc;
    --background: #f5f5f7;
    --surface: #ffffff;
    --surface-hover: #f9f9fb;
    --border: rgba(0,0,0,0.08);
    --border-strong: rgba(0,0,0,0.12);
    --text: #1d1d1f;
    --text-muted: #86868b;
    --text-placeholder: #c7c7cc;
    --success: #34c759;
    --warning: #ff9500;
    --error: #ff3b30;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
    --shadow: 0 2px 8px rgba(0,0,0,0.08);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
    --radius-sm: 8px;
    --radius: 12px;
    --radius-lg: 16px;
    --radius-xl: 20px;
    --blur: saturate(180%) blur(20px);
    --transition: 0.2s cubic-bezier(0.25, 0.1, 0.25, 1);
  }

  [data-theme="dark"] {
    --primary: #0A84FF;
    --primary-hover: #409cff;
    --background: #000000;
    --surface: #1c1c1e;
    --surface-hover: #2c2c2e;
    --border: rgba(255,255,255,0.1);
    --border-strong: rgba(255,255,255,0.16);
    --text: #f5f5f7;
    --text-muted: #98989d;
    --text-placeholder: #636366;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.4);
    --shadow: 0 2px 8px rgba(0,0,0,0.5);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.6);
  }

  /* Theme Toggle Button */
  .theme-toggle {
    background: none; border: 1px solid var(--border); border-radius: 50%;
    width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 16px; color: var(--text); transition: all var(--transition);
    flex-shrink: 0;
  }
  .theme-toggle:hover { background: var(--surface-hover); }

  /* Dark Mode Overrides */
  [data-theme="dark"] .header { background: rgba(28,28,30,0.72); }
  [data-theme="dark"] .btn-secondary { background: rgba(255,255,255,0.08); }
  [data-theme="dark"] .btn-secondary:hover { background: rgba(255,255,255,0.14); }
  [data-theme="dark"] .login-container { background: #000; }
  [data-theme="dark"] .preview-text, [data-theme="dark"] .preview-markdown { background: #2c2c2e; color: #f5f5f7; }
  [data-theme="dark"] .preview-markdown code { background: rgba(255,255,255,0.08); }
  [data-theme="dark"] .loading-overlay { background: rgba(0,0,0,0.5); }
  [data-theme="dark"] .view-toggle { background: rgba(255,255,255,0.06); }
  [data-theme="dark"] .view-toggle-btn { color: var(--text-muted); }
  [data-theme="dark"] .upload-overlay { background: rgba(10,132,255,0.08); }
  [data-theme="dark"] .context-menu { background: rgba(28,28,30,0.95); }
  [data-theme="dark"] .file-list-header { background: rgba(255,255,255,0.04); }
  [data-theme="dark"] tr:hover { background: rgba(255,255,255,0.04); }
  [data-theme="dark"] .tabs { background: rgba(255,255,255,0.04); }
  [data-theme="dark"] .preview-header { background: rgba(28,28,30,0.95); }
  [data-theme="dark"] .preview-filename { color: #f5f5f7; }
  [data-theme="dark"] .editor-statusbar { background: #0A84FF; }
  [data-theme="dark"] .form-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2398989d' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif;
    background: var(--background);
    color: var(--text);
    min-height: 100vh;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .main-layout { display: flex; max-width: 1200px; margin: 0 auto; padding: 24px; gap: 20px; min-height: calc(100vh - 61px); }
  .sidebar { width: 200px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
  .sidebar-title { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; padding: 4px 12px 8px; }
  .sidebar-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; color: var(--text); transition: all var(--transition); position: relative; }
  .sidebar-item:hover { background: var(--surface-hover); }
  .sidebar-item.active { background: rgba(0,122,255,0.1); color: var(--primary); font-weight: 500; }
  .sidebar-item-icon { font-size: 14px; flex-shrink: 0; opacity: 0.6; }
  .sidebar-item.active .sidebar-item-icon { opacity: 1; }
  .sidebar-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sidebar-item-remove { display: none; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 4px; line-height: 1; flex-shrink: 0; }
  .sidebar-item:hover .sidebar-item-remove { display: block; }
  .sidebar-item-remove:hover { background: rgba(255,59,48,0.12); color: var(--error); }
  .sidebar-add { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; color: var(--text-muted); transition: all var(--transition); background: none; border: none; font-family: inherit; width: 100%; text-align: left; margin-top: 4px; }
  .sidebar-add:hover { background: var(--surface-hover); color: var(--primary); }
  .sidebar-item[draggable="true"] { cursor: grab; }
  .sidebar-item-dragging { opacity: 0.4; cursor: grabbing; }
  .sidebar-item-drop-target { background: rgba(0,122,255,0.12); border-radius: var(--radius-sm); }
  .sidebar-divider { height: 1px; background: var(--border); margin: 8px 12px; }
  .main-content { flex: 1; min-width: 0; }
  .container { padding: 0; }

  /* Buttons */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 8px 18px; border: none; border-radius: var(--radius-sm);
    font-size: 13px; font-weight: 500; cursor: pointer;
    transition: all var(--transition); text-decoration: none;
    font-family: inherit; letter-spacing: -0.01em;
  }
  .btn-primary {
    background: var(--primary); color: #fff;
  }
  .btn-primary:hover {
    background: var(--primary-hover); box-shadow: 0 2px 8px rgba(0,122,255,0.3);
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: rgba(0,0,0,0.04); color: var(--text);
  }
  .btn-secondary:hover {
    background: rgba(0,0,0,0.08);
  }
  .btn-danger {
    background: var(--error); color: #fff;
  }
  .btn-danger:hover {
    background: #e0352b;
  }
  .btn-sm { padding: 5px 12px; font-size: 12px; }

  /* Forms */
  .form-group { margin-bottom: 18px; }
  .form-label {
    display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;
    color: var(--text-muted);
  }
  .form-input, .form-select {
    width: 100%; padding: 10px 14px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text); font-size: 14px;
    transition: all var(--transition); font-family: inherit;
  }
  .form-input:focus, .form-select:focus {
    outline: none; border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(0,122,255,0.15);
  }
  .form-select { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2386868b' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; }

  /* Cards */
  .card {
    padding: 0; position: relative;
  }
  .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .card-title { font-size: 18px; font-weight: 600; }

  /* Header */
  .header {
    background: rgba(255,255,255,0.72); backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    padding: 12px 24px; display: flex; align-items: center;
    justify-content: space-between; border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 100;
  }
  .logo {
    font-size: 20px; font-weight: 700; color: var(--text);
    letter-spacing: -0.02em;
  }
  .header-actions { display: flex; gap: 8px; }

  /* Search */
  .search-group { display: flex; align-items: stretch; flex: 1; max-width: 420px; margin: 0 16px; position: relative; }
  .search-box { position: relative; flex: 1; }
  .search-input {
    width: 100%; padding: 7px 36px 7px 14px; background: var(--surface-hover); border: 1px solid var(--border);
    border-radius: 20px 0 0 20px; color: var(--text); font-size: 13px; outline: none;
    transition: all var(--transition); font-family: inherit;
    -webkit-appearance: none;
  }
  .search-input::placeholder { color: var(--text-placeholder); }
  .search-input:focus { background: var(--surface); border-color: var(--primary); box-shadow: 0 0 0 3px rgba(0,122,255,0.12); }
  .search-clear {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    width: 20px; height: 20px; border: none; background: var(--surface-hover); color: var(--text-muted);
    border-radius: 50%; cursor: pointer; font-size: 14px; line-height: 1; display: none;
    align-items: center; justify-content: center; padding: 0; transition: all var(--transition);
  }
  .search-clear:hover { background: var(--border); color: var(--text); }
  .search-mode-select {
    background: var(--surface-hover); border: 1px solid var(--border); border-left: none;
    border-radius: 0 20px 20px 0; color: var(--text-muted); font-size: 12px;
    padding: 0 12px; cursor: pointer; outline: none; appearance: none;
    font-family: inherit; white-space: nowrap; transition: all var(--transition);
  }
  .search-mode-select:focus { border-color: var(--primary); }
  .search-group:focus-within .search-mode-select { border-color: var(--primary); }
  .search-mode-select:hover { background: var(--surface); }
  .search-input:focus ~ .search-clear { background: var(--surface); }
  .search-results {
    display: none; position: absolute; top: 100%; left: 0; right: 0; margin-top: 6px;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: var(--shadow-lg); max-height: 360px; overflow-y: auto; z-index: 200;
    animation: fadeIn 0.15s ease;
  }
  .search-results.active { display: block; }
  .search-result-item {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer;
    transition: background var(--transition); font-size: 13px; border-bottom: 1px solid var(--border);
  }
  .search-result-item:last-child { border-bottom: none; }
  .search-result-item:hover { background: var(--surface-hover); }
  .search-result-item.search-focus { background: var(--surface-hover); outline: 2px solid var(--primary); outline-offset: -2px; border-radius: 4px; }
  .search-result-icon { font-size: 18px; flex-shrink: 0; opacity: 0.7; }
  .search-result-info { flex: 1; min-width: 0; }
  .search-result-name { font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-result-path { font-size: 11px; color: var(--text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-result-size { font-size: 12px; color: var(--text-muted); flex-shrink: 0; }
  .search-empty { padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px; }
  .search-result-name mark { background: rgba(0,122,255,0.15); color: var(--primary); font-weight: 600; border-radius: 2px; padding: 0 1px; }

  /* Breadcrumb */
  .breadcrumb {
    display: flex; align-items: center; gap: 2px;
    padding: 4px 0; flex-wrap: wrap; font-size: 14px;
  }
  .breadcrumb-item { color: var(--text-muted); text-decoration: none; transition: color var(--transition); }
  .breadcrumb-item:hover { color: var(--primary); }
  .breadcrumb-item.active { color: var(--text); font-weight: 500; }
  .breadcrumb-separator { color: var(--border-strong); margin: 0 2px; }

  /* Nav Buttons (Back/Forward) */
  .nav-btn {
    width: 26px; height: 26px; border: 1px solid var(--border);
    border-radius: var(--radius-sm); background: var(--surface);
    cursor: pointer; font-size: 12px; color: var(--text);
    display: inline-flex; align-items: center; justify-content: center;
    transition: all var(--transition);
  }
  .nav-btn:hover:not(:disabled) { background: rgba(0,122,255,0.1); color: var(--primary); border-color: var(--primary); }
  .nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  /* File Grid */
  .file-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px; min-height: 200px; position: relative;
  }
  .file-grid.drag-over {
    background: rgba(0,122,255,0.04); border: 2px dashed var(--primary);
    border-radius: var(--radius-lg);
  }
  .file-grid.drag-over::before {
    content: '📦 拖放文件到此处上传'; position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%); font-size: 16px; font-weight: 500;
    color: var(--primary); pointer-events: none; z-index: 100;
  }

  .file-item {
    background: var(--surface); border-radius: var(--radius);
    padding: 10px 8px; cursor: pointer; transition: all var(--transition);
    border: 1px solid var(--border); position: relative;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .file-item:hover {
    border-color: rgba(0,122,255,0.3); box-shadow: var(--shadow);
    transform: translateY(-1px);
  }
  .file-item.selected {
    border-color: var(--primary); background: rgba(0,122,255,0.06);
    box-shadow: 0 0 0 3px rgba(0,122,255,0.12);
  }
  .file-item.selected:hover { transform: translateY(0); }
  .file-item.selected::before {
    content: '✓'; position: absolute; top: 6px; left: 6px;
    width: 20px; height: 20px; background: var(--primary); color: #fff;
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700;
  }
  .file-icon { font-size: 32px; text-align: center; }
  .file-name {
    font-size: 12px; font-weight: 500; text-align: center;
    word-break: break-all; line-height: 1.3;
  }
  .file-meta {
    font-size: 11px; color: var(--text-muted); text-align: center;
  }

  /* View Toggle */
  .view-toggle {
    display: flex; background: rgba(0,0,0,0.04); border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .view-toggle-btn {
    padding: 7px 12px; border: none; background: transparent;
    color: var(--text-muted); cursor: pointer; font-size: 15px;
    transition: all var(--transition); line-height: 1;
  }
  .view-toggle-btn:hover { color: var(--text); }
  .view-toggle-btn.active { background: var(--primary); color: #fff; }

  /* List View */
  .file-list { display: block !important; min-height: auto; }
  .file-list .file-item {
    display: grid; grid-template-columns: 36px 1fr 100px 80px 70px; align-items: center;
    gap: 8px; padding: 6px 12px; border-radius: 0; border-bottom: 1px solid var(--border);
    transition: background var(--transition); flex-direction: row;
  }
  .file-list .file-item:first-child { border-top: 1px solid var(--border); }
  .file-list .file-item:hover { background: var(--surface-hover); transform: none; border-color: transparent; border-bottom-color: var(--border); box-shadow: none; }
  .file-list .file-item.selected { background: rgba(0,122,255,0.06); border-color: transparent; border-bottom-color: var(--primary); box-shadow: none; }
  .file-list .file-icon { font-size: 20px; margin: 0; }
  .file-list .file-name { text-align: left; word-break: break-all; }
  .file-list .file-meta { text-align: right; white-space: nowrap; font-size: 12px; }
  .file-list-header {
    display: grid; grid-template-columns: 36px 1fr 100px 80px 70px; align-items: center;
    gap: 8px; padding: 6px 12px; background: rgba(0,0,0,0.02);
    border-bottom: 1px solid var(--border-strong); font-size: 10px; font-weight: 600;
    color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em;
  }
  .sortable-header { transition: color var(--transition); }
  .sortable-header:hover { color: var(--primary); }
  .sortable-header.active { color: var(--primary); }

  /* Toolbar */
  .toolbar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
  .selection-info {
    margin-left: auto; padding: 6px 14px; background: var(--primary);
    color: #fff; border-radius: 20px; font-size: 12px; font-weight: 500;
    display: none; animation: fadeIn 0.2s ease;
  }
  .selection-info.active { display: inline-block; }

  /* Modal */
  .modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.3); backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; opacity: 0; visibility: hidden; transition: all 0.25s ease;
  }
  .modal-overlay.active { opacity: 1; visibility: visible; }
  .modal {
    background: var(--surface); border-radius: var(--radius-xl);
    padding: 28px; width: 90%; max-width: 480px;
    transform: scale(0.95); transition: all 0.25s cubic-bezier(0.25,0.1,0.25,1);
    max-height: 85vh; overflow-y: auto; box-shadow: var(--shadow-lg);
  }
  .modal-overlay.active .modal { transform: scale(1); }
  .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .modal-title { font-size: 18px; font-weight: 600; }
  .modal-close {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; font-size: 22px; padding: 0; line-height: 1;
    width: 28px; height: 28px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; transition: all var(--transition);
  }
  .modal-close:hover { background: rgba(0,0,0,0.06); color: var(--text); }

  /* Preview */
  .preview-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.92); display: flex; flex-direction: column;
    z-index: 2000; opacity: 0; visibility: hidden; transition: all 0.3s ease;
  }
  .preview-overlay.active { opacity: 1; visibility: visible; }
  .preview-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 24px; background: rgba(255,255,255,0.95);
    backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
    border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .preview-filename { font-size: 15px; font-weight: 600; color: #1d1d1f; }
  .preview-actions { display: flex; gap: 8px; }
  .preview-content {
    flex: 1; overflow: auto; display: flex; align-items: center;
    justify-content: center; padding: 20px;
  }
  .preview-image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--radius-sm); }
  .preview-text {
    width: 100%; height: 100%; background: #f8f8fa; border-radius: var(--radius-sm);
    padding: 24px; overflow: auto; font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;
    color: #1d1d1f;
  }
  .preview-pdf { width: 100%; height: 100%; border: none; border-radius: var(--radius-sm); }
  .preview-video, .preview-audio { max-width: 100%; max-height: 100%; }
  .preview-markdown {
    width: 100%; max-width: 900px; height: 100%;
    background: #f8f8fa; border-radius: var(--radius-sm);
    padding: 40px; overflow: auto; line-height: 1.8; color: #1d1d1f;
  }
  .preview-markdown h1, .preview-markdown h2, .preview-markdown h3 { margin-top: 24px; margin-bottom: 16px; }
  .preview-markdown p, .preview-markdown pre, .preview-markdown ul, .preview-markdown ol, .preview-markdown table { margin-bottom: 16px; }
  .preview-markdown code { background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', 'Menlo', monospace; font-size: 13px; }
  .preview-markdown pre { background: #1d1d1f; color: #f5f5f7; padding: 16px; border-radius: var(--radius-sm); overflow-x: auto; }
  .preview-markdown pre code { background: none; padding: 0; color: inherit; }
  .preview-markdown blockquote { border-left: 3px solid var(--primary); padding-left: 16px; margin: 16px 0; color: var(--text-muted); }
  .preview-markdown ul, .preview-markdown ol { padding-left: 24px; }
  .preview-markdown li { margin-bottom: 6px; }
  .preview-markdown a { color: var(--primary); }
  .preview-markdown img { max-width: 100%; border-radius: var(--radius-sm); }
  .preview-markdown table { width: 100%; border-collapse: collapse; }
  .preview-markdown th, .preview-markdown td { border: 1px solid var(--border); padding: 8px 12px; }
  .preview-loading { display: flex; flex-direction: column; align-items: center; gap: 16px; color: rgba(255,255,255,0.8); }
  .preview-error { text-align: center; color: var(--error); }

  /* Toast */
  .toast-container { position: fixed; top: 20px; right: 20px; z-index: 3000; display: flex; flex-direction: column; gap: 8px; }
  .toast {
    padding: 14px 18px; border-radius: var(--radius-sm); color: #fff; font-size: 14px;
    font-weight: 500; animation: slideIn 0.3s ease; display: flex;
    align-items: center; gap: 8px; min-width: 280px;
    box-shadow: var(--shadow-lg);
  }
  .toast-success { background: var(--success); }
  .toast-error { background: var(--error); }
  .toast-info { background: var(--primary); }
  .toast-warning { background: var(--warning); }

  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes selectPulse { 0% { background: rgba(0,122,255,0.08); } 50% { background: rgba(0,122,255,0.25); } 100% { background: transparent; } }

  /* Tabs */
  .tabs {
    display: flex; gap: 4px; background: rgba(0,0,0,0.04); padding: 4px;
    border-radius: var(--radius); margin-bottom: 24px;
  }
  .tab {
    flex: 1; padding: 10px 20px; border: none; background: transparent;
    color: var(--text-muted); font-size: 14px; font-weight: 500;
    cursor: pointer; border-radius: var(--radius-sm); transition: all var(--transition);
    font-family: inherit;
  }
  .tab.active { background: var(--primary); color: #fff; }
  .tab:hover:not(.active) { color: var(--text); }
  .tab-content { display: none; }
  .tab-content.active { display: block; animation: fadeIn 0.25s ease; }

  /* Badge */
  .badge {
    display: inline-block; padding: 3px 8px; border-radius: 12px;
    font-size: 11px; font-weight: 600;
  }
  .badge-success { background: rgba(52,199,89,0.12); color: var(--success); }
  .badge-error { background: rgba(255,59,48,0.12); color: var(--error); }
  .badge-info { background: rgba(0,122,255,0.12); color: var(--primary); }

  /* Login container */
  .login-container {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(180deg, #f5f5f7 0%, #e8e8ed 100%); padding: 20px;
  }
  .login-card {
    background: var(--surface); border-radius: var(--radius-xl);
    padding: 40px; width: 100%; max-width: 420px;
    box-shadow: var(--shadow-lg); border: 1px solid var(--border);
  }
  .login-header { text-align: center; margin-bottom: 32px; }
  .login-logo { font-size: 28px; font-weight: 700; color: var(--text); margin-bottom: 4px; letter-spacing: -0.02em; }
  .login-subtitle { color: var(--text-muted); font-size: 15px; }

  /* Empty State */
  .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
  .empty-icon { font-size: 56px; margin-bottom: 12px; opacity: 0.4; }

  /* Loading */
  .spinner {
    width: 36px; height: 36px; border: 3px solid rgba(0,0,0,0.08);
    border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(245,245,247,0.7); backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 3000;
  }

  /* Upload */
  .upload-overlay {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,122,255,0.06); border: 2px dashed var(--primary);
    border-radius: var(--radius-lg); display: none; align-items: center;
    justify-content: center; z-index: 1000; pointer-events: none;
  }
  .upload-overlay.active { display: flex; }
  .upload-overlay-text { font-size: 22px; font-weight: 600; color: var(--primary); }
  .upload-progress-container {
    position: fixed; bottom: 24px; right: 24px; background: var(--surface);
    border-radius: var(--radius-lg); padding: 18px 24px;
    box-shadow: var(--shadow-lg); min-width: 320px; max-width: 400px;
    z-index: 2000; display: none; border: 1px solid var(--border);
  }
  .upload-progress-container.active { display: block; animation: slideIn 0.3s ease; }
  .upload-progress-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .upload-progress-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .upload-progress-close {
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    font-size: 18px; padding: 0; line-height: 1; width: 24px; height: 24px;
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
  }
  .upload-progress-close:hover { background: rgba(0,0,0,0.05); color: var(--text); }
  .upload-progress-bar { height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden; margin-bottom: 12px; }
  .upload-progress-fill {
    height: 100%; background: var(--primary); border-radius: 3px;
    transition: width 0.3s ease; width: 0%;
  }
  .upload-progress-info { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text-muted); }
  .upload-progress-filename { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .upload-progress-percentage { font-weight: 600; color: var(--primary); }

  /* Context Menu */
  .context-menu {
    position: fixed; background: rgba(255,255,255,0.95);
    backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
    border-radius: var(--radius); padding: 6px 0; min-width: 180px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.15); z-index: 1500;
    display: none; animation: fadeIn 0.12s ease;
    border: 1px solid var(--border);
  }
  .context-menu.active { display: block; }
  .context-menu-item {
    padding: 9px 16px; cursor: pointer; display: flex; align-items: center;
    gap: 10px; transition: background var(--transition); font-size: 13px;
  }
  .context-menu-item:hover { background: rgba(0,122,255,0.06); color: var(--primary); }
  .context-menu-item.danger:hover { background: rgba(255,59,48,0.06); color: var(--error); }
  .context-menu-divider { height: 1px; background: var(--border); margin: 4px 0; }

  /* Ace Editor */
  .editor-tool-btn {
    background: none; border: none; color: #86868b; cursor: pointer;
    font-size: 13px; padding: 3px 7px; border-radius: 4px; line-height: 1;
    font-family: inherit; transition: all var(--transition);
  }
  .editor-tool-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
  .editor-modal-overlay { z-index: 1100; align-items: center; justify-content: center; }
  .editor-window {
    display: flex; flex-direction: column; width: 90vw; height: 85vh;
    min-width: 600px; min-height: 400px; background: #1e1e1e;
    border-radius: var(--radius); box-shadow: 0 8px 40px rgba(0,0,0,0.4);
    overflow: hidden; position: relative;
  }
  .editor-toolbar {
    display: flex; align-items: center; gap: 4px; padding: 5px 10px;
    background: #2d2d2d; border-bottom: 1px solid #404040;
    user-select: none; cursor: move; flex-shrink: 0;
  }
  .editor-toolbar-spacer { flex: 1; }
  .editor-toolbar-sep { width: 1px; background: #404040; height: 18px; margin: 0 4px; }
  .editor-filename {
    font-size: 12px; color: #ccc; padding: 0 8px; min-width: 120px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default;
  }
  .editor-dirty { color: var(--warning); font-size: 12px; cursor: default; }
  .editor-fs-label { color: #999; font-size: 11px; cursor: default; min-width: 20px; text-align: center; }
  .editor-save-btn { color: #64d2ff; }
  .editor-body { flex: 1; min-height: 0; }
  .editor-statusbar {
    display: flex; gap: 16px; padding: 3px 12px; background: var(--primary);
    color: #fff; font-size: 11px; font-family: 'SF Mono', monospace; flex-shrink: 0; user-select: none;
  }
  .editor-status-encoding { margin-left: auto; }
  .editor-resize-handle {
    position: absolute; right: 0; bottom: 20px; width: 14px; height: 14px;
    cursor: nwse-resize; background: linear-gradient(135deg, transparent 50%, #555 50%); z-index: 2;
  }

  /* Responsive */

  /* Mobile sidebar toggle – hidden on desktop */
  .sidebar-toggle { display: none; }
  .sidebar-backdrop { display: none; }
  .mobile-upload-bar { display: none; }

  @media (max-width: 768px) {
    html { font-size: 15px; }
    body { -webkit-tap-highlight-color: transparent; }

    /* Header – stack + compact */
    .header { padding: 10px 14px; gap: 8px; flex-wrap: wrap; }
    .logo { font-size: 18px; white-space: nowrap; }
    .search-group { max-width: 100%; width: 100%; margin: 0; order: 3; }
    .header-actions { width: auto; gap: 4px; }
    .header-actions .btn { padding: 6px 12px; font-size: 12px; }

    /* Sidebar – hide by default, toggle via JS */
    .sidebar {
      position: fixed; top: 0; left: 0; bottom: 0; z-index: 500;
      width: 260px; background: var(--surface); box-shadow: var(--shadow-lg);
      flex-direction: column; padding: 60px 12px 20px; gap: 2px;
      transform: translateX(-100%); transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
      overflow-y: auto;
    }
    .sidebar.open { transform: translateX(0); }
    .sidebar-title { display: block; padding: 12px 8px 6px; font-size: 11px; }
    .sidebar-item { padding: 10px 12px; font-size: 14px; width: 100%; }
    .sidebar-divider { display: block; margin: 8px 8px; }
    .sidebar-add { margin-top: 4px; font-size: 13px; padding: 10px 12px; }
    .sidebar-backdrop {
      display: none; position: fixed; inset: 0; z-index: 499;
      background: rgba(0,0,0,0.3); backdrop-filter: blur(2px);
    }
    .sidebar-backdrop.active { display: block; }

    /* Hamburger menu button */
    .sidebar-toggle {
      display: flex; width: 36px; height: 36px; border: 1px solid var(--border);
      border-radius: var(--radius-sm); background: var(--surface);
      cursor: pointer; align-items: center; justify-content: center;
      font-size: 18px; color: var(--text); transition: all var(--transition);
      flex-shrink: 0;
    }
    .sidebar-toggle:hover { background: var(--surface-hover); }

    .main-layout { flex-direction: column; padding: 0; gap: 0; }
    .main-content { width: 100%; }

    /* Toolbar – hidden on mobile */
    .toolbar { display: none; }

    /* Container */
    .container { padding: 0; }

    /* File grid – 2 columns for mobile */
    .file-grid:not(.file-list) { grid-template-columns: repeat(2, 1fr); gap: 4px; min-height: 100px; }
    .file-item { padding: 5px 4px; gap: 1px; }
    .file-item .file-icon { font-size: 28px; }
    .file-item .file-name { font-size: 18px; line-height: 1.3; }

    /* List view */
    .file-list .file-item { grid-template-columns: 40px 1fr 68px 50px; gap: 8px; padding: 8px 10px; align-items: center; }
    .file-list-header { grid-template-columns: 40px 1fr 68px 50px; gap: 8px; padding: 4px 10px; font-size: 12px; }
    .file-list .file-icon { font-size: 28px; flex-shrink: 0; }
    .file-list .file-name { font-size: 16px; word-break: break-word; overflow-wrap: anywhere; line-height: 1.3; }
    .file-list .file-meta { font-size: 12px; text-align: right; flex-shrink: 0; }
    .file-list .file-meta:last-child { display: none; }
    .file-list-header > *:nth-child(4) { text-align: right; }
    .file-list-header > *:nth-child(5) { display: none; }

    /* Breadcrumb */
    .breadcrumb { font-size: 12px; padding: 4px 12px; }

    /* Modals */
    .modal { padding: 20px; width: 94%; max-width: 100%; border-radius: var(--radius-lg); }
    .modal-title { font-size: 16px; }
    .modal-overlay { align-items: flex-end; }
    .modal-overlay .modal {
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      max-height: 90vh; margin-bottom: 0;
    }

    /* Login cards */
    .login-card { padding: 28px 20px; max-width: 100%; margin: 0 8px; border-radius: var(--radius-lg); }
    .login-container { padding: 12px; align-items: flex-start; padding-top: 10vh; }

    /* Preview overlay */
    .preview-header { padding: 10px 14px; gap: 8px; }
    .preview-filename { font-size: 14px; }
    .preview-overlay .btn { padding: 6px 12px; font-size: 12px; }

    /* Buttons – touch friendly */
    .btn { min-height: 40px; }
    .btn-sm { min-height: 32px; padding: 4px 10px; font-size: 11px; }
    .modal-close { width: 36px; height: 36px; font-size: 24px; }

    /* Form inputs */
    .form-input, .form-select { padding: 10px 12px; font-size: 16px; }

    /* Card – full width */
    .card { padding: 12px 8px; border-radius: 0; border: none; box-shadow: none; }

    /* Footer upload bar (fixed bottom) */
    .mobile-upload-bar {
      display: flex; position: fixed; bottom: 0; left: 0; right: 0;
      padding: 10px 14px; padding-bottom: max(10px, env(safe-area-inset-bottom));
      background: var(--surface); border-top: 1px solid var(--border);
      box-shadow: 0 -2px 10px rgba(0,0,0,0.06); z-index: 300;
      gap: 8px;
    }
    .mobile-upload-bar .btn { flex: 1; }
  }

</style>`;

const SHARED_SCRIPTS = 
`    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('active');
    }

    function showLoading(show) {
      document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      document.querySelectorAll('.theme-toggle').forEach(function(btn) {
        btn.textContent = next === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
      });
    }
    (function initThemeIcon() {
      var icon = document.querySelector('.theme-toggle');
      if (icon) {
        icon.textContent = (document.documentElement.getAttribute('data-theme') === 'dark') ? '\u2600\uFE0F' : '\uD83C\uDF19';
      }
    })();

    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebarBackdrop').classList.toggle('active');
    }

    async function logout() {
      try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
      window.location.href = '/login.html';
    }

    async function apiCall(url, options, successMsg, onSuccess) {
      showLoading(true);
      try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (data.success) { showToast(successMsg, 'success'); if (onSuccess) await onSuccess(); }
        else { showToast(data.message || '操作失败', 'error'); }
      } catch (error) { showToast('操作失败: ' + error.message, 'error'); }
      finally { showLoading(false); }
    }`;

const LOGIN_PAGE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录</title>
  <script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t)})()</script>
  ${CSS_STYLES}
</head>
<body>
  <div class="login-container">
    <button class="theme-toggle" onclick="toggleTheme()" title="切换主题" style="position:fixed;top:16px;right:16px;z-index:10;"></button>
    <div class="login-card">
      <form onsubmit="return handleLogin(event)">
        <input type="text" class="form-input" placeholder="账号" style="margin-bottom:12px">
        <input type="password" id="password" class="form-input" placeholder="密码" autofocus style="margin-bottom:16px">
        <button type="submit" class="btn btn-primary" style="width:100%;" id="loginBtn">登录</button>
      </form>
    </div>
  </div>
  <div class="toast-container" id="toastContainer"></div>
  <script>
    function toast(m,t){var e=document.getElementById('toastContainer'),n=document.createElement('div');n.className='toast toast-'+(t||'info');n.textContent=m;e.appendChild(n);setTimeout(function(){n.remove()},3000)}
    function toggleTheme(){var h=document.documentElement,c=h.getAttribute('data-theme')||'light',n=c==='dark'?'light':'dark';h.setAttribute('data-theme',n);localStorage.setItem('theme',n);document.querySelectorAll('.theme-toggle').forEach(function(b){b.textContent=n==='dark'?'☀️':'🌙'})}
    (function(){var b=document.querySelector('.theme-toggle');if(b)b.textContent=(document.documentElement.getAttribute('data-theme')==='dark')?'☀️':'🌙'})();
    async function handleLogin(e){
      e.preventDefault();
      var p=document.getElementById('password').value;
      if(!p)return toast('请输入密码','error');
      var btn=document.getElementById('loginBtn');
      btn.disabled=!0;btn.textContent='登录中...';
      try{
        var r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p})});
        var d=await r.json();
        if(d.success){toast('登录成功','success');window.location.href='/'}
        else toast(d.message||'登录失败','error')
      }catch(e){toast('登录失败: '+e.message,'error')}
      finally{btn.disabled=!1;btn.textContent='登录'}
    }
  </script>
</body>
</html>
`;

const INDEX_PAGE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>云盘</title>
  <script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t)})()</script>
  ${CSS_STYLES}
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/ace-builds@1.32.9/src-min-noconflict/ace.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/ace-builds@1.32.9/src-min-noconflict/ext-modelist.js"></script>
</head>
<body>
  <div class="header">
    <button class="sidebar-toggle" id="sidebarToggle" onclick="toggleSidebar()" aria-label="菜单">☰</button>
    <div class="logo">网盘</div>
    <div class="search-group">
      <div class="search-box" id="searchBox">
        <input type="text" class="search-input" id="searchInput" placeholder="搜索文件..." autocomplete="off" oninput="handleSearch(event)" onkeydown="handleSearchKey(event)" onfocus="handleSearch(event)">
        <button class="search-clear" id="searchClear" onclick="clearSearch()">×</button>
        <div class="search-results" id="searchResults"></div>
      </div>
      <select class="search-mode-select" id="searchMode" title="搜索模式">
        <option value="quick">快速</option>
        <option value="full">全量</option>
      </select>
    </div>
    <div class="header-actions">
      <button class="theme-toggle" onclick="toggleTheme()" title="切换主题"></button>
      <button class="btn btn-secondary" onclick="logout()">退出</button>
    </div>
  </div>

  <div class="main-layout">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-title">收藏夹</div>
      <div class="sidebar-item" data-path="/" onclick="navigateTo('/')">
        <span class="sidebar-item-icon">🏠</span>
        <span class="sidebar-item-name">根目录</span>
      </div>
      <div id="favoritesList"></div>
      <div class="sidebar-divider"></div>
      <button class="sidebar-add" onclick="addFavorite()">
        <span>+</span> <span>添加到收藏夹</span>
      </button>
    </aside>
    <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleSidebar()"></div>
    <main class="main-content">
  <div class="container">
    <div class="breadcrumb" id="breadcrumb" style="padding:4px 0;"></div>

    <div class="toolbar">
      <button class="btn btn-primary" onclick="showNewFolderModal()">
        📁 新建文件夹
      </button>
      <button class="btn btn-primary" onclick="document.getElementById('fileInput').click()">
        📤 上传文件
      </button>
      <input type="file" id="fileInput" multiple style="display: none;" onchange="handleFileUpload(event)">

      <!-- 视图切换 -->
      <div class="view-toggle" id="viewToggle">
        <button class="view-toggle-btn" onclick="toggleViewMode('card')" title="卡片视图" data-view="card">▦</button>
        <button class="view-toggle-btn active" onclick="toggleViewMode('list')" title="列表视图" data-view="list">☰</button>
      </div>

      <!-- 选中信息显示 -->
      <div id="selectionInfo" class="selection-info"></div>
    </div>

    <div class="card">
      <div class="upload-overlay" id="uploadOverlay">
        <div class="upload-overlay-text">📤 释放文件以上传</div>
      </div>
      <div id="fileList" class="file-grid"></div>
      <div id="emptyState" class="empty-state" style="display: none;">
        <div class="empty-icon">📂</div>
        <div>此文件夹为空</div>
      </div>
    </div>
  </div>
    </main>
  </div>

  <!-- Mobile Upload Bar -->
  <div class="mobile-upload-bar" id="mobileUploadBar">
    <button class="btn btn-primary" onclick="document.getElementById('fileInput').click()">📤 上传</button>
    <button class="btn btn-secondary" onclick="showNewFolderModal()">📁 新建文件夹</button>
  </div>

  <!-- New Folder Modal -->
  <div class="modal-overlay" id="newFolderModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">新建文件夹</div>
        <button class="modal-close" onclick="closeModal('newFolderModal')">&times;</button>
      </div>
      <form onsubmit="createFolder(event)">
        <div class="form-group">
          <label class="form-label">文件夹名称</label>
          <input type="text" id="folderName" class="form-input" placeholder="请输入文件夹名称" required>
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%;">创建</button>
      </form>
    </div>
  </div>

  <!-- New File Modal -->
  <div class="modal-overlay" id="newFileModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">新建文件</div>
        <button class="modal-close" onclick="closeModal('newFileModal')">&times;</button>
      </div>
      <form onsubmit="createNewFile(event)">
        <div class="form-group">
          <label class="form-label">文件名</label>
          <input type="text" id="newFileName" class="form-input" placeholder="例如: readme.txt, config.json" required>
        </div>
        <div class="form-group" style="margin-top: 8px;">
          <label class="form-label">初始内容（可选）</label>
          <textarea id="newFileContent" class="form-input" style="height: 120px; resize: vertical; font-family: monospace;" placeholder="留空则创建空文件"></textarea>
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%;">创建</button>
      </form>
    </div>
  </div>

  <!-- Rename Modal -->
  <div class="modal-overlay" id="renameModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">重命名</div>
        <button class="modal-close" onclick="closeModal('renameModal')">&times;</button>
      </div>
      <form onsubmit="renameFile(event)">
        <div class="form-group">
          <label class="form-label">新名称</label>
          <input type="text" id="renameFileName" class="form-input" required>
        </div>
        <input type="hidden" id="renameFilePath">
        <button type="submit" class="btn btn-primary" style="width: 100%;">确认</button>
      </form>
    </div>
  </div>

  <!-- Ace Editor Modal (窗口模式) -->
  <div class="modal-overlay editor-modal-overlay" id="editorModal">
    <div id="editorWindow" class="editor-window">
      <!-- 工具栏 -->
      <div id="editorToolbar" class="editor-toolbar">
        <span id="editorFilename" class="editor-filename"></span>
        <span id="editorDirtyIndicator" class="editor-dirty" style="display: none;">●</span>
        <span class="editor-toolbar-spacer"></span>
        <!-- 功能按钮组 -->
        <button class="editor-tool-btn" onclick="editorUndo()" title="撤销 (Ctrl+Z)">↩</button>
        <button class="editor-tool-btn" onclick="editorRedo()" title="重做 (Ctrl+Y)">↪</button>
        <span class="editor-toolbar-sep"></span>
        <button class="editor-tool-btn" id="editorFindBtn" onclick="editorFind()" title="查找 (Ctrl+F)">🔍</button>
        <button class="editor-tool-btn" onclick="editorGoToLine()" title="跳转到行 (Ctrl+G)">#</button>
        <span class="editor-toolbar-sep"></span>
        <button class="editor-tool-btn" onclick="changeEditorFontSize(-1)" title="缩小字号">A⁻</button>
        <span id="editorFontSizeLabel" class="editor-fs-label">14</span>
        <button class="editor-tool-btn" onclick="changeEditorFontSize(1)" title="放大字号">A⁺</button>
        <span class="editor-toolbar-sep"></span>
        <button class="editor-tool-btn" id="editorWordWrapBtn" onclick="editorToggleWordWrap()" title="切换自动换行">↩</button>
        <button class="editor-tool-btn" id="editorThemeBtn" onclick="editorToggleTheme()" title="切换主题">🌙</button>
        <button class="editor-tool-btn" id="editorWindowBtn" onclick="editorToggleFullscreen()" title="最大化/窗口">🗖</button>
        <button class="editor-tool-btn editor-save-btn" id="editorSaveBtn" onclick="saveEditor()" title="保存 (Ctrl+S)">💾 保存</button>
        <button class="editor-tool-btn" onclick="closeEditor()" title="关闭 (Esc)">✕</button>
      </div>
      <!-- 编辑器主体 -->
      <div id="aceEditorContainer" class="editor-body"></div>
      <!-- 状态栏 -->
      <div id="editorStatusBar" class="editor-statusbar">
        <span id="editorStatusMode">text</span>
        <span id="editorStatusPosition">行 1, 列 1</span>
        <span id="editorStatusIndent">空格: 2</span>
        <span id="editorStatusEncoding" class="editor-status-encoding">UTF-8</span>
      </div>
      <!-- 右下角调整大小手柄 -->
      <div class="editor-resize-handle"></div>
    </div>
  </div>

  <!-- Preview Modal -->
  <div class="preview-overlay" id="previewOverlay">
    <div class="preview-header">
      <div class="preview-filename" id="previewFilename"></div>
      <div class="preview-actions">
        <button class="btn btn-primary" id="previewDownloadBtn">下载</button>
        <button class="btn btn-secondary" onclick="closePreview()">关闭</button>
      </div>
    </div>
    <div class="preview-content" id="previewContent">
      <div class="preview-loading">
        <div class="spinner"></div>
        <div>加载中...</div>
      </div>
    </div>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <div class="loading-overlay" id="loadingOverlay" style="display: none;">
    <div class="spinner"></div>
  </div>

  <!-- 上传进度条 -->
  <div class="upload-progress-container" id="uploadProgressContainer">
    <div class="upload-progress-header">
      <div class="upload-progress-title">📤 上传进度</div>
      <button class="upload-progress-close" onclick="closeUploadProgress()">&times;</button>
    </div>
    <div class="upload-progress-bar">
      <div class="upload-progress-fill" id="uploadProgressFill"></div>
    </div>
    <div class="upload-progress-info">
      <span class="upload-progress-filename" id="uploadProgressFilename">准备上传...</span>
      <span class="upload-progress-percentage" id="uploadProgressPercentage">0%</span>
    </div>
  </div>

  <script>
    let currentPath = '/';
    let history = ['/'];
    let historyIndex = 0;
    let viewMode = localStorage.getItem('fileViewMode') || 'list';
    let sortField = localStorage.getItem('sortField') || 'name';
    let sortAscending = localStorage.getItem('sortAscending') !== 'false';

    let selectedItems = new Set();
    let lastSelectedIndex = -1;
    let isCtrlPressed = false;
    let isShiftPressed = false;

    let searchTimer = null;
    let pendingSelectFile = null;

    function handleSearch(event) {
      clearTimeout(searchTimer);
      const input = document.getElementById('searchInput');
      const q = input.value.trim();
      const results = document.getElementById('searchResults');
      const clearBtn = document.getElementById('searchClear');
      clearBtn.style.display = q ? 'flex' : 'none';
      if (!q) { results.classList.remove('active'); results.innerHTML = ''; return; }
      searchTimer = setTimeout(async () => {
        try {
          const mode = document.getElementById('searchMode').value;
          const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&mode=' + mode);
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            const modeLabel = data.mode === 'full' ? '全量' : '快速';
            const headerHtml = '<div style="padding:8px 14px;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border);">搜索模式：' + modeLabel + '（扫描 ' + (data.scannedPages ?? '?') + ' 页）</div>';
            results.innerHTML = headerHtml + data.results.map(r => \`
              <div class="search-result-item" onclick="closeSearch();navigateToFolderOrDownload('\${r.path}','\${r.name}')" oncontextmenu="event.preventDefault();closeSearch();navigateToFolderAndSelect('\${r.path}','\${r.name}');return false">
                <span class="search-result-icon">\${getFileIcon(r.name)}</span>
                <div class="search-result-info">
                  <div class="search-result-name">\${highlightMatch(r.name, q)}</div>
                  <div class="search-result-path">\${r.folder}</div>
                </div>
                <span class="search-result-size">\${r.sizeFormatted}</span>
              </div>
            \`).join('');
          } else {
            results.innerHTML = '<div class="search-empty">未找到匹配的文件</div>';
          }
          results.classList.add('active');
        } catch(e) { results.innerHTML = '<div class="search-empty">搜索出错</div>'; results.classList.add('active'); }
      }, 300);
    }

    function handleSearchKey(event) {
      if (event.key === 'Escape') { closeSearch(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); navigateSearchResults(1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); navigateSearchResults(-1); }
      if (event.key === 'Enter') { selectSearchResult(); }
    }

    function navigateSearchResults(dir) {
      const items = document.querySelectorAll('.search-result-item');
      if (!items.length) return;
      let idx = Array.from(items).findIndex(i => i.classList.contains('search-focus'));
      if (idx >= 0) items[idx].classList.remove('search-focus');
      idx = idx < 0 ? (dir > 0 ? 0 : items.length - 1) : idx + dir;
      if (idx < 0) idx = items.length - 1;
      if (idx >= items.length) idx = 0;
      items[idx].classList.add('search-focus');
      items[idx].scrollIntoView({ block: 'nearest' });
    }

    function selectSearchResult() {
      const item = document.querySelector('.search-result-item.search-focus');
      if (item) item.click();
    }

    function closeSearch() {
      document.getElementById('searchResults').classList.remove('active');
      document.getElementById('searchInput').blur();
    }

    function clearSearch() {
      const input = document.getElementById('searchInput');
      input.value = '';
      document.getElementById('searchClear').style.display = 'none';
      document.getElementById('searchResults').classList.remove('active');
      document.getElementById('searchResults').innerHTML = '';
      input.focus();
    }

    function navigateToFolderOrDownload(path, name) {
      const isFolder = name.endsWith('/') || path.endsWith('/');
      if (isFolder) { navigateTo(path); return; }
      const ext = name.split('.').pop().toLowerCase();
      let pt = 'text';
      if (/^(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/.test(ext)) pt = 'image';
      else if (ext === 'pdf') pt = 'pdf';
      else if (/^(mp4|mov|avi|mkv|webm)$/.test(ext)) pt = 'video';
      else if (/^(mp3|wav|flac|aac|ogg|m4a)$/.test(ext)) pt = 'audio';
      else if (/^(doc|docx)$/.test(ext)) pt = 'word';
      previewFile(path, pt, name);
    }

    function navigateToFolderAndSelect(path, name) {
      const lastSlash = path.lastIndexOf('/');
      const folder = lastSlash >= 0 ? path.substring(0, lastSlash + 1) : '/';
      pendingSelectFile = name;
      navigateTo(folder);
    }

    function highlightMatch(text, query) {
      const idx = text.toLowerCase().indexOf(query.toLowerCase());
      if (idx < 0) return text;
      return text.substring(0, idx) + '<mark>' + text.substring(idx, idx + query.length) + '</mark>' + text.substring(idx + query.length);
    }

    document.addEventListener('click', function(e) {
      if (!e.target.closest('.search-box')) closeSearch();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        isCtrlPressed = true;
      }
      if (e.key === 'Shift') {
        isShiftPressed = true;
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
      }
      
      if (e.key === 'Delete' && selectedItems.size > 0) {
        deleteSelected();
      }
      
      if (e.key === 'Escape') {
        clearSelection();
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        isCtrlPressed = false;
      }
      if (e.key === 'Shift') {
        isShiftPressed = false;
      }
    });

    window.addEventListener('DOMContentLoaded', function() {

      document.getElementById('breadcrumb').addEventListener('click', function(e) {
        const el = e.target.closest('[data-path]');
        if (el) { e.preventDefault(); navigateTo(el.dataset.path); }
      });

      document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewMode);
      });

      checkAuth().then(() => {
        updateNavButtons();
        // 并行加载文件和收藏夹，互不依赖，减少等待时间
        Promise.all([loadFiles(), initFavorites()]).then(() => {
          initDragUpload();
          initContextMenu();
          initMultiSelect();
        });
      });
});

let favorites = [];

async function initFavorites() {
  // 优先使用服务端嵌入数据，省掉 /api/favorites KV 读取
  if (window.__INIT__ && window.__INIT__.favorites) {
    favorites = window.__INIT__.favorites;
    renderFavorites();
    highlightCurrentFavorite();
    return;
  }
  await loadFavorites();
  renderFavorites();
  highlightCurrentFavorite();
}

async function loadFavorites() {
  try {
    const response = await fetch('/api/favorites');
    const data = await response.json();
    if (data.success) {
      favorites = data.favorites || [];
    }
  } catch (e) {
    favorites = [];
  }
}

function renderFavorites() {
  const container = document.getElementById('favoritesList');
  if (!container) return;
  if (favorites.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = favorites.map((f, i) => \`
    <div class="sidebar-item" data-path="\${f.path}" data-fav-index="\${i}" draggable="true"
         ondragstart="onFavDragStart(event, \${i})"
         ondragover="onFavDragOver(event, \${i})"
         ondragleave="onFavDragLeave(event)"
         ondrop="onFavDrop(event, \${i})"
         onclick="navigateTo('\${f.path}')">
      <span class="sidebar-item-icon">📁</span>
      <span class="sidebar-item-name">\${f.name}</span>
      <button class="sidebar-item-remove" onclick="event.stopPropagation();removeFavorite(\${i})" title="移除收藏">×</button>
    </div>
  \`).join('');
  highlightCurrentFavorite();
}

async function addFavorite() {
  const pathParts = currentPath.replace(/\\/$/, '').split('/').filter(Boolean);
  const name = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '根目录';
  const path = currentPath;
  if (favorites.some(f => f.path === path)) {
    showToast('已在收藏夹中', 'warning');
    return;
  }
  try {
    const response = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path })
    });
    const data = await response.json();
    if (data.success) {
      favorites = data.favorites;
      renderFavorites();
      showToast('已添加到收藏夹', 'success');
    } else {
      showToast(data.message || '添加失败', 'error');
    }
  } catch (e) {
    showToast('添加失败: ' + e.message, 'error');
  }
}

async function removeFavorite(index) {
  try {
    const response = await fetch('/api/favorites?index=' + index, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (data.success) {
      favorites = data.favorites;
      renderFavorites();
      showToast('已移除收藏', 'success');
    } else {
      showToast(data.message || '移除失败', 'error');
    }
  } catch (e) {
    showToast('移除失败: ' + e.message, 'error');
  }
}

// --- 收藏夹拖拽排序 ---
let _favDragIndex = -1;

function onFavDragStart(event, index) {
  _favDragIndex = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', index);
  // 延迟添加 dragging 样式，避免截屏时包含它
  requestAnimationFrame(() => {
    event.target.classList.add('sidebar-item-dragging');
  });
}

function onFavDragOver(event, toIndex) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const el = event.currentTarget;
  el.classList.add('sidebar-item-drop-target');
}

function onFavDragLeave(event) {
  event.currentTarget.classList.remove('sidebar-item-drop-target');
}

async function onFavDrop(event, toIndex) {
  event.preventDefault();
  event.currentTarget.classList.remove('sidebar-item-drop-target');
  const fromIndex = _favDragIndex;
  if (fromIndex < 0 || fromIndex === toIndex) return;

  // 本地重排
  const [moved] = favorites.splice(fromIndex, 1);
  favorites.splice(toIndex, 0, moved);

  // 保存新顺序到服务端
  try {
    const response = await fetch('/api/favorites/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites })
    });
    const data = await response.json();
    if (data.success) {
      favorites = data.favorites;
    }
  } catch (e) {
    showToast('保存顺序失败: ' + e.message, 'error');
  }

  _favDragIndex = -1;
  renderFavorites();
}

// 拖拽结束时清理
document.addEventListener('dragend', () => {
  _favDragIndex = -1;
  document.querySelectorAll('.sidebar-item-dragging').forEach(el => el.classList.remove('sidebar-item-dragging'));
  document.querySelectorAll('.sidebar-item-drop-target').forEach(el => el.classList.remove('sidebar-item-drop-target'));
});

function highlightCurrentFavorite() {
  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path === currentPath);
  });
}

function showContextMenu(event, type, path, name, previewType) {
  event.preventDefault();
  event.stopPropagation();

  hideContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu active';
  menu.id = 'contextMenu';

  let menuItems = '';

  const hasMultipleSelection = selectedItems.size > 1;

  if (hasMultipleSelection) {
    
    const count = selectedItems.size;
    menuItems = '<div class="context-menu-header" style="padding: 8px 16px; font-size: 12px; color: var(--text-muted); border-bottom: 1px solid var(--border);">已选中 ' + count + ' 个项目</div>';
    menuItems += '<div class="context-menu-item" onclick="downloadSelected(); hideContextMenu();"><span>📥</span> <span>下载选中 (' + count + ')</span></div>';
    menuItems += '<div class="context-menu-divider"></div>';
    menuItems += '<div class="context-menu-item danger" onclick="deleteSelected(); hideContextMenu();"><span>🗑️</span> <span>删除选中 (' + count + ')</span></div>';
    menuItems += '<div class="context-menu-divider"></div>';
    menuItems += '<div class="context-menu-item" onclick="clearSelection(); hideContextMenu();"><span>✖️</span> <span>取消选择</span></div>';
  } else if (type === 'folder') {
    
    menuItems = \`
      <div class="context-menu-item" onclick="navigateTo('\${path}'); hideContextMenu();">
        <span>📂</span> <span>打开</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" onclick="showRenameModal('\${path}', '\${name}'); hideContextMenu();">
        <span>✏️</span> <span>重命名</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item danger" onclick="deleteFile('\${path}'); hideContextMenu();">
        <span>🗑️</span> <span>删除</span>
      </div>
    \`;
  } else if (type === 'file') {
    
    menuItems = \`
      \${previewType === 'text' ? \`<div class="context-menu-item" onclick="openEditor('\${path}', '\${name}'); hideContextMenu();">
        <span>✏️</span> <span>编辑</span>
      </div>
      <div class="context-menu-divider"></div>\` : ''}
      \${previewType ? \`<div class="context-menu-item" onclick="previewFile('\${path}', '\${previewType}', '\${name}'); hideContextMenu();">
        <span>👁️</span> <span>预览</span>
      </div>
      <div class="context-menu-divider"></div>\` : ''}
      <div class="context-menu-item" onclick="downloadFile('\${path}'); hideContextMenu();">
        <span>📥</span> <span>下载</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" onclick="showRenameModal('\${path}', '\${name}'); hideContextMenu();">
        <span>✏️</span> <span>重命名</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item danger" onclick="deleteFile('\${path}'); hideContextMenu();">
        <span>🗑️</span> <span>删除</span>
      </div>
    \`;
  }

  menu.innerHTML = menuItems;
  document.body.appendChild(menu);
  positionMenu(menu, event.clientX, event.clientY);
  setupContextMenuDismiss();
}

function handleContextMenuOutsideClick(e) {
  if (!e.target.closest('.context-menu')) {
    hideContextMenu();
  }
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) {
    menu.remove();
  }
  document.removeEventListener('click', handleContextMenuOutsideClick);
  document.removeEventListener('contextmenu', handleContextMenuOutsideClick);
}

function positionMenu(menu, x, y) {
  const menuRect = menu.getBoundingClientRect();
  if (x + menuRect.width > window.innerWidth) {
    x = window.innerWidth - menuRect.width - 10;
  }
  if (y + menuRect.height > window.innerHeight) {
    y = window.innerHeight - menuRect.height - 10;
  }
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function setupContextMenuDismiss() {
  setTimeout(() => {
    document.addEventListener('click', handleContextMenuOutsideClick);
    document.addEventListener('contextmenu', handleContextMenuOutsideClick);
  }, 0);
}

function initContextMenu() {
  
  const fileList = document.getElementById('fileList');
  const card = fileList.closest('.card');

  card.addEventListener('contextmenu', (e) => {
    
    if (e.target === fileList || e.target.closest('.card') === card && !e.target.closest('.file-item')) {
      e.preventDefault();
      hideContextMenu();

      const menu = document.createElement('div');
      menu.className = 'context-menu active';
      menu.id = 'contextMenu';

      menu.innerHTML = \`
        <div class="context-menu-item" onclick="document.getElementById('fileInput').click(); hideContextMenu();">
          <span>📤</span> <span>上传文件</span>
        </div>
        <div class="context-menu-item" onclick="showNewFolderModal(); hideContextMenu();">
          <span>📁</span> <span>新建文件夹</span>
        </div>
        <div class="context-menu-item" onclick="showNewFileModal(); hideContextMenu();">
          <span>📄</span> <span>新建文件</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" onclick="loadFiles(); hideContextMenu();">
          <span>🔄</span> <span>刷新</span>
        </div>
      \`;

      document.body.appendChild(menu);
      positionMenu(menu, e.clientX, e.clientY);
      setupContextMenuDismiss();
    }
  });
}

function toggleSelection(element) {
  const path = element.dataset.path;
  const type = element.dataset.type;
  const key = type + ':' + path;

  if (selectedItems.has(key)) {
    selectedItems.delete(key);
    element.classList.remove('selected');
  } else {
    selectedItems.add(key);
    element.classList.add('selected');
  }
  updateSelectionInfo();
}

function selectSingle(element) {
  clearSelection();
  const path = element.dataset.path;
  const type = element.dataset.type;
  const key = type + ':' + path;

  selectedItems.add(key);
  element.classList.add('selected');
  lastSelectedIndex = getElementIndex(element);
  updateSelectionInfo();
}

function selectRange(startElement, endElement) {
  const fileList = document.getElementById('fileList');
  const items = Array.from(fileList.querySelectorAll('.file-item'));
  const startIndex = items.indexOf(startElement);
  const endIndex = items.indexOf(endElement);

  const min = Math.min(startIndex, endIndex);
  const max = Math.max(startIndex, endIndex);

  for (let i = min; i <= max; i++) {
    const item = items[i];
    const path = item.dataset.path;
    const type = item.dataset.type;
    const key = type + ':' + path;

    selectedItems.add(key);
    item.classList.add('selected');
  }
  updateSelectionInfo();
}

function getElementIndex(element) {
  const fileList = document.getElementById('fileList');
  const items = Array.from(fileList.querySelectorAll('.file-item'));
  return items.indexOf(element);
}

function clearSelection() {
  selectedItems.clear();
  document.querySelectorAll('.file-item.selected').forEach(item => {
    item.classList.remove('selected');
  });
  lastSelectedIndex = -1;
  updateSelectionInfo();
}

function updateSelectionInfo() {
  const count = selectedItems.size;
  const selectionInfo = document.getElementById('selectionInfo');

  if (count > 0) {
    selectionInfo.textContent = '已选中 ' + count + ' 个项目';
    selectionInfo.classList.add('active');
  } else {
    selectionInfo.textContent = '';
    selectionInfo.classList.remove('active');
  }
}

function handleItemClick(event, element) {
  event.stopPropagation();

  const fileList = document.getElementById('fileList');
  const items = Array.from(fileList.querySelectorAll('.file-item'));
  const currentIndex = items.indexOf(element);
  const isMobile = window.innerWidth <= 768;

  if (isCtrlPressed && isShiftPressed) {
    
    if (lastSelectedIndex >= 0) {
      const lastElement = items[lastSelectedIndex];
      selectRange(lastElement, element);
    } else {
      toggleSelection(element);
    }
  } else if (isCtrlPressed) {
    
    toggleSelection(element);
    lastSelectedIndex = currentIndex;
  } else if (isShiftPressed) {
    
    if (lastSelectedIndex >= 0) {
      const lastElement = items[lastSelectedIndex];
      selectRange(lastElement, element);
    } else {
      selectSingle(element);
    }
  } else if (isMobile) {
    // 移动端：点击直接打开
    const type = element.dataset.type;
    const path = element.dataset.path;
    if (type === 'folder') {
      navigateTo(path);
    } else {
      const pt = element.dataset.previewType;
      if (pt) {
        previewFile(path, pt, element.dataset.name);
      } else {
        downloadFile(path);
      }
    }
  } else {
    
    selectSingle(element);
  }
}

function getSelectedItems() {
  const items = [];
  selectedItems.forEach(key => {
    const parts = key.split(':');
    const type = parts[0];
    const path = parts.slice(1).join(':');
    const selector = '.file-item[data-path="' + path + '"]';
    const element = document.querySelector(selector);
    if (element) {
      items.push({
        type: type,
        path: path,
        name: element.dataset.name,
        previewType: element.dataset.previewType || null
      });
    }
  });
  return items;
}

async function deleteSelected() {
  const items = getSelectedItems();
  if (items.length === 0) {
    showToast('请先选择要删除的项目', 'warning');
    return;
  }

  if (!confirm('确定要删除选中的 ' + items.length + ' 个项目吗？')) {
    return;
  }

  showLoading(true);
  let successCount = 0;
  let failCount = 0;

  for (const item of items) {
    try {
      const response = await fetch('/api/files/' + encodeURIComponent(item.path.slice(1)), {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (e) {
      failCount++;
    }
  }

  showLoading(false);

  if (failCount === 0) {
    showToast('成功删除 ' + successCount + ' 个项目', 'success');
  } else {
    showToast('删除完成：成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'warning');
  }

  clearSelection();
  loadFiles();
}

async function downloadSelected() {
  const items = getSelectedItems();
  if (items.length === 0) {
    showToast('请先选择要下载的项目', 'warning');
    return;
  }

  if (items.length === 1) {
    downloadFile(items[0].path);
    return;
  }

  for (const item of items) {
    downloadFile(item.path);
    await new Promise(resolve => setTimeout(resolve, 500)); 
  }

  showToast('正在下载 ' + items.length + ' 个项目', 'info');
}

function selectAll() {
  const fileList = document.getElementById('fileList');
  const items = fileList.querySelectorAll('.file-item');

  items.forEach(item => {
    const path = item.dataset.path;
    const type = item.dataset.type;
    const key = type + ':' + path;

    selectedItems.add(key);
    item.classList.add('selected');
  });

  updateSelectionInfo();
  showToast('已全选 ' + items.length + ' 个项目', 'success');
}

function initMultiSelect() {
  
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.file-item') && !e.target.closest('.context-menu')) {
      clearSelection();
    }
  });
}

    async function checkAuth() {
      try {
        if (window.__INIT__) return;
        const response = await fetch('/api/auth/check');
        const data = await response.json();
        if (!data.authenticated) {
          window.location.href = '/login.html';
        }
      } catch (error) {
        if (!window.__INIT__) window.location.href = '/login.html';
      }
    }

    async function loadFiles() {
      showLoading(true);
      try {
        const response = await fetch('/api/files' + currentPath);
        const data = await response.json();

        if (!data.success) {
          if (response.status === 401) {
            window.location.href = '/login.html';
            return;
          }
          throw new Error(data.message);
        }

        renderBreadcrumb();
        renderFiles(data.folders, data.files);
      } catch (error) {
        showToast('加载文件失败: ' + error.message, 'error');
      } finally {
        showLoading(false);
      }
    }

    function renderBreadcrumb() {
      const breadcrumb = document.getElementById('breadcrumb');
      const parts = currentPath.split('/').filter(p => p);

      const backDisabled = historyIndex <= 0 ? 'disabled' : '';
      const forwardDisabled = historyIndex >= history.length - 1 ? 'disabled' : '';
      let html = '<button class="nav-btn" id="backBtn"' + backDisabled + ' onclick="goBack()" title="后退">◀</button>';
      html += '<button class="nav-btn" id="forwardBtn"' + forwardDisabled + ' onclick="goForward()" title="前进">▶</button>';

      
        html += ' <a href="javascript:void(0)" class="breadcrumb-item" data-path="/">🏠 根目录</a>';
        let path = '';
        parts.forEach((part, index) => {
          path += '/' + part;
          html += '<span class="breadcrumb-separator">/</span>';
          if (index === parts.length - 1) {
            html += '<span class="breadcrumb-item active">' + part + '</span>';
          } else {
            html += '<a href="javascript:void(0)" class="breadcrumb-item" data-path="' + path + '">' + part + '</a>';
          }
        });
      breadcrumb.innerHTML = html;
    }

    function renderFiles(folders, files) {
      const fileList = document.getElementById('fileList');
      const emptyState = document.getElementById('emptyState');

      fileList.className = viewMode === 'list' ? 'file-list' : 'file-grid';

      if (folders.length === 0 && files.length === 0) {
        fileList.innerHTML = '';
        emptyState.style.display = 'block';
        return;
      }

      emptyState.style.display = 'none';

      let html = '';

      if (viewMode === 'list') {
        const nameArrow = sortField === 'name' ? (sortAscending ? ' ▲' : ' ▼') : '';
        const sizeArrow = sortField === 'size' ? (sortAscending ? ' ▲' : ' ▼') : '';
        const timeArrow = sortField === 'time' ? (sortAscending ? ' ▲' : ' ▼') : '';
        html += '<div class="file-list-header"><span></span>';
        html += '<span class="sortable-header' + (sortField === 'name' ? ' active' : '') + '" onclick="toggleSort(\\'name\\')" style="cursor:pointer;user-select:none;">名称' + nameArrow + '</span>';
        html += '<span class="sortable-header' + (sortField === 'time' ? ' active' : '') + '" onclick="toggleSort(\\'time\\')" style="cursor:pointer;user-select:none;">时间' + timeArrow + '</span>';
        html += '<span class="sortable-header' + (sortField === 'size' ? ' active' : '') + '" onclick="toggleSort(\\'size\\')" style="cursor:pointer;user-select:none;">大小' + sizeArrow + '</span>';
        html += '<span>操作</span></div>';
      }

      const sortedFolders = [...folders].sort((a, b) => {
        if (sortField === 'name') {
          const cmp = a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
          return sortAscending ? cmp : -cmp;
        }
        return 0;
      });
      const sortedFiles = [...files].sort((a, b) => {
        if (sortField === 'name') {
          const cmp = a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
          return sortAscending ? cmp : -cmp;
        }
        if (sortField === 'size') {
          const cmp = (a.size || 0) - (b.size || 0);
          return sortAscending ? cmp : -cmp;
        }
        if (sortField === 'time') {
          const cmp = new Date(a.lastModified || 0) - new Date(b.lastModified || 0);
          return sortAscending ? cmp : -cmp;
        }
        return 0;
      });

sortedFolders.forEach(folder => {
  html += \`
    <div class="file-item"
         ondblclick="navigateTo('\${folder.path}')"
		 onclick="handleItemClick(event, this)"
         oncontextmenu="showContextMenu(event, 'folder', '\${folder.path}', '\${escapeHtml(folder.name)}')"
         data-type="folder"
         data-path="\${folder.path}"
         data-name="\${escapeHtml(folder.name)}">
      <div class="file-icon">📁</div>
      <div class="file-name">\${escapeHtml(folder.name)}</div>
      \${viewMode === 'list' ? '<div class="file-meta" style="text-align:right;font-size:10px;color:var(--text-muted)">-</div>' : ''}
      <div class="file-meta" style="font-size:10px">\${viewMode === 'list' ? '文件夹' : '文件夹'}</div>
      \${viewMode === 'list' ? '<div class="file-meta" style="text-align:right;font-size:10px;color:var(--text-muted)">双击打开</div>' : ''}
    </div>
  \`;
});

sortedFiles.forEach(file => {
  const icon = getFileIcon(file.name);
  const previewType = file.previewType || '';

  html += \`
    <div class="file-item"
         ondblclick="handleFileClick('\${file.path}', '\${previewType}', '\${escapeHtml(file.name)}')"
		 onclick="handleItemClick(event, this)"
         oncontextmenu="showContextMenu(event, 'file', '\${file.path}', '\${escapeHtml(file.name)}', '\${previewType}')"
         data-type="file"
         data-path="\${file.path}"
         data-name="\${escapeHtml(file.name)}"
         data-preview-type="\${previewType}">
      <div class="file-icon">\${icon}</div>
      <div class="file-name">\${escapeHtml(file.name)}</div>
      \${viewMode === 'list' ? '<div class="file-meta" style="text-align:right;font-size:10px;color:var(--text-muted)">' + (file.timeFormatted || '-') + '</div>' : ''}
      <div class="file-meta" style="font-size:10px">\${file.sizeFormatted}\${previewType && viewMode !== 'list' ? ' <span class="badge badge-info">可预览</span>' : ''}</div>
      \${viewMode === 'list' ? '<div class="file-meta" style="text-align:right;font-size:10px;color:var(--text-muted)">' + (previewType ? '可预览 · 右键编辑' : '右键菜单') + '</div>' : ''}
    </div>
  \`;
});

      fileList.innerHTML = html;

      if (pendingSelectFile) {
        const target = document.querySelector('.file-item[data-name="' + pendingSelectFile.replace(/"/g, '\\"') + '"]');
        if (target) {
          selectedItems.clear();
          document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
          const path = target.dataset.path;
          const type = target.dataset.type;
          selectedItems.add(type + ':' + path);
          target.classList.add('selected');
          updateSelectionInfo();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.style.animation = 'none';
          target.offsetHeight;
          target.style.animation = 'selectPulse 0.6s ease';
        }
        pendingSelectFile = null;
      }
    }

    function handleFileClick(path, previewType, filename) {
      if (previewType) {
        previewFile(path, previewType, filename);
      } else {
        downloadFile(path);
      }
    }

    function getFileIcon(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      const icons = {
        'pdf':'📕', 'doc':'📘', 'docx':'📘', 'xls':'📗', 'xlsx':'📗', 'ppt':'📙', 'pptx':'📙',
        'jpg':'🖼️', 'jpeg':'🖼️', 'png':'🖼️', 'gif':'🖼️', 'svg':'🖼️', 'webp':'🖼️', 'bmp':'🖼️', 'ico':'🖼️',
        'mp3':'🎵', 'wav':'🎵', 'flac':'🎵', 'aac':'🎵', 'ogg':'🎵', 'm4a':'🎵',
        'mp4':'🎬', 'avi':'🎬', 'mkv':'🎬', 'mov':'🎬', 'webm':'🎬',
        'zip':'📦', 'rar':'📦', '7z':'📦', 'tar':'📦', 'gz':'📦',
        'js':'📜', 'ts':'📜', 'py':'📜', 'java':'📜', 'cpp':'📜', 'c':'📜',
        'html':'🌐', 'css':'🎨', 'json':'📋', 'xml':'📋', 'yml':'📋', 'yaml':'📋', 'csv':'📊',
        'txt':'📄', 'md':'📝',
        'glb':'🧬', 'gltf':'🧬', 'obj':'🧬',
      };
      return icons[ext] || '📄';
    }

    function navigateTo(path, fromHistory = false) {
      currentPath = path;
      if (!fromHistory) {
        history = history.slice(0, historyIndex + 1);
        history.push(path);
        historyIndex++;
      }
      updateNavButtons();
      loadFiles();
      highlightCurrentFavorite();
      // close mobile sidebar on navigate
      var sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.classList.contains('open')) toggleSidebar();
    }

    function goBack() {
      if (historyIndex <= 0) return;
      historyIndex--;
      navigateTo(history[historyIndex], true);
    }

    function goForward() {
      if (historyIndex >= history.length - 1) return;
      historyIndex++;
      navigateTo(history[historyIndex], true);
    }

    function updateNavButtons() {
      const backBtn = document.getElementById('backBtn');
      const forwardBtn = document.getElementById('forwardBtn');
      if (backBtn) backBtn.disabled = (historyIndex <= 0);
      if (forwardBtn) forwardBtn.disabled = (historyIndex >= history.length - 1);
    }

    function toggleViewMode(mode) {
      viewMode = mode;
      localStorage.setItem('fileViewMode', mode);

      document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === mode);
      });

      loadFiles();
    }

    function toggleSort(field) {
      if (sortField === field) {
        sortAscending = !sortAscending;
      } else {
        sortField = field;
        sortAscending = true;
      }
      localStorage.setItem('sortField', sortField);
      localStorage.setItem('sortAscending', sortAscending);
      loadFiles();
    }

    let dragCounter = 0;
    let isDragging = false;

    function initDragUpload() {
      const fileList = document.getElementById('fileList');
      const card = fileList.closest('.card');
      const uploadOverlay = document.getElementById('uploadOverlay');

      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
        card.addEventListener(eventName, preventDefaults, false);
      });

      card.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (!isDragging && e.dataTransfer.types.includes('Files')) {
          isDragging = true;
          uploadOverlay.classList.add('active');
        }
      }, false);

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }, false);

      card.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
          isDragging = false;
          uploadOverlay.classList.remove('active');
        }
      }, false);

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        isDragging = false;
        uploadOverlay.classList.remove('active');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
          uploadFiles(files);
        }
      }, false);
    }

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    async function uploadFiles(files) {
      if (!files || files.length === 0) return;

      // 上传前检测文件大小（100MB）
      var oversizedNames = [];
      for (var i = 0; i < files.length; i++) {
        if (files[i].size > 100 * 1024 * 1024) {
          oversizedNames.push(files[i].name);
        }
      }
      if (oversizedNames.length > 0) {
        showToast('以下文件超过 100MB 限制：' + oversizedNames.join('、'), 'error');
        return;
      }

      const progressContainer = document.getElementById('uploadProgressContainer');
      const progressFill = document.getElementById('uploadProgressFill');
      const progressFilename = document.getElementById('uploadProgressFilename');
      const progressPercentage = document.getElementById('uploadProgressPercentage');

      progressContainer.classList.add('active');
      progressFill.style.width = '0%';
      progressFilename.textContent = '准备上传...';
      progressPercentage.textContent = '0%';

      let successCount = 0;
      let failCount = 0;
      const totalFiles = files.length;
      const SMALL = 1 * 1024 * 1024;

      // 分堆
      const smallFiles = [];
      const largeFiles = [];
      for (let i = 0; i < files.length; i++) {
        if (files[i].size <= SMALL) smallFiles.push(files[i]);
        else largeFiles.push(files[i]);
      }

      // 上传一个大文件（逐个，有实时进度）
      async function uploadLarge(file) {
        progressFilename.textContent = file.name + ' (' + (successCount + failCount + 1) + '/' + totalFiles + ')';
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const base = successCount + failCount;
              const overall = (base + e.loaded / e.total) / totalFiles * 100;
              const pct = Math.min(100, Math.floor(overall));
              progressFill.style.width = pct + '%';
              progressPercentage.textContent = pct + '%';
            }
          });
          xhr.addEventListener('load', () => {
            try { const d = JSON.parse(xhr.responseText); if (d.success) successCount++; else failCount++; }
            catch(e) { failCount++; }
            const done = successCount + failCount;
            const pct = Math.min(100, Math.floor(done / totalFiles * 100));
            progressFill.style.width = pct + '%';
            progressPercentage.textContent = pct + '%';
            resolve();
          });
          xhr.addEventListener('error', () => { failCount++; resolve(); });
          xhr.open('POST', '/api/files' + currentPath);
          const fd = new FormData();
          fd.append('file', file);
          xhr.send(fd);
        });
      }

      // 先并发上传小文件
      if (smallFiles.length > 0) {
        progressFilename.textContent = '上传小文件...（' + smallFiles.length + ' 个）';
        await Promise.all(smallFiles.map(file => {
          return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.addEventListener('load', () => {
              try { const d = JSON.parse(xhr.responseText); if (d.success) successCount++; else failCount++; }
              catch(e) { failCount++; }
              const done = successCount + failCount;
              const pct = Math.min(100, Math.floor(done / totalFiles * 100));
              progressFill.style.width = pct + '%';
              progressPercentage.textContent = pct + '%';
              resolve();
            });
            xhr.addEventListener('error', () => { failCount++; resolve(); });
            xhr.open('POST', '/api/files' + currentPath);
            const fd = new FormData();
            fd.append('file', file);
            xhr.send(fd);
          });
        }));
      }

      // 再逐个上传大文件
      for (let i = 0; i < largeFiles.length; i++) {
        await uploadLarge(largeFiles[i]);
      }

      progressFill.style.width = '100%';
      progressFilename.textContent = '上传完成! 成功: ' + successCount + '/' + totalFiles;
      progressPercentage.textContent = '100%';

      setTimeout(() => {
        closeUploadProgress();
        if (successCount > 0 && failCount === 0) {
          showToast('成功上传 ' + successCount + ' 个文件', 'success');
          loadFiles();
        } else if (successCount > 0 && failCount > 0) {
          showToast('上传完成：成功 ' + successCount + ' 个，失败 ' + failCount + ' 个', 'warning');
          loadFiles();
        } else if (failCount > 0) {
          showToast('上传失败：' + failCount + ' 个文件上传失败', 'error');
        }
      }, 2000);
    }

    function closeUploadProgress() {
      const progressContainer = document.getElementById('uploadProgressContainer');
      progressContainer.classList.remove('active');
    }

    async function previewFile(path, previewType, filename) {
      const overlay = document.getElementById('previewOverlay');
      const content = document.getElementById('previewContent');
      const filenameEl = document.getElementById('previewFilename');
      const downloadBtn = document.getElementById('previewDownloadBtn');

      filenameEl.textContent = filename;
      downloadBtn.onclick = () => downloadFile(path);

      content.innerHTML = '<div class="preview-loading"><div class="spinner"></div><div>加载中...</div></div>';
      overlay.classList.add('active');

      try {
        const previewUrl = '/api/preview' + path;

        switch (previewType) {
          case 'image':
            content.innerHTML = '<img class="preview-image" src="' + previewUrl + '" alt="' + escapeHtml(filename) + '">';
            break;

          case 'pdf':
            content.innerHTML = '<iframe class="preview-pdf" src="' + previewUrl + '"></iframe>';
            break;

          case 'text':
            const textResponse = await fetch(previewUrl);
            const text = await textResponse.text();
            const ext = filename.split('.').pop().toLowerCase();

            if (ext === 'md') {
              
              const htmlContent = marked.parse(text);
              content.innerHTML = '<div class="preview-markdown">' + htmlContent + '</div>';
            } else if (ext === 'json') {
              
              try {
                const json = JSON.parse(text);
                content.innerHTML = '<pre class="preview-text">' + escapeHtml(JSON.stringify(json, null, 2)) + '</pre>';
              } catch {
                content.innerHTML = '<pre class="preview-text">' + escapeHtml(text) + '</pre>';
              }
            } else {
              content.innerHTML = '<pre class="preview-text">' + escapeHtml(text) + '</pre>';
            }
            break;

          case 'video':
            content.innerHTML = '<video class="preview-video" controls autoplay><source src="' + previewUrl + '"></video>';
            break;

          case 'audio':
            content.innerHTML = '<audio class="preview-audio" controls autoplay><source src="' + previewUrl + '"></audio>';
            break;

          case 'word':
            
            const docxResponse = await fetch(previewUrl);
            const docxArrayBuffer = await docxResponse.arrayBuffer();
            const result = await mammoth.convertToHtml({ arrayBuffer: docxArrayBuffer });
            content.innerHTML = '<div class="preview-markdown">' + result.value + '</div>';
            break;

          default:
            content.innerHTML = '<div class="preview-error">不支持预览此文件类型</div>';
        }
      } catch (error) {
        content.innerHTML = '<div class="preview-error">预览加载失败: ' + escapeHtml(error.message) + '</div>';
      }
    }

    function closePreview() {
      const overlay = document.getElementById('previewOverlay');
      overlay.classList.remove('active');
      
      document.getElementById('previewContent').innerHTML = '';
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePreview();
      }
    });

    async function handleFileUpload(event) {
      const files = event.target.files;
      if (!files.length) return;

      await uploadFiles(files);
      event.target.value = '';
    }

    function showNewFolderModal() {
      document.getElementById('folderName').value = '';
      document.getElementById('newFolderModal').classList.add('active');
    }

    async function createFolder(event) {
      event.preventDefault();
      const name = document.getElementById('folderName').value.trim();
      if (!name) { showToast('请输入文件夹名称', 'error'); return; }
      closeModal('newFolderModal');
      let path = currentPath;
      if (!path.endsWith('/')) path += '/';
      path += name;
      await apiCall('/api/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      }, '文件夹创建成功', loadFiles);
    }

    function showNewFileModal() {
      document.getElementById('newFileName').value = '';
      document.getElementById('newFileContent').value = '';
      document.getElementById('newFileModal').classList.add('active');
      setTimeout(() => document.getElementById('newFileName').focus(), 100);
    }

    async function createNewFile(event) {
      event.preventDefault();
      const name = document.getElementById('newFileName').value.trim();
      const content = document.getElementById('newFileContent').value;
      if (!name) { showToast('请输入文件名', 'error'); return; }
      closeModal('newFileModal');
      let path = currentPath;
      if (!path.endsWith('/')) path += '/';
      path += name;
      await apiCall('/api/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content })
      }, '文件创建成功', loadFiles);
    }

    function showRenameModal(path, currentName) {
      document.getElementById('renameFilePath').value = path;
      document.getElementById('renameFileName').value = currentName;
      document.getElementById('renameModal').classList.add('active');
    }

    async function renameFile(event) {
      event.preventDefault();
      const path = document.getElementById('renameFilePath').value;
      const newName = document.getElementById('renameFileName').value.trim();
      if (!newName) { showToast('请输入新名称', 'error'); return; }
      closeModal('renameModal');
      await apiCall('/api/files' + path, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName })
      }, '重命名成功', loadFiles);
    }

    async function deleteFile(path) {
      if (!confirm('确定要删除吗？此操作不可恢复。')) return;
      await apiCall('/api/files' + path, { method: 'DELETE' }, '删除成功', loadFiles);
    }

    async function downloadFile(path) {
      window.open('/api/download' + path, '_blank');
    }

    let aceEditor = null;
    let editorCurrentPath = null;
    let editorDirty = false;
    let editorFontSize = 14;
    let editorDarkTheme = true;
    let editorWordWrap = true;
    let editorFullscreen = false;

    async function openEditor(filePath, filename) {
      try {
        showLoading(true);
        const res = await fetch('/api/edit' + filePath);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          showToast(d.message || '无法读取文件', 'error');
          return;
        }
        const content = await res.text();

        document.getElementById('editorFilename').textContent = filename;
        editorCurrentPath = filePath;
        setEditorDirty(false);

        const modal = document.getElementById('editorModal');
        const win = document.getElementById('editorWindow');

        editorFullscreen = false;
        document.getElementById('editorWindowBtn').textContent = '🗖';
        win.style.width = '90vw';
        win.style.height = '85vh';
        win.style.position = 'relative';
        win.style.left = '';
        win.style.top = '';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';

        modal.classList.add('active');

        if (!aceEditor) {
          aceEditor = ace.edit('aceEditorContainer');
          aceEditor.setOptions({
            showPrintMargin: false,
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            enableSnippets: true,
            tabSize: 2,
            useSoftTabs: true
          });
          
          aceEditor.session.on('change', function() {
            setEditorDirty(true);
          });
          
          aceEditor.selection.on('changeCursor', updateEditorStatus);
          aceEditor.session.on('changeScrollTop', updateEditorStatus);

        }

        aceEditor.setTheme(editorDarkTheme ? 'ace/theme/monokai' : 'ace/theme/chrome');
        aceEditor.setFontSize(editorFontSize + 'px');
        aceEditor.session.setUseWrapMode(editorWordWrap);
        document.getElementById('editorWordWrapBtn').textContent = editorWordWrap ? '↔' : '↩';
        document.getElementById('editorThemeBtn').textContent = editorDarkTheme ? '🌙' : '☀️';
        document.getElementById('editorFontSizeLabel').textContent = editorFontSize;

        try {
          const modelist = ace.require('ace/ext/modelist');
          const mode = modelist.getModeForPath(filename).mode;
          aceEditor.session.setMode(mode);
          document.getElementById('editorStatusMode').textContent = mode.replace('ace/mode/', '');
        } catch (e) {
          aceEditor.session.setMode('ace/mode/text');
          document.getElementById('editorStatusMode').textContent = 'text';
        }

        aceEditor.session.setValue(content, -1);
        
        aceEditor.session.getUndoManager().reset();
        setEditorDirty(false);
        aceEditor.focus();
        aceEditor.gotoLine(0, 0);
        updateEditorStatus();
      } catch (err) {
        showToast('打开编辑器失败: ' + err.message, 'error');
      } finally {
        showLoading(false);
      }
    }

    function setEditorDirty(dirty) {
      editorDirty = dirty;
      document.getElementById('editorDirtyIndicator').style.display = dirty ? 'inline' : 'none';
    }

    async function saveEditor() {
      if (!editorCurrentPath || !aceEditor) return;
      try {
        document.getElementById('editorSaveBtn').disabled = true;
        document.getElementById('editorSaveBtn').textContent = '⏳ 保存中...';
        const content = aceEditor.getValue();
        const res = await fetch('/api/edit' + editorCurrentPath, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: content
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d.success) {
          setEditorDirty(false);
          showToast('文件已保存', 'success');
          
          if (typeof loadFiles === 'function') loadFiles();
        } else {
          showToast(d.message || '保存失败', 'error');
        }
      } catch (err) {
        showToast('保存失败: ' + err.message, 'error');
      } finally {
        document.getElementById('editorSaveBtn').disabled = false;
        document.getElementById('editorSaveBtn').textContent = '💾 保存';
      }
    }

    function closeEditor() {
      if (editorDirty) {
        if (!confirm('文件有未保存的修改，确定要关闭吗？')) return;
      }
      document.getElementById('editorModal').classList.remove('active');
      editorCurrentPath = null;
      setEditorDirty(false);
    }

    function editorUndo() { if (aceEditor) aceEditor.undo(); }
    function editorRedo() { if (aceEditor) aceEditor.redo(); }

    function editorFind() {
      if (!aceEditor) return;
      aceEditor.execCommand('find');
    }

    function editorGoToLine() {
      if (!aceEditor) return;
      const line = prompt('跳转到行号 (1-' + (aceEditor.session.getLength()) + '):');
      if (line !== null && !isNaN(line)) {
        aceEditor.gotoLine(parseInt(line, 10), 0, true);
      }
    }

    function changeEditorFontSize(delta) {
      editorFontSize = Math.max(10, Math.min(28, editorFontSize + delta));
      if (aceEditor) aceEditor.setFontSize(editorFontSize + 'px');
      document.getElementById('editorFontSizeLabel').textContent = editorFontSize;
    }

    function editorToggleWordWrap() {
      editorWordWrap = !editorWordWrap;
      if (aceEditor) aceEditor.session.setUseWrapMode(editorWordWrap);
      document.getElementById('editorWordWrapBtn').textContent = editorWordWrap ? '↔' : '↩';
      document.getElementById('editorWordWrapBtn').title = editorWordWrap ? '取消自动换行' : '切换自动换行';
    }

    function editorToggleTheme() {
      editorDarkTheme = !editorDarkTheme;
      if (aceEditor) aceEditor.setTheme(editorDarkTheme ? 'ace/theme/monokai' : 'ace/theme/chrome');
      document.getElementById('editorThemeBtn').textContent = editorDarkTheme ? '🌙' : '☀️';
      document.getElementById('editorThemeBtn').title = editorDarkTheme ? '切换浅色主题' : '切换深色主题';
      
      const win = document.getElementById('editorWindow');
      if (win) {
        win.style.background = editorDarkTheme ? '#1e1e1e' : '#f5f5f5';
      }
    }

    function editorToggleFullscreen() {
      const win = document.getElementById('editorWindow');
      const modal = document.getElementById('editorModal');
      if (!win) return;

      editorFullscreen = !editorFullscreen;
      if (editorFullscreen) {
        
        win.dataset.prevW = win.style.width;
        win.dataset.prevH = win.style.height;
        win.dataset.prevBg = editorDarkTheme ? '#1e1e1e' : '#f5f5f5';
        win.style.width = '100vw';
        win.style.height = '100vh';
        win.style.borderRadius = '0';
        win.style.position = 'fixed';
        win.style.left = '0';
        win.style.top = '0';
        win.style.resize = 'none';
        win.style.minWidth = '100vw';
        win.style.minHeight = '100vh';
        modal.style.alignItems = 'stretch';
        modal.style.justifyContent = 'stretch';
        document.getElementById('editorWindowBtn').textContent = '🗗';
      } else {
        win.style.width = win.dataset.prevW || '90vw';
        win.style.height = win.dataset.prevH || '85vh';
        win.style.borderRadius = '8px';
        win.style.position = 'relative';
        win.style.left = '';
        win.style.top = '';
        win.style.resize = 'both';
        win.style.minWidth = '600px';
        win.style.minHeight = '400px';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        document.getElementById('editorWindowBtn').textContent = '🗖';
      }
      if (aceEditor) aceEditor.resize();
    }

    function updateEditorStatus() {
      if (!aceEditor) return;
      const cursor = aceEditor.selection.getCursor();
      document.getElementById('editorStatusPosition').textContent =
        '行 ' + (cursor.row + 1) + ', 列 ' + (cursor.column + 1);
      document.getElementById('editorStatusIndent').textContent =
        '空格: ' + aceEditor.session.getTabSize();
    }

    (function initEditorDrag() {
      let isDragging = false, dragX, dragY, startX, startY;
      document.addEventListener('mousedown', function(e) {
        const toolbar = document.getElementById('editorToolbar');
        if (!toolbar || !toolbar.contains(e.target)) return;
        
        if (e.target.closest('.editor-tool-btn')) return;
        
        if (editorFullscreen) return;
        const win = document.getElementById('editorWindow');
        if (!win || !win.style.left) {
          
          const rect = win.getBoundingClientRect();
          win.style.position = 'fixed';
          win.style.left = rect.left + 'px';
          win.style.top = rect.top + 'px';
          win.style.width = rect.width + 'px';
          win.style.height = rect.height + 'px';
          document.getElementById('editorModal').style.alignItems = 'stretch';
          document.getElementById('editorModal').style.justifyContent = 'stretch';
        }
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        dragX = parseInt(win.style.left) || 0;
        dragY = parseInt(win.style.top) || 0;
        e.preventDefault();
      });
      document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const win = document.getElementById('editorWindow');
        if (!win) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        win.style.left = (dragX + dx) + 'px';
        win.style.top = (dragY + dy) + 'px';
      });
      document.addEventListener('mouseup', function() {
        isDragging = false;
      });
    })();

    document.addEventListener('keydown', function(e) {
      const modal = document.getElementById('editorModal');
      if (!modal || !modal.classList.contains('active')) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveEditor();
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        editorGoToLine();
      }
      
      if (e.key === 'Escape') {
        closeEditor();
      }
    });

    ${SHARED_SCRIPTS}

  </script>
</body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, Destination, Overwrite, Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Type, ETag, Last-Modified, DAV'
    };

    // 屏蔽无用请求，避免浪费 Worker 调用配额
    if (path === '/favicon.ico' || path === '/robots.txt' || path === '/.well-known' || path.startsWith('/.well-known/')) {
      return new Response(null, { status: 404 });
    }

    try {
      // Windows WebDAV 客户端发送 OPTIONS * 探测服务器能力
      if (method === 'OPTIONS' && (path === '*' || request.url === '*')) {
        return handleDavOptions(null);
      }

      // ============================================================
      //  WebDAV 路由 —— /dav/ 路径
      // ============================================================
      if (path.startsWith('/dav/') || path === '/dav') {
        let davPath = path === '/dav' ? '' : path.slice(5); // 去掉 "/dav/" 或 "/dav"
        if (davPath.startsWith('/')) davPath = davPath.slice(1);
        davPath = davPath.replace(/\/$/, '');

        // OPTIONS — 能力声明
        if (method === 'OPTIONS') {
          return handleDavOptions(davPath);
        }

        // PROPFIND — 列出目录
        if (method === 'PROPFIND') {
          return await handleDavPropfind(request, env, davPath);
        }

        // GET — 下载文件
        if (method === 'GET') {
          return await handleDavGet(request, env, davPath);
        }

        // HEAD — 文件信息
        if (method === 'HEAD') {
          return await handleDavHead(request, env, davPath);
        }

        // PUT — 上传文件
        if (method === 'PUT') {
          return await handleDavPut(request, env, davPath);
        }

        // DELETE — 删除
        if (method === 'DELETE') {
          return await handleDavDelete(request, env, davPath);
        }

        // MKCOL — 创建目录
        if (method === 'MKCOL') {
          return await handleDavMkcol(request, env, davPath);
        }

        // MOVE — 移动/重命名
        if (method === 'MOVE') {
          return await handleDavMove(request, env, davPath);
        }

        // COPY — 复制
        if (method === 'COPY') {
          return await handleDavCopy(request, env, davPath);
        }

        // LOCK / UNLOCK — 锁存根
        if (method === 'LOCK') {
          return handleDavLock();
        }
        if (method === 'UNLOCK') {
          return handleDavUnlock();
        }

        return new Response('Method Not Allowed', { status: 405 });
      }
      // ============================================================

      if (method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      if (path.startsWith('/api/')) {
        
        if (path === '/api/login' && method === 'POST') {
          return await handleLogin(request, env);
        }

        if (path === '/api/logout' && method === 'POST') {
          return await handleLogout();
        }

        if (path === '/api/auth/check') {
          return await handleCheckAuth(request, env);
        }

        if (path === '/api/files' && method === 'POST') {
          return await handleCreateFile(request, env);
        }

        if (path === '/api/folders' && method === 'POST') {
          return await handleCreateFolder(request, env);
        }

        if (path.startsWith('/api/files')) {
          const filePath = path.slice('/api/files'.length) || '/';

          if (method === 'GET') {
            return await handleListFiles(request, env, filePath);
          }
          if (method === 'POST') {
            return await handleUploadFile(request, env, filePath);
          }
          if (method === 'PUT') {
            return await handleRenameFile(request, env, filePath);
          }
          if (method === 'DELETE') {
            return await handleDeleteFile(request, env, filePath);
          }
        }

        if (path.startsWith('/api/download')) {
          return await serveFile(request, env, path.slice('/api/download'.length), { download: true });
        }

        if (path.startsWith('/api/preview')) {
          return await serveFile(request, env, path.slice('/api/preview'.length), { cache: true });
        }

        if (path.startsWith('/api/edit')) {
          return await handleEditFile(request, env, path.slice('/api/edit'.length));
        }

        if (path === '/api/search' && method === 'GET') {
          return await handleSearchFiles(request, env);
        }

        if (path === '/api/favorites' && method === 'GET') {
          return await handleGetFavorites(request, env);
        }
        if (path === '/api/favorites' && method === 'POST') {
          return await handleAddFavorite(request, env);
        }
        if (path === '/api/favorites' && method === 'DELETE') {
          return await handleRemoveFavorite(request, env);
        }
        if (path === '/api/favorites/order' && method === 'PUT') {
          return await handleReorderFavorites(request, env);
        }

        return jsonResponse({ success: false, message: 'API 路径不存在' }, 404);
      }

      if (path === '/login.html' || path === '/login') {
        return htmlResponse(LOGIN_PAGE);
      }

      if (path === '/' || path === '/index.html') {
        const auth = await verifyAuth(request, env);
        if (!auth) {
          return Response.redirect(url.origin + '/login.html', 302);
        }
        // 预加载 favorites，嵌入 HTML 省掉前端一次 KV 读取
        const favKey = getFavoritesKey();
        const favRaw = await env.KV_STORE.get(favKey);
        const favorites = favRaw ? JSON.parse(favRaw) : [];
        const initData = { favorites: favorites || [] };
        const initJson = JSON.stringify(initData);
        return htmlResponse(INDEX_PAGE.replace('</head>', `<script>window.__INIT__=${initJson};</script></head>`));
      }

      return Response.redirect(url.origin + '/', 302);

    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ success: false, message: '服务器错误: ' + error.message }, 500);
    }
  }
};
