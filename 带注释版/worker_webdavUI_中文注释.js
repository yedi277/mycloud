/**
 * name = "mycloud-webdav-ui"
 * 单用户版 —— WebDAV + 网页UI 双模式
 *
 * 网页访问：/ → 登录 → 文件管理
 * WebDAV端点：/dav/
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
  return p.replace(/\/+$/, '');
}

/**
 * 格式化文件大小（字节转换为可读字符串）
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的文件大小（如 "1.5 MB"）
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + units[i];
}

/**
 * 格式化时间（相对时间：刚刚、X分钟前、X小时前，或具体日期）
 * @param {string|Date} dateStr - 日期字符串或日期对象
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
}

/**
 * 递归删除 R2 中的文件夹（包括所有子文件和子文件夹）
 * @param {object} env - Worker 环境变量
 * @param {string} key - 要删除的文件夹路径（R2 key前缀）
 */
async function deleteR2Folder(env, key) {
  let cursor;
  do {
    const batch = await env.R2_BUCKET.list({ prefix: key + '/', cursor });
    if (batch.objects?.length) {
      await env.R2_BUCKET.delete(batch.objects.map(obj => obj.key));
    }
    cursor = batch.truncated ? batch.cursor : null;
  } while (cursor);
  await env.R2_BUCKET.delete(key).catch(() => {});
}

/**
 * 递归复制 R2 中的文件夹到新位置
 * @param {object} env - Worker 环境变量
 * @param {string} srcKey - 源文件夹路径
 * @param {string} dstKey - 目标文件夹路径
 */
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

// ========== 认证相关函数 ==========
/**
 * 验证请求认证：支持 HTTP Basic Auth、Cookie Token、Bearer Token
 * @param {Request} request - HTTP 请求对象
 * @param {object} env - Worker 环境变量（含 ADMIN_PASSWORD）
 * @returns {object|null} 认证成功返回用户信息，失败返回 null
 */
async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      // 解码 Base64 编码的 Basic Auth 凭证（格式：username:password，这里只校验 password）
      const decoded = atob(authHeader.slice(6));
      const colon = decoded.indexOf(':');
      const pass = decoded.slice(colon + 1);
      if (pass === env.ADMIN_PASSWORD) return { role: 'admin' };
    } catch {}
  }
    // 方式2：检查 Cookie 中的 Token
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/token=([^;]+)/);
  if (match) {
    try {
      const payload = JSON.parse(atob(match[1].split('.')[1]));
      if (payload.exp > Date.now() / 1000 && payload.pass === env.ADMIN_PASSWORD) {
        return { role: 'admin' };
      }
    } catch {}
  }
    // 方式3：检查 Authorization Bearer Token
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp > Date.now() / 1000 && payload.pass === env.ADMIN_PASSWORD) {
        return { role: 'admin' };
      }
    } catch {}
  }
  return null;
}

/**
 * 生成简易 JWT Token（含密码和过期时间）
 * @param {string} pass - 用户密码
 * @returns {string} JWT Token 字符串（header.payload.signature）
 */
function makeToken(pass) {
    // 构建简易 JWT（header.payload.signature，这里 signature 是伪签名）
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({ role: 'admin', pass, exp: now + 86400 * 7 }));
  return `${header}.${payload}.signed`;
}

/**
 * 生成 Token 的 Set-Cookie 响应头字符串
 * @param {string} token - JWT Token
 * @returns {string} Set-Cookie 头字符串
 */
function makeTokenCookie(token) {
  return `token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${86400 * 7}`;
}

