const state = {
  ready: false,
  activeThreadId: null,
  threads: new Map(),
  historyThreads: [],
  defaultProjects: [],
  currentPath: "/Users/yangs/Documents/New project",
  selectedPath: "/Users/yangs/Documents/New project",
  eventCount: 0,
  messagesById: new Map(),
  threadByCwd: new Map(),
  auth: null,
  sidebarOpen: window.innerWidth > 980,
  activityOpen: false
};

const els = {
  drawerBackdrop: document.querySelector("#drawerBackdrop"),
  menuToggle: document.querySelector("#menuToggle"),
  closeSidebar: document.querySelector("#closeSidebar"),
  activityToggle: document.querySelector("#activityToggle"),
  closeActivity: document.querySelector("#closeActivity"),
  connectionState: document.querySelector("#connectionState"),
  refreshStatus: document.querySelector("#refreshStatus"),
  cwdInput: document.querySelector("#cwdInput"),
  openPath: document.querySelector("#openPath"),
  quickPaths: document.querySelector("#quickPaths"),
  goParent: document.querySelector("#goParent"),
  attachDirectory: document.querySelector("#attachDirectory"),
  directoryList: document.querySelector("#directoryList"),
  newThread: document.querySelector("#newThread"),
  threadList: document.querySelector("#threadList"),
  threadTitle: document.querySelector("#threadTitle"),
  threadMeta: document.querySelector("#threadMeta"),
  modelInput: document.querySelector("#modelInput"),
  loginButton: document.querySelector("#loginButton"),
  approvalPolicy: document.querySelector("#approvalPolicy"),
  sandboxMode: document.querySelector("#sandboxMode"),
  messages: document.querySelector("#messages"),
  promptInput: document.querySelector("#promptInput"),
  busyState: document.querySelector("#busyState"),
  interruptTurn: document.querySelector("#interruptTurn"),
  sendPrompt: document.querySelector("#sendPrompt"),
  eventCount: document.querySelector("#eventCount"),
  clearEvents: document.querySelector("#clearEvents"),
  activityStream: document.querySelector("#activityStream")
};

els.authPanel = document.querySelector("#authPanel");
els.requestPanel = document.querySelector("#requestPanel");
els.loginDialog = document.querySelector("#loginDialog");
els.deviceLogin = document.querySelector("#deviceLogin");
els.browserLogin = document.querySelector("#browserLogin");
els.apiKeyLogin = document.querySelector("#apiKeyLogin");
els.apiKeyInput = document.querySelector("#apiKeyInput");
els.loginResult = document.querySelector("#loginResult");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function basename(value) {
  const trimmed = String(value || "").replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed || "/";
}

function normalizePath(value) {
  const text = String(value || "").trim();
  if (!text || text === "/") return text || "/";
  return text.replace(/\/+$/, "");
}

