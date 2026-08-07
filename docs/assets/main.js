import {
  appendRixCelEvent,
  clearRixCelDraft,
  createRixCelDocument,
  enhanceSheetViews,
  parseRixCelDocument,
  setRixCelCursor,
  setRixCelDraft,
  stringifyRixCelDocument
} from "./chunk-tf6f7n50.js";

// src/evaluation-worker-client.js
var DEFAULT_TIMEOUT_MS = 2000;

class RixCelWorkerClient {
  constructor(options = {}) {
    this.WorkerConstructor = options.WorkerConstructor ?? globalThis.Worker;
    this.url = options.url ?? new URL("./evaluation-worker.js", import.meta.url);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.nextId = 1;
    this.pending = new Map;
    this.worker = null;
    this.disposed = false;
  }
  start() {
    if (this.disposed)
      throw new Error("RiXCel evaluation worker has been disposed");
    if (this.worker)
      return this.worker;
    if (typeof this.WorkerConstructor !== "function") {
      throw new Error("This browser does not support RiXCel evaluation workers");
    }
    const worker = new this.WorkerConstructor(this.url, { type: "module", name: "rixcel-evaluation" });
    worker.addEventListener("message", (event) => this.receive(event.data));
    worker.addEventListener("error", (event) => {
      this.failAll(new Error(event.message || "RiXCel evaluation worker failed"));
      this.restart();
    });
    this.worker = worker;
    return worker;
  }
  receive(message) {
    const entry = this.pending.get(message?.id);
    if (!entry)
      return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.type === "result")
      entry.resolve(message.value);
    else
      entry.reject(new Error(message.message || "RiXCel evaluation failed"));
  }
  failAll(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
  restart() {
    this.worker?.terminate();
    this.worker = null;
  }
  request(request, options = {}) {
    const worker = this.start();
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.restart();
        reject(new Error(`Evaluation exceeded ${timeoutMs} ms; the worker was stopped and restarted`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, request });
    });
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    this.failAll(new Error("RiXCel evaluation worker was disposed"));
    this.restart();
  }
}