// ========== 前端 CSS 样式 ==========
// 网页 UI 的 CSS 样式表（内联在 HTML 中）
const CSS_STYLES = `<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; color: #333; min-height: 100vh; }
.header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
.header h1 { font-size: 20px; font-weight: 600; }
.header-right { display: flex; align-items: center; gap: 12px; }
.btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; transition: all 0.2s; }
.btn-primary { background: rgba(255,255,255,0.2); color: white; }
.btn-primary:hover { background: rgba(255,255,255,0.3); }
.btn-danger { background: #ff4d4f; color: white; }
.container { max-width: 1200px; margin: 24px auto; padding: 0 24px; }
.breadcrumb { display: flex; align-items: center; gap: 4px; margin-bottom: 16px; font-size: 14px; color: #666; }
.breadcrumb a { color: #667eea; text-decoration: none; }
.breadcrumb a:hover { text-decoration: underline; }
.toolbar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.toolbar .btn { background: white; color: #333; border: 1px solid #d9d9d9; }
.toolbar .btn:hover { border-color: #667eea; color: #667eea; }
.file-list { background: white; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); overflow: hidden; }
.file-item { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; transition: background 0.15s; cursor: pointer; }
.file-item:hover { background: #f5f7ff; }
.file-item:last-child { border-bottom: none; }
.file-icon { width: 36px; height: 36px; margin-right: 12px; font-size: 24px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.file-info { flex: 1; min-width: 0; }
.file-name { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-meta { font-size: 12px; color: #999; margin-top: 2px; }
.file-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.file-item:hover .file-actions { opacity: 1; }
.file-actions .btn { padding: 4px 8px; font-size: 12px; background: none; border: 1px solid #d9d9d9; border-radius: 4px; }
.file-actions .btn:hover { border-color: #667eea; color: #667eea; }
.empty-state { text-align: center; padding: 60px 20px; color: #999; }
.empty-state .icon { font-size: 48px; margin-bottom: 12px; }
.modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.45); z-index: 1000; justify-content: center; align-items: center; }
.modal-overlay.active { display: flex; }
.modal { background: white; border-radius: 12px; padding: 24px; min-width: 360px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal h3 { margin-bottom: 16px; font-size: 16px; }
.modal input { width: 100%; padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px; margin-bottom: 12px; }
.modal-buttons { display: flex; gap: 8px; justify-content: flex-end; }
.modal-buttons .btn { background: #f0f0f0; color: #333; }
.modal-buttons .btn-primary { background: #667eea; color: white; }
.progress-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.45); z-index: 2000; justify-content: center; align-items: center; }
.progress-overlay.active { display: flex; }
.progress-box { background: white; border-radius: 12px; padding: 24px; min-width: 320px; text-align: center; }
.progress-bar-bg { width: 100%; height: 8px; background: #f0f0f0; border-radius: 4px; margin: 12px 0; overflow: hidden; }
.progress-bar-fill { height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); border-radius: 4px; transition: width 0.3s; width: 0%; }
#fileInput { display: none; }
.login-container { display: flex; justify-content: center; align-items: center; min-height: 100vh; }
.login-box { background: white; border-radius: 12px; padding: 40px; min-width: 360px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
.login-box h2 { text-align: center; margin-bottom: 24px; color: #333; }
.login-box input { width: 100%; padding: 10px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px; margin-bottom: 16px; }
.login-box .btn { width: 100%; padding: 10px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; border-radius: 6px; font-size: 15px; }
.login-error { color: #ff4d4f; font-size: 13px; margin-bottom: 12px; display: none; }
.toast { position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px; color: white; font-size: 14px; z-index: 3000; transform: translateX(120%); transition: transform 0.3s; }
.toast.active { transform: translateX(0); }
.toast-success { background: #52c41a; }
.toast-error { background: #ff4d4f; }
.toast-warning { background: #faad14; color: #333; }
</style>`;

// ========== 登录页面 HTML 模板 ==========
const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>登录 - 网盘</title>${CSS_STYLES}</head>
<body>
<div class="login-container">
  <div class="login-box">
    <h2>🔒 网盘登录</h2>
    <div class="login-error" id="error">密码错误</div>
    <input type="password" id="password" placeholder="请输入密码" autofocus />
    <button class="btn" onclick="doLogin()">登录</button>
  </div>
