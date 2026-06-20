import http from "node:http";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const defaultCodexBin = "/Applications/Codex.app/Contents/Resources/codex";
const codexBin = process.env.CODEX_BIN || (fssync.existsSync(defaultCodexBin) ? defaultCodexBin : "codex");
const bindHost = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8787);

const state = {
  serverStartedAt: Date.now(),
  codexReady: false,
  codexInfo: null,
  nextRpcId: 1,
  pending: new Map(),
  clients: new Set(),
  threads: new Map(),
  activeThreadId: null,
  serverRequests: new Map(),
  authStatus: null,
  appServer: null
};

const defaultProjects = [
  "/Users/yangs/Documents/New project",
  "/Users/yangs/Documents",
  "/Users/yangs/Desktop",
  os.homedir()
].filter(unique).filter((p) => fssync.existsSync(p));

function unique(value, index, array) {
  return array.indexOf(value) === index;
}

function getLanHosts() {
  const hosts = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const address = entry.address;
      const isLan =
        address.startsWith("10.") ||
        address.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);
      if (isLan) hosts.push(address);
    }
  }
  return hosts.filter(unique);
}

function getWebUrls() {
  const localUrls = [`http://127.0.0.1:${port}`];
  const lanUrls = getLanHosts().map((host) => `http://${host}:${port}`);
  const listenUrl = bindHost === "0.0.0.0" ? `http://0.0.0.0:${port}` : `http://${bindHost}:${port}`;
  return { listenUrl, localUrls, lanUrls };
}

function sendRpc(method, params) {
  if (!state.appServer?.stdin?.writable) {
    return Promise.reject(new Error("Codex app-server is not running"));
  }

  const id = state.nextRpcId++;
  const payload = params === undefined ? { method, id } : { method, id, params };

  const promise = new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject, method, startedAt: Date.now() });
    setTimeout(() => {
      const item = state.pending.get(id);
      if (!item) return;
      state.pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 120000);
  });

  state.appServer.stdin.write(`${JSON.stringify(payload)}\n`);
  return promise;
}

function sendNotification(method, params) {
  if (!state.appServer?.stdin?.writable) return;
  const payload = params === undefined ? { method } : { method, params };
  state.appServer.stdin.write(`${JSON.stringify(payload)}\n`);
}