// src/main.js
var STORAGE_KEY = "rixcel.autosave.v2";
var LEGACY_STORAGE_KEY = "rixcel.autosave.v1";
var evaluationWorker = new RixCelWorkerClient({ timeoutMs: 2000 });
var host = document.querySelector("#sheet-host");
var fileInput = document.querySelector("#file-input");
var status = document.querySelector("#status");
var documentName = document.querySelector("#document-name");
var headerToggle = document.querySelector('[data-field="header"]');
var undoButton = document.querySelector('[data-action="undo"]');
var redoButton = document.querySelector('[data-action="redo"]');
var previousRowsButton = document.querySelector('[data-action="previous-rows"]');
var nextRowsButton = document.querySelector('[data-action="next-rows"]');
var previousColumnsButton = document.querySelector('[data-action="previous-columns"]');
var nextColumnsButton = document.querySelector('[data-action="next-columns"]');
var windowStatus = document.querySelector("#window-status");
var switchDialog = document.querySelector("#switch-document-dialog");
var documentLog = null;
var projection = null;
var name = "Untitled.rixcel";
var dirty = false;
var sessionFloorCursor = 0;
var viewport = { rowStart: 1, rowCount: 40, columnStart: 1, columnCount: 12 };
function setStatus(message) {
  status.textContent = message;
}
function updateHistoryButtons() {
  undoButton.disabled = !documentLog || documentLog.cursor <= sessionFloorCursor;
  redoButton.disabled = !documentLog || documentLog.cursor >= documentLog.events.length;
}
function updateWindowControls() {
  if (!projection)
    return;
  const { rowStart, rowCount, columnStart, columnCount } = projection.window;
  const [rowTotal, columnTotal = 1] = projection.shape;
  previousRowsButton.disabled = rowStart <= 1;
  nextRowsButton.disabled = rowStart + rowCount > rowTotal;
  previousColumnsButton.disabled = columnStart <= 1;
  nextColumnsButton.disabled = columnStart + columnCount > columnTotal;
  windowStatus.textContent = `Rows ${rowStart}–${rowStart + rowCount - 1} of ${rowTotal} · Columns ${columnStart}–${columnStart + columnCount - 1} of ${columnTotal}`;
}
function persistRecovery() {
  if (!documentLog)
    return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      name,
      document: stringifyRixCelDocument(documentLog),
      dirty
    }));
  } catch (error) {
    setStatus(`Local recovery unavailable: ${error.message || String(error)}`);
  }
}
function decorateDrafts() {
  for (const draft of documentLog?.drafts || []) {
    const address = `grid[${draft.index.join(",")}]`;
    const cell = [...host.querySelectorAll("td[data-rix-address]")].find((candidate) => candidate.dataset.rixAddress === address);
    if (!cell)
      continue;
    cell.dataset.rixState = "error";
    cell.dataset.rixDiagnosticKind = draft.kind;
    cell.dataset.rixDiagnosticSource = draft.source;
    cell.dataset.rixDiagnostics = JSON.stringify([draft.message]);
    cell.setAttribute("aria-invalid", "true");
    cell.title = `${cell.title} · ${draft.kind} draft: ${draft.message}`;
  }
}
function errorKind(message) {
  return /compile|parse|token|unexpected/iu.test(message) ? "parse" : /cycle/iu.test(message) ? "cycle" : "runtime";
}
function renderProjection(nextProjection) {
  projection = nextProjection;
  Object.assign(viewport, nextProjection.window);
  host.innerHTML = nextProjection.html;
  enhanceSheetViews(host, {
    onSelection(detail) {
      setStatus(detail.coordinateLabel || detail.address);
    },
    async onEdit(detail) {
      const event = {
        type: "slot:set",
        index: [...detail.index],
        source: detail.source,
        assignmentMode: detail.assignmentMode || ":=",
        view: {}
      };
      try {
        const result = await commitEvent(event);
        setTimeout(() => renderProjection(result), 0);
        return { type: "result", text: detail.source, revision: result.epoch };
      } catch (error) {
        documentLog = setRixCelDraft(documentLog, {
          index: event.index,
          source: event.source,
          assignmentMode: event.assignmentMode,
          kind: errorKind(error.message),
          message: error.message
        });
        dirty = true;
        persistRecovery();
        decorateDrafts();
        return { type: "error", text: error.message };
      }
    },
    async onBatchEdit(detail) {
      const event = {
        type: "slot:batch",
        edits: detail.edits.map((edit) => ({
          index: [...edit.index],
          source: edit.source,
          assignmentMode: edit.assignmentMode || ":=",
          view: {}
        }))
      };
      try {
        const result = await commitEvent(event);
        setTimeout(() => renderProjection(result), 0);
        return { type: "result", revision: result.epoch };
      } catch (error) {
        setStatus(error.message);
        return { type: "error", text: error.message };
      }
    },
    onHeaderEdit(detail) {
      commitEvent({
        type: "view:axis-label",
        axis: detail.axis,
        coordinate: detail.coordinate,
        label: detail.label || null
      }).then((result) => renderProjection(result)).catch((error) => setStatus(error.message));
      return { type: "result" };
    }
  });
  decorateDrafts();
  updateHistoryButtons();
  updateWindowControls();
}
async function commitEvent(event) {
  let next = documentLog;
  const edits = event.type === "slot:batch" ? event.edits : event.type === "slot:set" ? [event] : [];
  for (const edit of edits)
    next = clearRixCelDraft(next, edit.index);
  const candidate = appendRixCelEvent(next, event);
  const result = await evaluationWorker.request({ type: "commit", document: candidate, window: viewport });
  documentLog = candidate;
  dirty = true;
  persistRecovery();
  setStatus(event.type === "slot:batch" ? `Saved ${event.edits.length} cells locally · event ${documentLog.cursor} · epoch ${result.epoch}` : `Saved locally · event ${documentLog.cursor} · epoch ${result.epoch}`);
  return result;
}
function bindProjection(result, nextName, { resetSession = true } = {}) {
  documentLog = parseRixCelDocument(result.document);
  name = nextName || "Untitled.rixcel";
  documentName.textContent = name;
  if (resetSession)
    sessionFloorCursor = documentLog.cursor;
  renderProjection(result);
  persistRecovery();
}
async function loadDocument(document2, nextName, options = {}) {
  const canonical = parseRixCelDocument(document2);
  const result = await evaluationWorker.request({ type: "open", document: canonical, window: viewport });
  bindProjection(result, nextName, options);
}
async function importText(text, kind, nextName) {
  const header = headerToggle.checked;
  const id = (nextName || "imported").replace(/\.[^.]+$/u, "") || "imported";
  const result = await evaluationWorker.request({ type: "import", kind, text, header, id, window: viewport });
  bindProjection(result, nextName);
}
async function newDocument() {
  Object.assign(viewport, { rowStart: 1, columnStart: 1 });
  const document2 = createRixCelDocument({
    id: "untitled",
    shape: [20, 8],
    view: { axes: ["row", "column"] }
  });
  await loadDocument(document2, "Untitled.rixcel");
  dirty = false;
  persistRecovery();
  setStatus("New sparse document");
}
function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
function saveDocument() {
  download(stringifyRixCelDocument(documentLog), name, "application/json");
  dirty = false;
  persistRecovery();
  setStatus(`Saved document with ${documentLog.events.length} history events`);
}
async function exportDelimited(kind) {
  const result = await evaluationWorker.request({ type: "export", kind });
  const base = name.replace(/\.rixcel$/iu, "") || "sheet";
  download(result.text, `${base}.${kind}`, kind === "csv" ? "text/csv" : "text/tab-separated-values");
  setStatus(`Exported ${kind.toUpperCase()}`);
}
async function openFile(file) {
  const text = await file.text();
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const kind = extension === "rixcel" ? "rixcel" : extension === "tsv" ? "tsv" : "csv";
  Object.assign(viewport, { rowStart: 1, columnStart: 1 });
  await importText(text, kind, kind === "rixcel" ? file.name : `${file.name.replace(/\.[^.]+$/u, "")}.rixcel`);
  dirty = false;
  persistRecovery();
  setStatus(`Opened ${file.name}`);
}
async function restoreCursor(cursor) {
  if (!documentLog || cursor < sessionFloorCursor || cursor > documentLog.events.length)
    return;
  const candidate = setRixCelCursor(documentLog, cursor);
  const result = await evaluationWorker.request({ type: "open", document: candidate, window: viewport });
  bindProjection(result, name, { resetSession: false });
  dirty = true;
  setStatus(cursor < documentLog.events.length ? "Undo restored" : "Redo restored");
}
async function moveWindow(rowDelta, columnDelta) {
  viewport.rowStart = Math.max(1, viewport.rowStart + rowDelta);
  viewport.columnStart = Math.max(1, viewport.columnStart + columnDelta);
  renderProjection(await evaluationWorker.request({ type: "project", window: viewport }));
}
function confirmDocumentSwitch() {
  if (!dirty)
    return Promise.resolve("discard");
  if (!switchDialog?.showModal) {
    return Promise.resolve(confirm("Save the current RiXCel document before continuing?") ? "save" : "cancel");
  }
  switchDialog.showModal();
  return new Promise((resolve) => {
    switchDialog.addEventListener("close", () => resolve(switchDialog.returnValue || "cancel"), { once: true });
  });
}
async function allowDocumentSwitch() {
  const choice = await confirmDocumentSwitch();
  if (choice === "cancel")
    return false;
  if (choice === "save")
    saveDocument();
  return true;
}
document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action)
    return;
  try {
    if (action === "new") {
      if (await allowDocumentSwitch())
        await newDocument();
    } else if (action === "open") {
      if (await allowDocumentSwitch())
        fileInput.click();
    } else if (action === "save")
      saveDocument();
    else if (action === "export-csv")
      await exportDelimited("csv");
    else if (action === "export-tsv")
      await exportDelimited("tsv");
    else if (action === "undo")
      await restoreCursor(documentLog.cursor - 1);
    else if (action === "redo")
      await restoreCursor(documentLog.cursor + 1);
    else if (action === "previous-rows")
      await moveWindow(-viewport.rowCount, 0);
    else if (action === "next-rows")
      await moveWindow(viewport.rowCount, 0);
    else if (action === "previous-columns")
      await moveWindow(0, -viewport.columnCount);
    else if (action === "next-columns")
      await moveWindow(0, viewport.columnCount);
  } catch (error) {
    setStatus(error.message || String(error));
  }
});
fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files || [];
  fileInput.value = "";
  if (!file)
    return;
  try {
    await openFile(file);
  } catch (error) {
    setStatus(error.message || String(error));
  }
});
window.addEventListener("beforeunload", (event) => {
  if (!dirty)
    return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("pagehide", () => evaluationWorker.dispose(), { once: true });
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
  if (saved?.document) {
    await loadDocument(saved.document, saved.name);
    dirty = saved.dirty ?? true;
    persistRecovery();
    setStatus("Recovered local document");
  } else {
    await newDocument();
  }
} catch (error) {
  console.warn("RiXCel local recovery failed", error);
  await newDocument();
  setStatus("Local recovery failed; opened a new document");
}

//# debugId=E5A6E6FEBC28697F64756E2164756E21
//# sourceMappingURL=main.js.map