</div>
<script>
async function doLogin() {
  const pass = document.getElementById('password').value;
  const resp = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: pass}) });
  const data = await resp.json();
  if(data.success) { document.cookie = 'token='+data.token+'; Path=/; Max-Age='+(86400*7); location.href='/'; }
  else { document.getElementById('error').style.display='block'; }
}
document.getElementById('password').addEventListener('keypress', e => { if(e.key==='Enter') doLogin(); });
</script>
</body>
</html>`;

// ========== 文件管理页面 HTML 模板 ==========
/**
 * 生成文件管理页面的完整 HTML（含内联 CSS 和 JS）
 * @param {string} currentPath - 当前浏览的文件夹路径
 * @returns {string} 完整的 HTML 页面字符串
 */
function getIndexPage(currentPath) {
  const pathDisplay = currentPath || '/';
  const parentPath = currentPath ? currentPath.split('/').slice(0, -1).join('/') : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>网盘 - ${pathDisplay}</title>${CSS_STYLES}</head>
<body>
<div class="header">
  <h1>📁 我的网盘</h1>
  <div class="header-right">
    <span>管理员</span>
    <button class="btn btn-primary" onclick="doLogout()">退出</button>
  </div>
</div>
<div class="container">
  <div class="breadcrumb" id="breadcrumb"></div>
  <div class="toolbar">
    <button class="btn" onclick="goBack()">⬆ 返回上级</button>
    <button class="btn" onclick="showMkdir()">📁 新建文件夹</button>
    <button class="btn" onclick="document.getElementById('fileInput').click()">⬆ 上传文件</button>
    <button class="btn" onclick="doRefresh()">🔄 刷新</button>
  </div>
  <div class="file-list" id="fileList"><div class="empty-state"><div class="icon">⏳</div>加载中...</div></div>
</div>

<input type="file" id="fileInput" multiple />
<div class="modal-overlay" id="mkdirModal">
  <div class="modal"><h3>新建文件夹</h3><input type="text" id="folderName" placeholder="请输入文件夹名称" /><div class="modal-buttons"><button class="btn" onclick="hideMkdir()">取消</button><button class="btn btn-primary" onclick="doMkdir()">创建</button></div></div>
</div>
<div class="modal-overlay" id="renameModal">
  <div class="modal"><h3>重命名</h3><input type="text" id="renameInput" /><div class="modal-buttons"><button class="btn" onclick="hideRename()">取消</button><button class="btn btn-primary" onclick="doRename()">确定</button></div></div>
</div>
<div class="progress-overlay" id="progressOverlay">
  <div class="progress-box"><h3 id="progressTitle">上传中...</h3><div class="progress-bar-bg"><div class="progress-bar-fill" id="progressFill"></div></div><div id="progressPct">0%</div></div>
</div>

<script>
let currentPath = ${JSON.stringify(currentPath || '')};
let renameOldName = '';

function getAuth() { return { headers: { 'Authorization': 'Bearer '+getToken() } }; }
function getToken() { return document.cookie.match(/token=([^;]+)/)?.[1] || ''; }
function apiPathToFilePath(p) { return p ? '/'+p : ''; }

async function loadFiles() {
  const resp = await fetch('/api/list?path='+encodeURIComponent(currentPath), getAuth());
  const data = await resp.json();
  if(!data.success) { if(resp.status===401) location.href='/login'; return; }
  renderFiles(data.files);
}

function renderFiles(files) {
  const list = document.getElementById('fileList');
  let html = '';
  files.forEach(f => {
    const icon = f.type==='folder' ? '📁' : getFileIcon(f.name);
    const href = f.type==='folder' ? '?path='+encodeURIComponent(currentPath ? currentPath+'/'+f.name : f.name) : '/api/download?path='+encodeURIComponent(apiPathToFilePath(currentPath))+'&name='+encodeURIComponent(f.name);
    const click = f.type==='folder' ? 'onclick="enterFolder(\\''+f.name.replace(/'/g,'\\\\\\'')+'\\')"' : '';
    html += '<div class="file-item" '+click+'>' +
      '<div class="file-icon">'+icon+'</div>' +
      '<div class="file-info"><div class="file-name"><a href="'+href+'" '+(f.type!=='folder'?'target="_blank"':'')+'>'+escHtml(f.name)+'</a></div>' +
      '<div class="file-meta">'+formatSize(f.size)+(f.modified?' · '+f.modified:'')+'</div></div>' +
      '<div class="file-actions">' +
        '<button class="btn" onclick="event.stopPropagation();showRename(\\''+f.name.replace(/'/g,'\\\\\\'')+'\\',\\''+f.type+'\\')">✏️</button>' +
        '<button class="btn" onclick="event.stopPropagation();doDelete(\\''+f.name.replace(/'/g,'\\\\\\'')+'\\',\\''+f.type+'\\')">🗑️</button>' +
      '</div></div>';
  });
  list.innerHTML = html || '<div class="empty-state"><div class="icon">📭</div>暂无文件</div>';
  renderBreadcrumb();
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  let html = '<a href="/">🏠 根目录</a>';
  if(currentPath) {
    const parts = currentPath.split('/');
    let p = '';
    parts.forEach((part,i) => {
      p += (i? '/':'') + part;
      html += ' / <a href="?path='+encodeURIComponent(p)+'">'+escHtml(part)+'</a>';
    });
  }
  bc.innerHTML = html;
}

function enterFolder(name) {
  currentPath = currentPath ? currentPath+'/'+name : name;
  history.pushState(null,'', '?path='+encodeURIComponent(currentPath));
  loadFiles();
}

function goBack() {
  if(!currentPath) return;
  const parts = currentPath.split('/');
  parts.pop();
  currentPath = parts.join('/');
  history.pushState(null,'', currentPath ? '?path='+encodeURIComponent(currentPath) : '/');
  loadFiles();
}

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search);
  currentPath = params.get('path') || '';
  loadFiles();
});

async function doDelete(name, type) {
  if(!confirm('确定删除 '+name+' 吗？')) return;
  const path = currentPath ? currentPath+'/'+name : name;
  const resp = await fetch('/api/delete?path='+encodeURIComponent(apiPathToFilePath(path)), { method: 'DELETE', ...getAuth() });
  const data = await resp.json();
  showToast(data.message, data.success?'success':'error');
  if(data.success) loadFiles();
}

function showMkdir() { document.getElementById('mkdirModal').classList.add('active'); document.getElementById('folderName').value=''; document.getElementById('folderName').focus(); }
function hideMkdir() { document.getElementById('mkdirModal').classList.remove('active'); }
async function doMkdir() {
  const name = document.getElementById('folderName').value.trim();
  if(!name) return;
  const path = currentPath ? currentPath+'/'+name : name;
  const resp = await fetch('/api/mkdir', { method: 'POST', ...getAuth(), headers: {...getAuth().headers, 'Content-Type':'application/json'}, body: JSON.stringify({path: apiPathToFilePath(path)}) });
  const data = await resp.json();
  showToast(data.message, data.success?'success':'error');
  if(data.success) { hideMkdir(); loadFiles(); }
}

function showRename(name, type) { renameOldName = name; document.getElementById('renameInput').value=name; document.getElementById('renameModal').classList.add('active'); document.getElementById('renameInput').focus(); }
function hideRename() { document.getElementById('renameModal').classList.remove('active'); }
async function doRename() {
  const newName = document.getElementById('renameInput').value.trim();
  if(!newName || newName===renameOldName) { hideRename(); return; }
  const oldPath = currentPath ? currentPath+'/'+renameOldName : renameOldName;
  const newPath = currentPath ? currentPath+'/'+newName : newName;
  const resp = await fetch('/api/rename', { method: 'POST', ...getAuth(), headers: {...getAuth().headers, 'Content-Type':'application/json'}, body: JSON.stringify({oldPath: apiPathToFilePath(oldPath), newPath: apiPathToFilePath(newPath)}) });
  const data = await resp.json();
  showToast(data.message, data.success?'success':'error');
  if(data.success) { hideRename(); loadFiles(); }
}

const SMALL = 1*1024*1024;
document.getElementById('fileInput').addEventListener('change', async e => {
  const files = e.target.files;
  if(!files.length) return;
  const oversized = [];
  for(let i=0;i<files.length;i++) if(files[i].size>100*1024*1024) oversized.push(files[i].name);
  if(oversized.length) { showToast('以下文件超过100MB：'+oversized.join('、'), 'error'); return; }
  const small = [], large = [];
  for(let i=0;i<files.length;i++) (files[i].size<=SMALL?small:large).push(files[i]);
  let success=0, fail=0;
  const total=files.length;
  document.getElementById('progressOverlay').classList.add('active');

  async function uploadOne(file) {
    const formData = new FormData();
    formData.append('file', file);
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = e => {
        if(e.lengthComputable) {
          const pct = Math.min(100, Math.floor(e.loaded/e.total*100));
          document.getElementById('progressFill').style.width = pct+'%';
          document.getElementById('progressPct').textContent = pct+'%';
        }
      };
      xhr.onload = () => { if(xhr.status===200) success++; else fail++; resolve(); };
      xhr.onerror = () => { fail++; resolve(); };
      xhr.open('POST', '/api/upload?path='+encodeURIComponent(currentPath||''));
      xhr.setRequestHeader('Authorization', 'Bearer '+getToken());
      xhr.send(formData);
    });
  }

  if(small.length) await Promise.all(small.map(uploadOne));
  for(const f of large) await uploadOne(f);

  document.getElementById('progressOverlay').classList.remove('active');
  document.getElementById('progressFill').style.width='0%';
  if(fail===0) showToast('成功上传 '+success+' 个文件', 'success');
  else if(success===0) showToast('上传失败：'+fail+' 个文件', 'error');
  else showToast('上传完成：成功 '+success+' 个，失败 '+fail+' 个', 'warning');
  loadFiles();
  e.target.value = '';
});

function doRefresh() { loadFiles(); }
function doLogout() { document.cookie='token=; Path=/; Max-Age=0'; location.href='/login'; }

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if(['png','jpg','jpeg','gif','webp','svg','ico'].includes(ext)) return '🖼️';
  if(['mp4','webm','avi','mov'].includes(ext)) return '🎬';
  if(['mp3','wav','flac','aac'].includes(ext)) return '🎵';
  if(['pdf'].includes(ext)) return '📄';
  if(['doc','docx'].includes(ext)) return '📝';
  if(['xls','xlsx'].includes(ext)) return '📊';
  if(['zip','rar','7z','tar','gz'].includes(ext)) return '📦';
  return '📄';
}
function formatSize(bytes) { if(!bytes) return '-'; const u=['B','KB','MB','GB']; const i=Math.floor(Math.log(bytes)/Math.log(1024)); return parseFloat((bytes/Math.pow(1024,i)).toFixed(1))+' '+u[i]; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showToast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast toast-'+type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add('active'),10);
  setTimeout(()=>{ t.classList.remove('active'); setTimeout(()=>t.remove(),300); },3000);
}

loadFiles();
</script>
</body>
</html>`;
}