async function startCodexAppServer() {
  if (path.isAbsolute(codexBin) && !fssync.existsSync(codexBin)) {
    throw new Error(`Codex binary not found: ${codexBin}`);
  }

  const child = spawn(codexBin, ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" }
  });

  state.appServer = child;

  child.on("error", (error) => {
    state.codexReady = false;
    state.appServer = null;
    for (const { reject } of state.pending.values()) reject(error);
    state.pending.clear();
    broadcast({ type: "bridge-status", status: "failed", error: error.message });
  });

  child.stderr.on("data", (chunk) => {
    broadcast({
      type: "codex-stderr",
      text: chunk.toString()
    });
  });

  child.on("exit", (code, signal) => {
    state.codexReady = false;
    state.appServer = null;
    const error = new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`);
    for (const { reject } of state.pending.values()) reject(error);
    state.pending.clear();
    broadcast({ type: "bridge-status", status: "codex-exited", code, signal });
  });

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      broadcast({ type: "codex-raw", text: line });
      return;
    }
    handleCodexMessage(message);
  });

  const init = await sendRpc("initialize", {
    clientInfo: {
      name: "local_codex_web",
      title: "Local Codex Web",
      version: "0.1.0"
    },
    capabilities: {
      experimentalApi: true
    }
  });
  sendNotification("initialized");
  state.codexReady = true;
  state.codexInfo = init;
  broadcast({ type: "bridge-status", status: "ready", codexInfo: init });
}

function handleCodexMessage(message) {
  if (Object.prototype.hasOwnProperty.call(message, "id")) {
    const pending = state.pending.get(message.id);
    if (pending) {
      state.pending.delete(message.id);
      if (message.error) {
        const err = new Error(message.error.message || `${pending.method} failed`);
        err.payload = message.error;
        pending.reject(err);
      } else {
        pending.resolve(message.result);
      }
    }
  }

  if (message.method) {
    if (message.id && isServerRequest(message.method)) {
      state.serverRequests.set(String(message.id), message);
      broadcast({ type: "server-request", request: message });
    }
    handleNotification(message);
  }

  broadcast({ type: "codex-message", message });
}

function isServerRequest(method) {
  return [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
    "applyPatchApproval",
    "execCommandApproval"
  ].includes(method);
}

function getThread(threadId) {
  if (!state.threads.has(threadId)) {
    state.threads.set(threadId, {
      id: threadId,
      title: "Untitled",
      cwd: null,
      model: null,
      provider: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activeTurnId: null,
      busy: false,
      messages: [],
      events: [],
      items: new Map()
    });
  }
  return state.threads.get(threadId);
}

function pushEvent(thread, event) {
  const enriched = { ts: Date.now(), ...event };
  thread.events.push(enriched);
  if (thread.events.length > 600) thread.events.splice(0, thread.events.length - 600);
  thread.updatedAt = Date.now();
  broadcast({ type: "thread-event", threadId: thread.id, event: enriched });
}

function normalizeThreadTimestamp(value, fallback = Date.now()) {
  if (!value) return fallback;
  return value < 100000000000 ? value * 1000 : value;
}

function textFromUserContent(content) {
  return (content || [])
    .map((part) => {
      if (part?.type === "text" || part?.type === "input_text") return part.text || "";
      return "";
    })
    .join("")
    .trim();
}

function hydrateThreadFromCodex(rawThread, response = {}) {
  const thread = getThread(rawThread.id);
  thread.title = rawThread.preview || rawThread.name || thread.title || "New thread";
  thread.cwd = response.cwd || rawThread.cwd || thread.cwd;
  thread.model = response.model || rawThread.model || thread.model;
  thread.provider = response.modelProvider || rawThread.modelProvider || thread.provider;
  thread.createdAt = normalizeThreadTimestamp(rawThread.createdAt, thread.createdAt);
  thread.updatedAt = normalizeThreadTimestamp(rawThread.updatedAt, Date.now());
  thread.busy = rawThread.status?.type === "running" || rawThread.status?.type === "active";
  thread.messages = [];
  thread.events = [];
  thread.items = new Map();

  for (const turn of rawThread.turns || []) {
    const ts = normalizeThreadTimestamp(turn.startedAt, thread.updatedAt);
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        const text = textFromUserContent(item.content);
        if (text) {
          thread.messages.push({
            id: item.id || `user-${turn.id}-${thread.messages.length}`,
            role: "user",
            text,
            phase: null,
            ts
          });
        }
      } else if (item.type === "agentMessage" && item.text) {
        thread.messages.push({
          id: item.id || `assistant-${turn.id}-${thread.messages.length}`,
          role: "assistant",
          text: item.text,
          phase: item.phase || null,
          ts
        });
      } else if (item.id) {
        thread.items.set(item.id, { ...item, updatedAt: ts });
      }
    }
  }

  return thread;
}

function appendMessage(thread, role, text, extra = {}) {
  const msg = {
    id: extra.id || `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text,
    phase: extra.phase || null,
    ts: Date.now(),
    ...extra
  };
  thread.messages.push(msg);
  thread.updatedAt = Date.now();
  broadcast({ type: "message", threadId: thread.id, message: msg });
  return msg;
}

function upsertItem(thread, item, status) {
  if (!item?.id) return;
  const existing = thread.items.get(item.id) || {};
  const next = { ...existing, ...item, statusOverride: status || existing.statusOverride, updatedAt: Date.now() };
  thread.items.set(item.id, next);
  broadcast({ type: "item", threadId: thread.id, item: next });
}