function formatTime(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString("zh-CN", { hour12: false });
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function syncShell() {
  document.body.classList.toggle("sidebar-collapsed", !state.sidebarOpen && !isMobileLayout());
  document.body.classList.toggle("sidebar-open", state.sidebarOpen && isMobileLayout());
  document.body.classList.toggle("activity-open", state.activityOpen);
  const showBackdrop = (state.sidebarOpen && isMobileLayout()) || state.activityOpen;
  els.drawerBackdrop.hidden = !showBackdrop;
}

function closeSidebar() {
  state.sidebarOpen = false;
  syncShell();
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  if (state.sidebarOpen && isMobileLayout()) state.activityOpen = false;
  syncShell();
}

function openActivity() {
  state.activityOpen = true;
  if (isMobileLayout()) state.sidebarOpen = false;
  syncShell();
}

function closeActivity() {
  state.activityOpen = false;
  syncShell();
}

function updateEventCountLabel() {
  els.eventCount.textContent = String(state.eventCount);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

async function refreshStatus() {
  const data = await api("/api/status");
  state.ready = data.ready;
  state.defaultProjects = data.defaultProjects || [];
  renderAuth(data.auth);
  syncThreads(data.threads || [], data.activeThreadId);
  els.connectionState.textContent = data.ready ? "Ready" : "Starting";
  renderQuickPaths();
  renderThreads();
  renderActiveThread(Boolean(state.activeThreadId));
}

async function refreshAuth() {
  const auth = await api("/api/auth/status");
  renderAuth(auth);
  return auth;
}

function renderAuth(auth) {
  state.auth = auth || null;
  const method = auth?.authMethod || null;
  const account = auth?.account || null;
  const label = method ? `${method}${account?.email ? ` · ${account.email}` : ""}` : "未登录";
  els.loginButton.textContent = method ? "管理登录" : "登录 Codex";
  els.authPanel.innerHTML = `
    <div class="auth-card">
      <strong>${escapeHtml(label)}</strong>
      <p>${method ? "模型任务可以使用当前 Codex 认证。" : "当前 app-server 没有可用认证；可以浏览目录和创建线程，但发送模型任务会失败。"}</p>
    </div>
  `;
  renderActiveThread();
}

async function startLogin(mode) {
  const payload = { mode };
  if (mode === "apiKey") payload.apiKey = els.apiKeyInput.value.trim();
  const result = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (result.type === "chatgptDeviceCode") {
    els.loginResult.textContent = `打开：${result.verificationUrl}\n输入代码：${result.userCode}\n完成后本页会自动更新认证状态。`;
    window.open(result.verificationUrl, "_blank", "noopener,noreferrer");
  } else if (result.type === "chatgpt") {
    els.loginResult.textContent = `浏览器登录已启动：${result.authUrl}`;
    window.open(result.authUrl, "_blank", "noopener,noreferrer");
  } else {
    els.loginResult.textContent = "登录请求已发送。";
  }
  setTimeout(() => refreshAuth().catch(showError), 2500);
}

function syncThreads(threads, activeThreadId) {
  for (const raw of threads) {
    state.threads.set(raw.id, raw);
    if (raw.cwd) state.threadByCwd.set(normalizePath(raw.cwd), raw.id);
  }
  if (activeThreadId) state.activeThreadId = activeThreadId;
}

async function loadDirectory(targetPath = state.currentPath) {
  const data = await api(`/api/fs/list?path=${encodeURIComponent(targetPath)}`);
  state.currentPath = data.path;
  els.cwdInput.value = data.path;
  state.selectedPath = data.path;
  els.directoryList.innerHTML = "";
  loadHistoryThreads(data.path).catch(showError);

  for (const entry of data.entries) {
    const row = document.createElement("div");
    row.className = "dir-entry";
    row.innerHTML = `
      <button class="dir-open" type="button">
        <span class="dir-name">${entry.isDirectory ? "▸ " : ""}${escapeHtml(entry.name)}</span>
        <span class="kind">${entry.isDirectory ? "目录" : "文件"}</span>
      </button>
      ${entry.isDirectory ? '<button class="attach-dir" type="button">接入</button>' : ""}
    `;
    row.querySelector(".dir-open").addEventListener("click", () => {
      if (entry.isDirectory) {
        loadDirectory(entry.path).catch(showError);
      }
    });
    row.querySelector(".attach-dir")?.addEventListener("click", () => {
      attachDirectory(entry.path).catch(showError);
    });
    els.directoryList.appendChild(row);
  }

  els.goParent.onclick = () => loadDirectory(data.parent).catch(showError);
}

function renderQuickPaths() {
  els.quickPaths.innerHTML = "";
  for (const project of state.defaultProjects) {
    const button = document.createElement("button");
    button.textContent = basename(project);
    button.title = project;
    button.addEventListener("click", () => attachDirectory(project).catch(showError));
    els.quickPaths.appendChild(button);
  }
}

function selectDirectory(targetPath) {
  state.selectedPath = targetPath;
  els.cwdInput.value = targetPath;
  loadHistoryThreads(targetPath).catch(showError);
  renderActiveThread();
  if (isMobileLayout()) closeSidebar();
}

async function loadHistoryThreads(cwd = state.selectedPath) {
  const data = await api(`/api/threads/history?cwd=${encodeURIComponent(cwd)}&limit=20`);
  state.historyThreads = data.threads || [];
  for (const raw of state.historyThreads) {
    if (raw.cwd) state.threadByCwd.set(normalizePath(raw.cwd), raw.id);
  }
  renderThreads();
}

function findThreadForCwd(cwd) {
  const key = normalizePath(cwd);
  const mappedId = state.threadByCwd.get(key);
  const mapped = mappedId ? state.threads.get(mappedId) : null;
  if (mapped) return mapped;
  return [...state.threads.values()]
    .filter((thread) => normalizePath(thread.cwd) === key)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

function activateThread(thread, rebuild = true) {
  state.activeThreadId = thread.id;
  if (thread.cwd) {
    state.selectedPath = thread.cwd;
    els.cwdInput.value = thread.cwd;
    state.threadByCwd.set(normalizePath(thread.cwd), thread.id);
  }
  renderThreads();
  renderActiveThread(rebuild);
  if (isMobileLayout()) closeSidebar();
}

async function startThread(cwdOverride) {
  const cwd = cwdOverride || els.cwdInput.value.trim() || state.selectedPath;
  const model = els.modelInput.value.trim() || undefined;
  const approvalPolicy = els.approvalPolicy.value;
  const sandbox = els.sandboxMode.value;
  const data = await api("/api/thread/start", {
    method: "POST",
    body: JSON.stringify({ cwd, model, approvalPolicy, sandbox })
  });
  state.threads.set(data.thread.id, data.thread);
  state.selectedPath = data.thread.cwd || cwd;
  state.threadByCwd.set(normalizePath(state.selectedPath), data.thread.id);
  clearMessagesDom();
  activateThread(data.thread, false);
  return data.thread;
}

async function attachDirectory(targetPath = els.cwdInput.value.trim() || state.currentPath) {
  const cwd = normalizePath(targetPath);
  selectDirectory(cwd);
  const existing = findThreadForCwd(cwd);
  if (existing && existing.messages) {
    activateThread(existing, true);
    return existing;
  }
  const model = els.modelInput.value.trim() || undefined;
  const approvalPolicy = els.approvalPolicy.value;
  const sandbox = els.sandboxMode.value;
  const data = await api("/api/thread/attach", {
    method: "POST",
    body: JSON.stringify({ cwd, model, approvalPolicy, sandbox })
  });
  state.threads.set(data.thread.id, data.thread);
  state.threadByCwd.set(normalizePath(data.thread.cwd || cwd), data.thread.id);
  activateThread(data.thread, true);
  return data.thread;
}

async function resumeThread(thread) {
  const model = els.modelInput.value.trim() || undefined;
  const approvalPolicy = els.approvalPolicy.value;
  const sandbox = els.sandboxMode.value;
  const data = await api("/api/thread/resume", {
    method: "POST",
    body: JSON.stringify({
      threadId: thread.id,
      cwd: thread.cwd || state.selectedPath,
      model,
      approvalPolicy,
      sandbox
    })
  });
  state.threads.set(data.thread.id, data.thread);
  state.threadByCwd.set(normalizePath(data.thread.cwd || thread.cwd || state.selectedPath), data.thread.id);
  activateThread(data.thread, true);
  return data.thread;
}

async function sendPrompt() {
  const text = els.promptInput.value.trim();
  if (!text) return;
  if (!state.activeThreadId) {
    await attachDirectory();
  }
  const thread = state.threads.get(state.activeThreadId);
  els.promptInput.value = "";
  await api("/api/turn/start", {
    method: "POST",
    body: JSON.stringify({
      threadId: state.activeThreadId,
      text,
      cwd: thread?.cwd || state.selectedPath,
      model: els.modelInput.value.trim() || undefined,
      approvalPolicy: els.approvalPolicy.value
    })
  });
  await refreshStatus();
}

async function interruptTurn() {
  const thread = state.threads.get(state.activeThreadId);
  if (!thread?.activeTurnId) return;
  await api("/api/turn/interrupt", {
    method: "POST",
    body: JSON.stringify({ threadId: thread.id, turnId: thread.activeTurnId })
  });
}

function renderThreads() {
  els.threadList.innerHTML = "";
  const seen = new Set();
  const selectedKey = normalizePath(state.selectedPath || els.cwdInput.value);
  const loadedThreads = [...state.threads.values()]
    .filter((thread) => normalizePath(thread.cwd) === selectedKey);
  const threads = [...loadedThreads, ...state.historyThreads]
    .filter((thread) => {
      if (seen.has(thread.id)) return false;
      seen.add(thread.id);
      return true;
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!threads.length) {
    els.threadList.innerHTML = '<div class="thread-empty">此目录还没有历史对话</div>';
    return;
  }
  for (const thread of threads) {
    const button = document.createElement("button");
    button.className = `thread-card${thread.id === state.activeThreadId ? " active" : ""}`;
    const title = thread.title || thread.preview || "Untitled";
    const source = thread.status?.type === "notLoaded" ? "历史" : (thread.busy ? "运行中" : "已接入");
    button.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(thread.cwd || "")}</span>
      <span>${escapeHtml(source)}${thread.model || thread.modelProvider ? ` · ${escapeHtml(thread.model || thread.modelProvider)}` : ""}</span>
    `;
    button.addEventListener("click", () => {
      if (state.threads.has(thread.id) && state.threads.get(thread.id).messages) {
        activateThread(state.threads.get(thread.id), true);
      } else {
        resumeThread(thread).catch(showError);
      }
    });
    els.threadList.appendChild(button);
  }
}

function renderActiveThread(rebuild = false) {
  const thread = state.threads.get(state.activeThreadId);
  const cwd = thread?.cwd || state.selectedPath || els.cwdInput.value;
  const authMissing = state.auth?.requiresOpenaiAuth && !state.auth?.authMethod;
  els.threadTitle.textContent = thread ? thread.title || basename(cwd) : "新建 Codex 对话";
  els.threadMeta.textContent = thread?.busy ? "Codex 正在处理" : "";
  els.busyState.textContent = thread?.busy ? "Running" : "Ready";
  els.interruptTurn.disabled = !thread?.busy;
  els.sendPrompt.disabled = !state.ready || Boolean(thread?.busy) || Boolean(authMissing);
  els.promptInput.placeholder = authMissing
    ? "请先登录 Codex，然后发送任务"
    : "输入任务，例如：总结这个项目结构";

  if (thread?.cwd) {
    state.selectedPath = thread.cwd;
    els.cwdInput.value = thread.cwd;
  }

  if (rebuild) {
    clearMessagesDom();
    for (const message of thread?.messages || []) {
      renderMessage(message);
    }
    renderEvents(thread?.events || [], true);
  }
}

function clearMessagesDom() {
  els.messages.innerHTML = "";
  state.messagesById.clear();
}

function renderMessage(message) {
  if (state.messagesById.has(message.id)) {
    const node = state.messagesById.get(message.id);
    node.querySelector(".bubble").textContent = message.text || "";
    return;
  }
  if (els.messages.querySelector(".empty-state")) {
    els.messages.innerHTML = "";
  }
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  node.dataset.messageId = message.id;
  node.innerHTML = `
    <div class="role">${message.role === "user" ? "You" : "Codex"}</div>
    <div class="bubble"></div>
  `;
  node.querySelector(".bubble").textContent = message.text || "";
  els.messages.appendChild(node);
  state.messagesById.set(message.id, node);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function applyMessageDelta(payload) {
  let node = [...state.messagesById.values()].find((el) => el.dataset.itemId === payload.itemId);
  const id = payload.message?.id || `assistant-${payload.itemId}`;
  if (!node) {
    const msg = payload.message || { id, role: "assistant", text: "", itemId: payload.itemId };
    renderMessage(msg);
    node = state.messagesById.get(msg.id);
    if (node) node.dataset.itemId = payload.itemId;
  }
  if (node) {
    node.querySelector(".bubble").textContent = payload.message?.text || "";
    els.messages.scrollTop = els.messages.scrollHeight;
  }
}

function addEvent(event) {
  state.eventCount += 1;
  updateEventCountLabel();
  const node = document.createElement("section");
  const kind = event.kind || "status";
  node.className = `event ${kind}`;
  node.innerHTML = `
    <div class="event-title">
      <strong>${escapeHtml(event.label || kind)}</strong>
      <time>${formatTime(event.ts)}</time>
    </div>
    ${renderEventBody(event)}
  `;
  els.activityStream.prepend(node);
}

function renderEventBody(event) {
  if (event.command) {
    return `<pre>${escapeHtml(`${event.cwd || ""}\n$ ${event.command}${event.output ? `\n\n${event.output}` : ""}`)}</pre>`;
  }
  if (event.delta) {
    return `<pre>${escapeHtml(event.delta)}</pre>`;
  }
  if (event.changes) {
    return `<pre>${escapeHtml(JSON.stringify(event.changes, null, 2))}</pre>`;
  }
  if (event.params || event.item || event.error) {
    return `<pre>${escapeHtml(JSON.stringify(event.params || event.item || event.error, null, 2))}</pre>`;
  }
  return "";
}

function renderEvents(events, replace = false) {
  if (replace) {
    els.activityStream.innerHTML = "";
    state.eventCount = 0;
    updateEventCountLabel();
  }
  for (const event of events) addEvent(event);
}

function showError(error) {
  addEvent({
    ts: Date.now(),
    kind: "status",
    label: "Error",
    error: { message: error.message || String(error) }
  });
  els.connectionState.textContent = "Error";
  openActivity();
}

function renderServerRequest(request) {
  openActivity();
  const id = String(request.id);
  const method = request.method;
  const params = request.params || {};
  const card = document.createElement("section");
  card.className = "request-card";
  card.dataset.requestId = id;

  const title = method.includes("commandExecution")
    ? "命令需要批准"
    : method.includes("fileChange")
      ? "文件修改需要批准"
      : method.includes("permissions")
        ? "权限请求"
        : "需要输入";

  const detail = params.command
    ? `${params.cwd || ""}\n$ ${params.command}`
    : params.reason || params.questions?.map((q) => q.question).join("\n") || JSON.stringify(params, null, 2);

  card.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(method)}</p>
    <pre>${escapeHtml(detail)}</pre>
    <div class="request-actions">
      <button class="primary" data-decision="accept">批准</button>
      <button data-decision="acceptForSession">本会话批准</button>
      <button class="danger" data-decision="decline">拒绝</button>
    </div>
  `;

  card.querySelectorAll("button[data-decision]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/server-request/respond", {
        method: "POST",
        body: JSON.stringify({ requestId: id, decision: button.dataset.decision })
      });
      card.remove();
    });
  });

  els.requestPanel.prepend(card);
}