// ========== REST API 接口处理函数 ==========
/**
 * 处理登录 API（/api/login）：验证密码，返回 Token
 * @param {Request} request - HTTP 请求（含 password 字段的 JSON body）
 * @param {object} env - Worker 环境变量
 * @returns {Response} 成功返回 Token，失败返回 401
 */
async function handleApiLogin(request, env) {
  try {
    const { password } = await request.json();
    if (password !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ success: false, message: '密码错误' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }
    const token = makeToken(password);
    return new Response(JSON.stringify({ success: true, token }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': makeTokenCookie(token) }
    });
  } catch (e) {
    return jsonResponse({ success: false, message: '请求错误' }, 400);
  }
}

/**
 * 处理文件列表 API（/api/list）：列出指定路径下的文件和文件夹
 * @param {Request} request - HTTP 请求（含 path 查询参数）
 * @param {object} env - Worker 环境变量
 * @returns {Response} JSON 格式的文件列表
 */
async function handleApiList(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const reqPath = normalizePath(url.searchParams.get('path') || '');

  try {
    const prefix = reqPath ? reqPath + '/' : '';
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
          const name = dp.replace(prefix, '').replace(/\/$/, '');
          if (name) folders.add(name);
        }
      }
      cursor = batch.truncated ? batch.cursor : null;
    } while (cursor);

    const files = [];
    for (const name of folders) {
      files.push({ name, type: 'folder', size: 0, modified: '' });
    }
    for (const obj of objects) {
      const name = obj.key.slice(prefix.length);
      if (name) {
        files.push({
          name,
          type: 'file',
          size: obj.size,
          modified: obj.uploaded ? formatTime(obj.uploaded) : ''
        });
      }
    }

    return jsonResponse({ success: true, files, path: reqPath });
  } catch (e) {
    return jsonResponse({ success: false, message: e.message }, 500);
  }
}