function handleNotification({ method, params }) {
  const threadId = params?.threadId;
  const thread = threadId ? getThread(threadId) : null;

  switch (method) {
    case "thread/started": {
      const t = getThread(params.thread.id);
      t.title = params.thread.preview || params.thread.name || "New thread";
      t.cwd = params.thread.cwd || t.cwd;
      t.updatedAt = Date.now();
      broadcastThreads();
      break;
    }
    case "turn/started": {
      if (!thread) break;
      thread.busy = true;
      thread.activeTurnId = params.turn.id;
      pushEvent(thread, { kind: "turn-started", label: "Turn started", turnId: params.turn.id });
      broadcastThreads();
      break;
    }
    case "account/login/completed": {
      broadcast({ type: "auth-event", event: params });
      refreshAuthStatus().catch(() => {});
      break;
    }
    case "turn/completed": {
      if (!thread) break;
      thread.busy = false;
      thread.activeTurnId = null;
      pushEvent(thread, {
        kind: "turn-completed",
        label: `Turn ${params.turn.status}`,
        turnId: params.turn.id,
        status: params.turn.status,
        error: params.turn.error || null
      });
      broadcastThreads();
      break;
    }
    case "item/started": {
      if (!thread) break;
      upsertItem(thread, params.item, "started");
      pushItemEvent(thread, params.item, "started");
      break;
    }
    case "item/completed": {
      if (!thread) break;
      upsertItem(thread, params.item, "completed");
      pushItemEvent(thread, params.item, "completed");
      if (params.item?.type === "agentMessage" && params.item.text) {
        const existing = thread.messages.find((m) => m.itemId === params.item.id);
        if (!existing) {
          appendMessage(thread, "assistant", params.item.text, {
            id: `assistant-${params.item.id}`,
            itemId: params.item.id,
            phase: params.item.phase
          });
        }
      }
      break;
    }
    case "item/agentMessage/delta": {
      if (!thread) break;
      let msg = thread.messages.find((m) => m.itemId === params.itemId);
      if (!msg) {
        msg = appendMessage(thread, "assistant", "", {
          id: `assistant-${params.itemId}`,
          itemId: params.itemId
        });
      }
      msg.text += params.delta || "";
      msg.updatedAt = Date.now();
      thread.updatedAt = Date.now();
      broadcast({ type: "message-delta", threadId: thread.id, itemId: params.itemId, delta: params.delta || "", message: msg });
      break;
    }
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta": {
      if (!thread) break;
      pushEvent(thread, {
        kind: "reasoning",
        label: "Reasoning",
        itemId: params.itemId,
        delta: params.delta || ""
      });
      break;
    }
    case "item/plan/delta": {
      if (!thread) break;
      pushEvent(thread, {
        kind: "plan",
        label: "Plan",
        itemId: params.itemId,
        delta: params.delta || ""
      });
      break;
    }
    case "item/commandExecution/outputDelta": {
      if (!thread) break;
      pushEvent(thread, {
        kind: "command-output",
        label: "Command output",
        itemId: params.itemId,
        delta: params.delta || ""
      });
      break;
    }
    case "item/fileChange/outputDelta": {
      if (!thread) break;
      pushEvent(thread, {
        kind: "file-output",
        label: "File change",
        itemId: params.itemId,
        delta: params.delta || ""
      });
      break;
    }
    case "item/fileChange/patchUpdated": {
      if (!thread) break;
      pushEvent(thread, {
        kind: "patch",
        label: "Patch updated",
        itemId: params.itemId,
        changes: params.changes || []
      });
      break;
    }
    case "turn/diff/updated":
    case "turn/plan/updated":
    case "thread/tokenUsage/updated":
    case "model/rerouted":
    case "model/verification":
    case "warning":
    case "guardianWarning":
    case "configWarning": {
      if (thread) {
        pushEvent(thread, {
          kind: "status",
          label: method,
          params
        });
      } else {
        broadcast({ type: "global-event", event: { ts: Date.now(), method, params } });
      }
      break;
    }
    default:
      break;
  }
}

async function refreshAuthStatus() {
  try {
    const auth = await sendRpc("getAuthStatus", { includeToken: false, refreshToken: false });
    let account = null;
    try {
      const accountResponse = await sendRpc("account/read", { refreshToken: false });
      account = accountResponse.account || null;
    } catch {
      account = null;
    }
    state.authStatus = {
      authMethod: auth.authMethod || null,
      requiresOpenaiAuth: auth.requiresOpenaiAuth ?? null,
      account
    };
    broadcast({ type: "auth-status", auth: state.authStatus });
    return state.authStatus;
  } catch (error) {
    state.authStatus = {
      authMethod: null,
      requiresOpenaiAuth: null,
      account: null,
      error: error.message
    };
    broadcast({ type: "auth-status", auth: state.authStatus });
    return state.authStatus;
  }
}

