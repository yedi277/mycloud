/**
 * name = "mycloud-single"
 * WebDAV-only 精简版 —— 只保留 WebDAV 功能，无 UI
 *
 * 认证方式：HTTP Basic Auth（用户在 WebDAV 客户端中输入密码 账户随意）
 * WebDAV 端点：/dav/
 *
 * [[r2_buckets]]
 * binding = "R2_BUCKET"
 * bucket_name = "你的R2桶名"
 *
 * [vars]
 * ADMIN_PASSWORD = "你的管理员密码"
 */

// ========== 工具函数 ==========

/**
 * 根据文件扩展名获取对应的 MIME 类型
 * @param {string} filename - 文件名
 * @returns {string} MIME 类型
 */
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

/**
 * 标准化路径：去掉开头斜杠，去掉末尾斜杠
 * @param {string} p - 原始路径
 * @returns {string} 标准化后的路径
 */
function normalizePath(p) {
  if (!p) return '';
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}

/**
 * 递归删除 R2 中的文件夹（包括所有子文件和子文件夹）
 * @param {object} env - Worker 环境变量
 * @param {string} key - 要删除的文件夹路径（R2 key前缀）
 */
async function deleteR2Folder(env, key) {
  // 分页游标：用于批量列出 R2 对象（一次最多1000个）
  let cursor;
  do {
    // 列出当前前缀下的所有对象（分批处理，避免一次过多）
    const batch = await env.R2_BUCKET.list({ prefix: key + '/', cursor });
    if (batch.objects?.length) {
      await env.R2_BUCKET.delete(batch.objects.map(obj => obj.key));
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
  await env.R2_BUCKET.delete(key);
}

/**
 * 递归复制 R2 中的文件夹到新位置
 * @param {object} env - Worker 环境变量
 * @param {string} srcKey - 源文件夹路径
 * @param {string} dstKey - 目标文件夹路径
 */
async function copyR2Folder(env, srcKey, dstKey) {
  // 分页游标：用于批量列出源文件夹中的对象
  let cursor;
  do {
    const batch = await env.R2_BUCKET.list({ prefix: srcKey + '/', cursor });
    if (batch.objects?.length) {
      // 批量获取源文件内容（并行读取，提高效率）
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

/**
 * 解析 WebDAV Destination 请求头，获取移动/复制操作的目标路径
 * @param {Request} request - HTTP 请求对象
 * @param {string} davPath - 当前 WebDAV 路径
 * @returns {object|Response} 包含 srcKey 和 dstKey 的对象，或错误 Response
 */
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


/**
 * XML 特殊字符转义（防XML注入）
 * @param {string} s - 原始字符串
 * @returns {string} 转义后的字符串
 */
function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 将日期转换为 RFC 1123 格式（HTTP 标准日期格式）
 * @param {Date|string} d - 日期对象或日期字符串
 * @returns {string} RFC 1123 格式日期字符串
 */
function rfc1123Date(d) {
  return new Date(d).toUTCString();
}

/**
 * 构建 WebDAV XML 响应
 * @param {string} body - XML 响应体内容
 * @param {number} status - HTTP 状态码，默认 207 (MultiStatus)
 * @returns {Response} WebDAV XML 响应对象
 */
function davXmlResponse(body, status = 207) {
  const xml = '<?xml version="1.0" encoding="utf-8"?>\n' + body;
  return new Response(xml, {
    status,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
}

/**
 * 验证 WebDAV 请求的 HTTP Basic Auth 认证
 * @param {Request} request - HTTP 请求对象
 * @param {object} env - Worker 环境变量（含 ADMIN_PASSWORD）
 * @returns {object|null} 认证成功返回用户信息，失败返回 null
 */
async function verifyDavAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;
  try {
      // 解码 Base64 编码的 Basic Auth 凭证（格式：username:password，这里只校验 password）
    const decoded = atob(authHeader.slice(6));
    const colon = decoded.indexOf(':');
    const pass = decoded.slice(colon + 1);
    if (pass !== env.ADMIN_PASSWORD) return null;
    return { role: 'admin' };
  } catch {
    return null;
  }
}

/**
 * 返回 WebDAV 认证失败响应（401 Unauthorized）
 * @param {Request} request - HTTP 请求对象
 * @param {string} resType - 响应类型：'text' 或 'xml'
 * @returns {Response} 401 未授权响应
 */
function requireDavAuth(request, resType = 'text') {
  const headers = {
    'WWW-Authenticate': 'Basic realm="WebDAV", charset="UTF-8"',
  };
  if (resType === 'xml') {
    return davXmlResponse(
      '<d:error xmlns:d="DAV:"><d:responsedescription>Unauthorized</d:responsedescription></d:error>',
      401
    );
  }
  return new Response('Unauthorized', { status: 401, headers });
}

/**
 * 处理 WebDAV OPTIONS 请求（返回支持的 HTTP 方法）
 * @returns {Response} OPTIONS 响应，包含 Allow 和 DAV 头
 */
function handleDavOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Allow': 'OPTIONS,GET,HEAD,PUT,DELETE,PROPFIND,MKCOL,MOVE,COPY,LOCK,UNLOCK',
      'DAV': '1, 2',
      'MS-Author-Via': 'DAV',
      'Content-Length': '0',
    }
  });
}

// ========== WebDAV 核心处理方法 ==========
/**
 * 处理 WebDAV PROPFIND 请求（列出文件/文件夹属性）
 * @param {Request} request - HTTP 请求对象
 * @param {object} env - Worker 环境变量
 * @param {string} davPath - WebDAV 路径
 * @returns {Response} 包含文件属性的 XML 响应（207 MultiStatus）
 */
async function handleDavPropfind(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request, 'xml');

  try {
    // 获取 WebDAV Depth 头（infinity|0|1）：决定列出多少层目录
    const depth = request.headers.get('Depth') || 'infinity';
    // 构建 WebDAV 基础 URL（用于生成响应中的 href 路径）
    const baseUrl = new URL(request.url).origin + '/dav/';
    const fileObj = davPath ? await env.R2_BUCKET.get(davPath) : null;
      // 情况1：davPath 是一个具体文件 → 返回单文件属性
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
        <d:getlastmodified>${rfc1123Date(mtime)}</d:getlastmodified>
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
      // 情况2：davPath 是文件夹 → 列出文件夹内容
    const prefix = davPath ? davPath + '/' : '';
    const objects = [];
    const folders = new Set();
    let cursor;
    do {
      const batch = await env.R2_BUCKET.list({ prefix, delimiter: '/', limit: 1000, cursor });
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
    for (const obj of objects) {
      const objPath = obj.key;
      const name = objPath.split('/').pop();
      const mtime = obj.uploaded || new Date();
      xml += `  <d:response>
    <d:href>${xmlEscape(baseUrl + objPath)}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${xmlEscape(name)}</d:displayname>
        <d:resourcetype/>
        <d:getlastmodified>${rfc1123Date(mtime)}</d:getlastmodified>
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

/**
 * 处理 WebDAV GET 请求（下载文件）
 * @param {Request} request - HTTP 请求对象
 * @param {object} env - Worker 环境变量
 * @param {string} davPath - WebDAV 路径（文件路径）
 * @returns {Response} 文件内容响应，或文件夹的 PROPFIND 响应
 */
async function handleDavGet(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) {
      const list = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
      if (list.objects?.length > 0 || list.delimitedPrefixes?.length > 0) {
        return handleDavPropfind(request, env, davPath);
      }
      return new Response('Not Found', { status: 404 });
    }

    const filename = key.split('/').pop();
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || getMimeType(filename),
        'Content-Length': obj.size,
        'ETag': obj.etag ? `"${obj.etag}"` : '',
        'Last-Modified': rfc1123Date(obj.uploaded),
      }
    });
  } catch (e) {
    return new Response('Internal Server Error: ' + e.message, { status: 500 });
  }
}

/**
 * 处理 WebDAV HEAD 请求（获取文件头信息，不返回内容）
 * @param {Request} request - HTTP 请求对象
 * @param {object} env - Worker 环境变量
 * @param {string} davPath - WebDAV 路径
 * @returns {Response} 只有响应头的 Response
 */
async function handleDavHead(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) {
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
        'Last-Modified': rfc1123Date(obj.uploaded),
      }
    });
  } catch (e) {
    return new Response(null, { status: 500 });
  }
}

/**
 * 处理 WebDAV PUT 请求（上传/创建文件）
 * @param {Request} request - HTTP 请求对象（包含文件内容）
 * @param {object} env - Worker 环境变量
 * @param {string} davPath - WebDAV 路径（目标文件路径）
 * @returns {Response} 201 创建成功，或 405/412 错误
 */
async function handleDavPut(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    // 检查 Overwrite 头：F=false 时不允许覆盖已存在的文件
    const overwrite = request.headers.get('Overwrite') !== 'F';
    const folderCheck = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
    if (folderCheck.objects?.length > 0 || folderCheck.delimitedPrefixes?.length > 0) {
      return new Response('Target is a collection', { status: 405 });
    }

    if (!overwrite) {
      const existing = await env.R2_BUCKET.get(key);
      if (existing) return new Response(null, { status: 412 });
    }

    const contentType = request.headers.get('Content-Type') || getMimeType(key) || 'application/octet-stream';
    await env.R2_BUCKET.put(key, request.body, { httpMetadata: { contentType } });
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('Upload failed: ' + e.message, { status: 500 });
  }
}

/**
 * 处理 WebDAV DELETE 请求（删除文件或文件夹）
 * @param {Request} request - HTTP 请求对象
 * @param {object} env - Worker 环境变量
 * @param {string} davPath - WebDAV 路径（要删除的文件/文件夹路径）
 * @returns {Response} 204 删除成功
 */
async function handleDavDelete(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    await deleteR2Folder(env, davPath);
    return new Response(null, { status: 204 });
  } catch (e) {
    return new Response('Delete failed: ' + e.message, { status: 500 });
  }
}

/**
 * 处理 WebDAV MKCOL 请求（创建文件夹）
 * @param {Request} request - HTTP 请求对象
 * @param {object} env - Worker 环境变量
 * @param {string} davPath - WebDAV 路径（新文件夹路径）
 * @returns {Response} 201 创建成功
 */
async function handleDavMkcol(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
    const existing = await env.R2_BUCKET.get(key);
    if (existing) {
      return new Response(null, { status: 405, headers: { 'Allow': 'GET,OPTIONS,PROPFIND' } });
    }

    const existingDir = await env.R2_BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
    if (existingDir.objects?.length > 0 || existingDir.delimitedPrefixes?.length > 0) {
      return new Response(null, { status: 201 });
    }
    await env.R2_BUCKET.put(key + '/.keep', '', { httpMetadata: { contentType: 'text/plain' } });
    return new Response(null, { status: 201 });
  } catch (e) {
    return new Response('MKCOL failed: ' + e.message, { status: 500 });
  }
}

/**
 * 处理 WebDAV MOVE 请求（移动/重命名文件或文件夹）
 * @param {Request} request - HTTP 请求对象（含 Destination 头）
 * @param {object} env - Worker 环境变量
 * @param {string} davPath - WebDAV 路径（源路径）
 * @returns {Response} 201 移动成功
 */
async function handleDavMove(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    // 解析结果：srcKey=源路径，dstKey=目标路径
    const { srcKey, dstKey } = parsed;

    // 检查 Overwrite 头：F=false 时不允许覆盖已存在的文件
    const overwrite = request.headers.get('Overwrite') !== 'F';

    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (!srcObj) {
      const srcCheck = await env.R2_BUCKET.list({ prefix: srcKey + '/', delimiter: '/', limit: 1 });
      if (!srcCheck.objects?.length && !srcCheck.delimitedPrefixes?.length) {
        return new Response('Not Found', { status: 404 });
      }
      await copyR2Folder(env, srcKey, dstKey);
      await deleteR2Folder(env, srcKey);
      return new Response(null, { status: 201 });
    }

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

/**
 * 处理 WebDAV COPY 请求（复制文件或文件夹）
 * @param {Request} request - HTTP 请求对象（含 Destination 头）
 * @param {object} env - Worker 环境变量
 * @param {string} davPath - WebDAV 路径（源路径）
 * @returns {Response} 201 复制成功
 */
async function handleDavCopy(request, env, davPath) {
  const auth = await verifyDavAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    // 解析结果：srcKey=源路径，dstKey=目标路径
    const { srcKey, dstKey } = parsed;

    // 检查 Overwrite 头：F=false 时不允许覆盖已存在的文件
    const overwrite = request.headers.get('Overwrite') !== 'F';
    // 获取 WebDAV Depth 头（infinity|0|1）：决定列出多少层目录
    const depth = request.headers.get('Depth') || 'infinity';

    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (srcObj) {
      if (!overwrite) {
        const destExists = await env.R2_BUCKET.get(dstKey);
        if (destExists) return new Response(null, { status: 412 });
      }
      await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
      return new Response(null, { status: 201 });
    }

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

/**
 * 处理 WebDAV LOCK 请求（加锁，简化版：总是返回成功）
 * @returns {Response} 锁定成功的 XML 响应
 */
function handleDavLock() {
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

/**
 * 处理 WebDAV UNLOCK 请求（解锁，简化版：总是返回成功）
 * @returns {Response} 204 解锁成功
 */
function handleDavUnlock() {
  return new Response(null, { status: 204 });
}

// ========== Worker 主入口 ==========
/**
 * Cloudflare Worker 主入口：处理所有传入的 HTTP 请求
 * 路由逻辑：
 *   1. OPTIONS 请求 → CORS 预检响应
 *   2. /dav/* 路径 → WebDAV 处理
 *   3. 其他 → 404 Not Found
 */
export default {
  async fetch(request, env, ctx) {
  // 解析请求 URL 和路径
    const url = new URL(request.url);
    // 解析请求 URL、路径和 HTTP 方法
  // 处理 CORS 预检请求（OPTIONS）
    const path = decodeURIComponent(url.pathname);
    const method = request.method;
    if (method === 'OPTIONS' && path.startsWith('/dav')) {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, OPTIONS, HEAD, LOCK, UNLOCK',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, Destination, Overwrite, Range',
        }
      });
    }

    try {
      if (path.startsWith('/dav/') || path === '/dav') {
        let davPath = path === '/dav' ? '' : path.slice(5);
        if (davPath.startsWith('/')) davPath = davPath.slice(1);
        davPath = davPath.replace(/\/$/, '');

        // 根据 HTTP 方法分发到对应的 WebDAV 处理函数
        const methodMap = {
          'OPTIONS': () => handleDavOptions(),
          'PROPFIND': () => handleDavPropfind(request, env, davPath),
          'GET': () => handleDavGet(request, env, davPath),
          'HEAD': () => handleDavHead(request, env, davPath),
          'PUT': () => handleDavPut(request, env, davPath),
          'DELETE': () => handleDavDelete(request, env, davPath),
          'MKCOL': () => handleDavMkcol(request, env, davPath),
          'MOVE': () => handleDavMove(request, env, davPath),
          'COPY': () => handleDavCopy(request, env, davPath),
          'LOCK': () => handleDavLock(),
          'UNLOCK': () => handleDavUnlock(),
        };

        const handler = methodMap[method];
        if (handler) return await handler();
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Error:', error);
      return new Response('Internal Server Error: ' + error.message, { status: 500 });
    }
  }
};