/**
 * 处理文件上传 API（/api/upload）：接收表单文件，存入 R2
 * @param {Request} request - HTTP 请求（FormData，含 file 字段）
 * @param {object} env - Worker 环境变量
 * @returns {Response} 上传结果 JSON
 */
async function handleApiUpload(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  try {
    const url = new URL(request.url);
    const reqPath = normalizePath(url.searchParams.get('path') || '');
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return jsonResponse({ success: false, message: '没有上传文件' }, 400);

    const key = reqPath ? reqPath + '/' + file.name : file.name;
    await env.R2_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || getMimeType(file.name) }
    });
    return jsonResponse({ success: true, message: '文件上传成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '上传失败: ' + e.message }, 500);
  }
}

/**
 * 处理文件/文件夹删除 API（/api/delete）
 * @param {Request} request - HTTP 请求（含 path 查询参数）
 * @param {object} env - Worker 环境变量
 * @returns {Response} 删除结果 JSON
 */
async function handleApiDelete(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  try {
    const url = new URL(request.url);
    let key = normalizePath(url.searchParams.get('path') || '');

    const listed = await env.R2_BUCKET.list({ prefix: key + '/', limit: 1 });
    if (listed.objects?.length > 0) {
      await deleteR2Folder(env, key);
    } else {
      await env.R2_BUCKET.delete(key);
    }

    return jsonResponse({ success: true, message: '删除成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '删除失败: ' + e.message }, 500);
  }
}

/**
 * 处理新建文件夹 API（/api/mkdir）
 * @param {Request} request - HTTP 请求（含 path 字段的 JSON body）
 * @param {object} env - Worker 环境变量
 * @returns {Response} 创建结果 JSON
 */
async function handleApiMkdir(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  try {
    const { path } = await request.json();
    const key = normalizePath(path);
    await env.R2_BUCKET.put(key + '/.keep', '', { httpMetadata: { contentType: 'text/plain' } });
    return jsonResponse({ success: true, message: '文件夹创建成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '创建失败: ' + e.message }, 500);
  }
}

/**
 * 处理重命名/移动 API（/api/rename）
 * @param {Request} request - HTTP 请求（含 oldPath、newPath 字段的 JSON body）
 * @param {object} env - Worker 环境变量
 * @returns {Response} 重命名结果 JSON
 */
async function handleApiRename(request, env) {
  const auth = await verifyAuth(request, env);
  if (!auth) return jsonResponse({ success: false, message: 'Unauthorized' }, 401);

  try {
    const { oldPath, newPath } = await request.json();
    const srcKey = normalizePath(oldPath);
    const dstKey = normalizePath(newPath);

    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (srcObj) {
      await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
      await env.R2_BUCKET.delete(srcKey);
    } else {
      const listed = await env.R2_BUCKET.list({ prefix: srcKey + '/', limit: 1 });
      if (listed.objects?.length > 0 || listed.delimitedPrefixes?.length > 0) {
        await copyR2Folder(env, srcKey, dstKey);
        await deleteR2Folder(env, srcKey);
      } else {
        return jsonResponse({ success: false, message: '源不存在' }, 404);
      }
    }

    return jsonResponse({ success: true, message: '重命名成功' });
  } catch (e) {
    return jsonResponse({ success: false, message: '重命名失败: ' + e.message }, 500);
  }
}

/**
 * 构建 JSON 格式的 HTTP 响应
 * @param {object} data - 要序列化为 JSON 的数据对象
 * @param {number} status - HTTP 状态码，默认 200
 * @returns {Response} JSON 响应对象
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ========== WebDAV 处理方法 ==========
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

/**
 * 处理 WebDAV PROPFIND 请求（列出文件/文件夹属性）
 * @param {Request} request - HTTP 请求对象
 * @param {object} env - Worker 环境变量
 * @param {string} davPath - WebDAV 路径
 * @returns {Response} 包含文件属性的 XML 响应（207 MultiStatus）
 */
async function handleDavPropfind(request, env, davPath) {
  const auth = await verifyAuth(request, env);
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
  const auth = await verifyAuth(request, env);
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
  const auth = await verifyAuth(request, env);
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
 * @returns {Response} 201 创建成功
 */
async function handleDavPut(request, env, davPath) {
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
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
  const auth = await verifyAuth(request, env);
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
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const key = davPath;
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
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    // 解析结果：srcKey=源路径，dstKey=目标路径
    const { srcKey, dstKey } = parsed;

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
  const auth = await verifyAuth(request, env);
  if (!auth) return requireDavAuth(request);

  try {
    const parsed = await parseDavDestination(request, davPath);
    if (parsed instanceof Response) return parsed;
    // 解析结果：srcKey=源路径，dstKey=目标路径
    const { srcKey, dstKey } = parsed;

    const srcObj = await env.R2_BUCKET.get(srcKey);
    if (srcObj) {
      await env.R2_BUCKET.put(dstKey, srcObj.body, { httpMetadata: srcObj.httpMetadata });
      return new Response(null, { status: 201 });
    }

    const srcList = await env.R2_BUCKET.list({ prefix: srcKey + '/', limit: 1 });
    if (srcList.objects?.length > 0 || srcList.delimitedPrefixes?.length > 0) {
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

// ========== Worker 主入口 ==========
/**
 * Cloudflare Worker 主入口：处理所有传入的 HTTP 请求
 * 路由逻辑：
 *   1. OPTIONS 请求 → CORS 预检响应
 *   2. GET /login → 登录页面
 *   3. POST /api/login → 登录 API
 *   4. GET / → 文件管理页面（需认证）
 *   5. /api/* → REST API 接口（需认证）
 *   6. /dav/* → WebDAV 处理
 *   7. 其他 → 404 Not Found
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 解析请求 URL、路径和 HTTP 方法
    const path = decodeURIComponent(url.pathname);
    const method = request.method;
    // 解析请求 URL、路径和 HTTP 方法

    // --- 处理 CORS 预检请求（OPTIONS）---
    if (method === 'OPTIONS') {
      if (path.startsWith('/dav')) {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, OPTIONS, HEAD, LOCK, UNLOCK',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, Destination, Overwrite, Range',
          }
        });
      }
      return new Response(null, { status: 204 });
    }

    try {
    // --- 登录页面（无需认证）---
      if (path === '/login' && method === 'GET') {
        return new Response(LOGIN_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

    // --- API 登录接口（无需认证）---
      if (path === '/api/login' && method === 'POST') {
        return await handleApiLogin(request, env);
      }
    // --- 以下路由需要认证 ---
    // 验证用户登录状态（Cookie Token 或 HTTP Basic Auth）
      const auth = await verifyAuth(request, env);

    // --- 文件管理页面（需认证）---
      if (path === '/' || path === '/index.html') {
        if (!auth) return Response.redirect(url.origin + '/login', 302);
        const params = new URLSearchParams(url.search);
        const currentPath = params.get('path') || '';
        return new Response(getIndexPage(currentPath), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

    // --- REST API 接口（需认证）---
      if (path === '/api/list') return await handleApiList(request, env);
      if (path === '/api/upload') return await handleApiUpload(request, env);
      if (path === '/api/delete') return await handleApiDelete(request, env);
      if (path === '/api/mkdir') return await handleApiMkdir(request, env);
      if (path === '/api/rename') return await handleApiRename(request, env);
    // --- 文件下载接口（需认证）---
      if (path === '/api/download') {
        if (!auth) return new Response('Unauthorized', { status: 401 });
        const filePath = normalizePath(url.searchParams.get('path') || '');
        const fileName = url.searchParams.get('name') || '';
        const key = fileName ? filePath + '/' + fileName : filePath;
        const obj = await env.R2_BUCKET.get(key);
        if (!obj) return new Response('Not Found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || getMimeType(key),
            'Content-Disposition': 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(fileName || key.split('/').pop()) + '\'',
            'Content-Length': obj.size,
          }
        });
      }
    // --- WebDAV 端点（需认证）---
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