function pushItemEvent(thread, item, status) {
  if (!item) return;
  if (item.type === "commandExecution") {
    pushEvent(thread, {
      kind: "command",
      label: status === "started" ? "Command started" : "Command completed",
      itemId: item.id,
      command: item.command,
      cwd: item.cwd,
      status: item.status,
      output: item.aggregatedOutput,
      exitCode: item.exitCode,
      durationMs: item.durationMs
    });
    return;
  }
  if (item.type === "fileChange") {
    pushEvent(thread, {
      kind: "file-change",
      label: status === "started" ? "File change started" : "File change completed",
      itemId: item.id,
      status: item.status,
      changes: item.changes || []
    });
    return;
  }
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall" || item.type === "webSearch") {
    pushEvent(thread, {
      kind: "tool",
      label: `${item.type} ${status}`,
      itemId: item.id,
      item
    });
    return;
  }
  if (item.type === "plan" || item.type === "reasoning") {
    pushEvent(thread, {
      kind: item.type,
      label: `${item.type} ${status}`,
      itemId: item.id,
      item
    });
  }
}

function serializeThread(thread) {
  return {
    id: thread.id,
    title: thread.title,
    cwd: thread.cwd,
    model: thread.model,
    provider: thread.provider,
    busy: thread.busy,
    activeTurnId: thread.activeTurnId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messages: thread.messages,
    events: thread.events,
    items: Array.from(thread.items.values())
  };
}

function broadcastThreads() {
  broadcast({
    type: "threads",
    activeThreadId: state.activeThreadId,
    threads: Array.from(state.threads.values()).map(serializeThread)
  });
}

function broadcast(payload) {
  const body = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of state.clients) {
    client.write(body);
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(value));
}

function sendError(res, error, status = 500) {
  sendJson(res, { error: error.message || String(error), details: error.payload || null }, status);
}

async function listDirectory(targetPath) {
  const resolved = path.resolve(targetPath || os.homedir());
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const visible = entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: path.join(resolved, entry.name),
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymlink: entry.isSymbolicLink()
    }))
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  return {
    path: resolved,
    parent: path.dirname(resolved),
    entries: visible
  };
}

async function listHistoryThreads(cwd, limit = 20) {
  const response = await sendRpc("thread/list", {
    cwd,
    limit,
    sortKey: "updated_at",
    sortDirection: "desc",
    archived: false,
    sourceKinds: []
  });
  return response.data || [];
}

async function resumeThread(rawThread, options = {}) {
  const response = await sendRpc("thread/resume", {
    threadId: rawThread.id,
    cwd: options.cwd || rawThread.cwd || undefined,
    model: options.model || undefined,
    approvalPolicy: options.approvalPolicy || undefined,
    sandbox: options.sandbox || undefined
  });
  const thread = hydrateThreadFromCodex(response.thread || rawThread, response);
  state.activeThreadId = thread.id;
  broadcastThreads();
  broadcast({ type: "thread-hydrated", threadId: thread.id, thread: serializeThread(thread) });
  return { thread, raw: response, mode: "resumed" };
}

async function readThread(threadId) {
  const response = await sendRpc("thread/read", { threadId, includeTurns: true });
  return response.thread;
}