function connectEvents() {
  const events = new EventSource("/events");
  events.onmessage = (message) => {
    const payload = JSON.parse(message.data);
    switch (payload.type) {
      case "hello":
        els.connectionState.textContent = payload.ready ? "Ready" : "Starting";
        break;
      case "bridge-status":
        els.connectionState.textContent = payload.status === "ready" ? "Ready" : payload.status;
        break;
      case "auth-status":
        renderAuth(payload.auth);
        break;
      case "auth-event":
        refreshAuth().catch(showError);
        break;
      case "server-request":
        renderServerRequest(payload.request);
        break;
      case "server-request-resolved":
        document.querySelector(`[data-request-id="${CSS.escape(String(payload.requestId))}"]`)?.remove();
        break;
      case "threads":
        syncThreads(payload.threads || [], payload.activeThreadId);
        renderThreads();
        renderActiveThread(Boolean(state.activeThreadId));
        break;
      case "thread-hydrated":
        if (payload.thread) {
          state.threads.set(payload.thread.id, payload.thread);
          if (payload.thread.cwd) state.threadByCwd.set(normalizePath(payload.thread.cwd), payload.thread.id);
          if (payload.threadId === state.activeThreadId) renderActiveThread(true);
        }
        break;
      case "message":
        if (payload.threadId === state.activeThreadId) renderMessage(payload.message);
        break;
      case "message-delta":
        if (payload.threadId === state.activeThreadId) applyMessageDelta(payload);
        break;
      case "thread-event":
        if (payload.threadId === state.activeThreadId) addEvent(payload.event);
        break;
      case "item":
        break;
      case "codex-stderr":
        addEvent({ ts: Date.now(), kind: "status", label: "Codex", delta: payload.text });
        openActivity();
        break;
      default:
        break;
    }
  };
  events.onerror = () => {
    els.connectionState.textContent = "Reconnecting";
  };
}