async function startNewThread({ cwd, model, approvalPolicy, sandbox }) {
  const response = await sendRpc("thread/start", {
    cwd,
    runtimeWorkspaceRoots: [cwd],
    model,
    approvalPolicy,
    sandbox,
    threadSource: "local-codex-web"
  });
  const thread = getThread(response.thread.id);
  thread.title = response.thread.preview || response.thread.name || path.basename(cwd) || "New thread";
  thread.cwd = response.cwd || cwd;
  thread.model = response.model;
  thread.provider = response.modelProvider;
  thread.createdAt = Date.now();
  thread.updatedAt = Date.now();
  state.activeThreadId = thread.id;
  pushEvent(thread, {
    kind: "thread",
    label: "Thread created",
    cwd: thread.cwd,
    model: thread.model,
    provider: thread.provider
  });
  broadcastThreads();
  return { thread, raw: response, mode: "started" };
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/status") {
    sendJson(res, {
      ready: state.codexReady,
      codexInfo: state.codexInfo,
      auth: state.authStatus,
      web: getWebUrls(),
      activeThreadId: state.activeThreadId,
      defaultProjects,
      threads: Array.from(state.threads.values()).map(serializeThread)
    });
    return;
  }

  if (pathname === "/api/auth/status") {
    sendJson(res, await refreshAuthStatus());
    return;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readJson(req);
    const mode = body.mode || "chatgptDeviceCode";
    let response;
    if (mode === "apiKey") {
      if (!body.apiKey) throw new Error("API key is required.");
      response = await sendRpc("account/login/start", { type: "apiKey", apiKey: body.apiKey });
    } else if (mode === "chatgpt") {
      response = await sendRpc("account/login/start", { type: "chatgpt", codexStreamlinedLogin: true });
    } else {
      response = await sendRpc("account/login/start", { type: "chatgptDeviceCode" });
    }
    sendJson(res, response);
    return;
  }

  if (pathname === "/api/server-request/respond" && req.method === "POST") {
    const body = await readJson(req);
    const requestId = String(body.requestId || "");
    const request = state.serverRequests.get(requestId);
    if (!request) throw new Error("Request not found or already resolved.");
    const result = buildServerRequestResult(request, body);
    state.appServer.stdin.write(`${JSON.stringify({ id: request.id, result })}\n`);
    state.serverRequests.delete(requestId);
    broadcast({ type: "server-request-resolved", requestId });
    sendJson(res, { ok: true });
    return;
  }

  if (pathname === "/api/fs/list") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const targetPath = url.searchParams.get("path") || os.homedir();
    sendJson(res, await listDirectory(targetPath));
    return;
  }

  if (pathname === "/api/threads/history") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cwd = path.resolve(url.searchParams.get("cwd") || process.cwd());
    const limit = Number(url.searchParams.get("limit") || 20);
    const data = await listHistoryThreads(cwd, limit);
    sendJson(res, { cwd, threads: data });
    return;
  }

  if (pathname === "/api/thread/attach" && req.method === "POST") {
    const body = await readJson(req);
    const cwd = path.resolve(body.cwd || process.cwd());
    const model = body.model || undefined;
    const approvalPolicy = body.approvalPolicy || undefined;
    const sandbox = body.sandbox || undefined;

    const loaded = Array.from(state.threads.values())
      .filter((thread) => thread.cwd && path.resolve(thread.cwd) === cwd)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (loaded) {
      state.activeThreadId = loaded.id;
      broadcastThreads();
      sendJson(res, { thread: serializeThread(loaded), mode: "loaded" });
      return;
    }

    const history = await listHistoryThreads(cwd, 1);
    if (history[0]) {
      try {
        const result = await resumeThread(history[0], { cwd, model, approvalPolicy, sandbox });
        sendJson(res, { thread: serializeThread(result.thread), mode: result.mode, raw: result.raw });
        return;
      } catch (error) {
        broadcast({ type: "global-event", event: { ts: Date.now(), method: "thread/resume", error: error.message } });
      }
    }

    const result = await startNewThread({ cwd, model, approvalPolicy, sandbox });
    sendJson(res, { thread: serializeThread(result.thread), mode: result.mode, raw: result.raw });
    return;
  }

  if (pathname === "/api/thread/resume" && req.method === "POST") {
    const body = await readJson(req);
    const threadId = String(body.threadId || "");
    if (!threadId) throw new Error("threadId is required.");
    const cwd = body.cwd ? path.resolve(body.cwd) : undefined;
    const rawThread = await readThread(threadId);
    const result = await resumeThread(rawThread, {
      cwd: cwd || rawThread.cwd,
      model: body.model || undefined,
      approvalPolicy: body.approvalPolicy || undefined,
      sandbox: body.sandbox || undefined
    });
    sendJson(res, { thread: serializeThread(result.thread), mode: result.mode, raw: result.raw });
    return;
  }

  if (pathname === "/api/thread/start" && req.method === "POST") {
    const body = await readJson(req);
    const cwd = path.resolve(body.cwd || process.cwd());
    const model = body.model || undefined;
    const approvalPolicy = body.approvalPolicy || undefined;
    const sandbox = body.sandbox || undefined;
    const result = await startNewThread({ cwd, model, approvalPolicy, sandbox });
    sendJson(res, { thread: serializeThread(result.thread), raw: result.raw, mode: result.mode });
    return;
  }

  if (pathname === "/api/turn/start" && req.method === "POST") {
    const body = await readJson(req);
    const threadId = body.threadId || state.activeThreadId;
    if (!threadId) throw new Error("No active thread. Create a thread first.");
    const thread = getThread(threadId);
    const text = String(body.text || "").trim();
    if (!text) throw new Error("Message is empty.");
    const cwd = body.cwd ? path.resolve(body.cwd) : thread.cwd;

    appendMessage(thread, "user", text);
    const response = await sendRpc("turn/start", {
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
      cwd,
      runtimeWorkspaceRoots: cwd ? [cwd] : undefined,
      approvalPolicy: body.approvalPolicy || undefined,
      model: body.model || undefined,
      effort: body.effort || undefined
    });
    thread.busy = true;
    thread.activeTurnId = response.turn?.id || thread.activeTurnId;
    state.activeThreadId = threadId;
    broadcastThreads();
    sendJson(res, { turn: response.turn, thread: serializeThread(thread) });
    return;
  }

  if (pathname === "/api/turn/interrupt" && req.method === "POST") {
    const body = await readJson(req);
    const threadId = body.threadId || state.activeThreadId;
    if (!threadId) throw new Error("No active thread.");
    const thread = getThread(threadId);
    const turnId = body.turnId || thread.activeTurnId;
    if (!turnId) throw new Error("No active turn.");
    const response = await sendRpc("turn/interrupt", { threadId, turnId });
    sendJson(res, response);
    return;
  }

  if (pathname === "/api/threads") {
    sendJson(res, {
      activeThreadId: state.activeThreadId,
      threads: Array.from(state.threads.values()).map(serializeThread)
    });
    return;
  }

  sendJson(res, { error: "Not found" }, 404);
}

function buildServerRequestResult(request, body) {
  const decision = body.decision || "decline";
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return { decision };
    case "item/fileChange/requestApproval":
      return { decision };
    case "item/permissions/requestApproval":
      if (decision === "accept" || decision === "acceptForSession") {
        return {
          permissions: request.params.permissions || {},
          scope: decision === "acceptForSession" ? "session" : "turn"
        };
      }
      return {
        permissions: {},
        scope: "turn"
      };
    case "item/tool/requestUserInput":
      return { answers: body.answers || {} };
    case "applyPatchApproval":
    case "execCommandApproval":
      return { decision: decision === "accept" ? "approved" : decision === "acceptForSession" ? "approved_for_session" : "denied" };
    default:
      return body.result || {};
  }
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(publicDir, relative);
  if (!target.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(target);
    const ext = path.extname(target);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    res.write(`data: ${JSON.stringify({ type: "hello", ready: state.codexReady, ts: Date.now() })}\n\n`);
    state.clients.add(res);
    req.on("close", () => state.clients.delete(res));
    return;
  }

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(port, bindHost, async () => {
  const urls = getWebUrls();
  console.log(`Codex Web listening at ${urls.listenUrl}`);
  console.log(`Local URL: ${urls.localUrls.join(", ")}`);
  if (urls.lanUrls.length) {
    console.log(`LAN URL: ${urls.lanUrls.join(", ")}`);
  } else {
    console.log("LAN URL: no private IPv4 address detected");
  }
  try {
    await startCodexAppServer();
    await refreshAuthStatus();
    console.log("Codex app-server bridge is ready");
  } catch (error) {
    console.error(error);
    broadcast({ type: "bridge-status", status: "failed", error: error.message });
  }
});

process.on("SIGINT", () => {
  state.appServer?.kill("SIGTERM");
  process.exit(0);
});

process.on("SIGTERM", () => {
  state.appServer?.kill("SIGTERM");
  process.exit(0);
});