els.menuToggle.addEventListener("click", () => toggleSidebar());
els.closeSidebar.addEventListener("click", () => closeSidebar());
els.activityToggle.addEventListener("click", () => {
  state.activityOpen ? closeActivity() : openActivity();
});
els.closeActivity.addEventListener("click", () => closeActivity());
els.drawerBackdrop.addEventListener("click", () => {
  closeActivity();
  closeSidebar();
});
els.refreshStatus.addEventListener("click", () => refreshStatus().catch(showError));
els.loginButton.addEventListener("click", () => {
  els.loginResult.textContent = "";
  els.loginDialog.showModal();
  refreshAuth().catch(showError);
});
els.deviceLogin.addEventListener("click", () => startLogin("chatgptDeviceCode").catch(showError));
els.browserLogin.addEventListener("click", () => startLogin("chatgpt").catch(showError));
els.apiKeyLogin.addEventListener("click", () => startLogin("apiKey").catch(showError));
els.openPath.addEventListener("click", () => loadDirectory(els.cwdInput.value).catch(showError));
els.cwdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadDirectory(els.cwdInput.value).catch(showError);
});
els.attachDirectory.addEventListener("click", () => attachDirectory(els.cwdInput.value.trim() || state.currentPath).catch(showError));
els.newThread.addEventListener("click", () => startThread(els.cwdInput.value.trim() || state.currentPath).catch(showError));
els.sendPrompt.addEventListener("click", () => sendPrompt().catch(showError));
els.interruptTurn.addEventListener("click", () => interruptTurn().catch(showError));
els.clearEvents.addEventListener("click", () => {
  els.activityStream.innerHTML = "";
  state.eventCount = 0;
  updateEventCountLabel();
});
els.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    sendPrompt().catch(showError);
  }
});

window.addEventListener("resize", () => syncShell());

syncShell();
connectEvents();
loadDirectory(state.currentPath).catch(showError);
refreshStatus().catch(showError);
