import {
  appendRixCelEvent,
  clearRixCelDraft,
  createRixCelDocument,
  createRixCelEvaluationState,
  formatValue,
  mountOutputWidgets,
  parseAndEvaluate,
  parseRixCelDocument,
  renderOutputHtml,
  setRixCelCursor,
  setRixCelDraft,
  stringifyRixCelDocument
} from "./chunk-cqa29xf5.js";

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
var state = createRixCelEvaluationState();
var evaluationWorker = new RixCelWorkerClient({ timeoutMs: 2000 });
var host = document.querySelector("#sheet-host");
var fileInput = document.querySelector("#file-input");
var status = document.querySelector("#status");
var documentName = document.querySelector("#document-name");
var headerToggle = document.querySelector('[data-field="header"]');
var undoButton = document.querySelector('[data-action="undo"]');
var redoButton = document.querySelector('[data-action="redo"]');
var switchDialog = document.querySelector("#switch-document-dialog");
var model = null;
var documentLog = null;
var name = "Untitled.rixcel";
var disposeWidgets = null;
var unsubscribe = null;
var restoring = false;
var dirty = false;
var sessionFloorCursor = 0;
function evaluate(source) {
  return parseAndEvaluate(source, { ...state, file: "<rixcel>" });
}
function setHostText(text) {
  state.context.setFresh("hosttext", { type: "string", value: text });
}
function importDocumentMain(document2) {
  setHostText(stringifyRixCelDocument(document2));
  return evaluate(".RiXCelImport(hosttext)");
}
function exactFormat(value) {
  return formatValue(value, { context: state.context, evaluate: null });
}
function setStatus(message) {
  status.textContent = message;
}
function updateHistoryButtons() {
  undoButton.disabled = !documentLog || documentLog.cursor <= sessionFloorCursor;
  redoButton.disabled = !documentLog || documentLog.cursor >= documentLog.events.length;
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
function slotEventFromFormula(event) {
  const cause = event.cause || {};
  if (cause.type !== "formula:set" || !Array.isArray(cause.index) || typeof cause.source !== "string") {
    return null;
  }
  return {
    type: "slot:set",
    index: [...cause.index],
    source: cause.source,
    assignmentMode: cause.assignmentMode || ":=",
    view: {}
  };
}
function draftFromFormulaError(event) {
  const cause = event.cause || {};
  if (!Array.isArray(cause.index) || typeof cause.source !== "string")
    return null;
  const message = event.error?.message || String(event.error || "Formula edit did not commit");
  return {
    index: [...cause.index],
    source: cause.source,
    assignmentMode: cause.assignmentMode || ":=",
    kind: cause.type === "formula:parse" ? "parse" : /cycle/iu.test(message) ? "cycle" : "runtime",
    message
  };
}
function recordCommittedEvent(event) {
  if (restoring || !documentLog)
    return;
  if (event.type === "formula:commit") {
    const edit = slotEventFromFormula(event);
    if (!edit)
      return;
    documentLog = appendRixCelEvent(clearRixCelDraft(documentLog, edit.index), edit);
    dirty = true;
    setStatus(`Saved locally · event ${documentLog.cursor} · epoch ${model.epoch}`);
  } else if (event.type === "formula:view" && event.cause?.type === "view:axis-label") {
    documentLog = appendRixCelEvent(documentLog, {
      type: "view:axis-label",
      axis: event.cause.axis,
      coordinate: event.cause.coordinate,
      label: event.cause.label
    });
    dirty = true;
    setStatus(`Saved label locally · event ${documentLog.cursor}`);
  } else if (event.type === "formula:error") {
    const draft = draftFromFormulaError(event);
    if (draft)
      documentLog = setRixCelDraft(documentLog, draft);
    dirty = true;
    setStatus(event.error?.message || "Formula error");
  }
  updateHistoryButtons();
  persistRecovery();
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
async function preflightEdit(detail) {
  const edit = {
    type: "slot:set",
    index: [...detail.index],
    source: detail.source,
    assignmentMode: detail.assignmentMode || ":=",
    view: {}
  };
  const candidate = appendRixCelEvent(clearRixCelDraft(documentLog, edit.index), edit);
  try {
    await evaluationWorker.request({ type: "validate", document: candidate });
  } catch (error) {
    documentLog = setRixCelDraft(documentLog, {
      index: edit.index,
      source: edit.source,
      assignmentMode: edit.assignmentMode,
      kind: /compile|parse|token|unexpected/iu.test(error.message) ? "parse" : /cycle/iu.test(error.message) ? "cycle" : "runtime",
      message: error.message
    });
    dirty = true;
    persistRecovery();
    decorateDrafts();
    throw error;
  }
}
function render() {
  disposeWidgets?.();
  const view = evaluate('.Sheet(document, {= title="RiXCel document" })');
  host.innerHTML = renderOutputHtml(view, exactFormat);
  disposeWidgets = mountOutputWidgets(host, view, {
    format: exactFormat,
    beforeSheetEdit: preflightEdit,
    onSelection(detail) {
      setStatus(detail.coordinateLabel || detail.address);
    }
  });
  decorateDrafts();
}
function bindModel(next, nextName, nextDocument, { resetSession = true } = {}) {
  unsubscribe?.();
  model = next;
  documentLog = parseRixCelDocument(nextDocument);
  name = nextName || "Untitled.rixcel";
  documentName.textContent = name;
  state.context.setFresh("document", model);
  if (resetSession)
    sessionFloorCursor = documentLog.cursor;
  unsubscribe = model.subscribe(recordCommittedEvent);
  render();
  updateHistoryButtons();
  persistRecovery();
}
async function loadDocument(document2, nextName, options = {}) {
  const canonical = parseRixCelDocument(document2);
  await evaluationWorker.request({ type: "validate", document: canonical });
  bindModel(importDocumentMain(canonical), nextName, canonical, options);
}
async function importText(text, kind, nextName) {
  const header = headerToggle.checked;
  const id = (nextName || "imported").replace(/\.[^.]+$/u, "") || "imported";
  const result = await evaluationWorker.request({ type: "import", kind, text, header, id });
  bindModel(importDocumentMain(result.document), nextName, result.document);
}
async function newDocument() {
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
function exportDelimited(kind) {
  const fn = kind === "csv" ? ".RiXCelExportCsv" : ".RiXCelExportTsv";
  const result = evaluate(`${fn}(document)`);
  const base = name.replace(/\.rixcel$/iu, "") || "sheet";
  download(result.value, `${base}.${kind}`, kind === "csv" ? "text/csv" : "text/tab-separated-values");
  setStatus(`Exported ${kind.toUpperCase()}`);
}
async function openFile(file) {
  const text = await file.text();
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const kind = extension === "rixcel" ? "rixcel" : extension === "tsv" ? "tsv" : "csv";
  await importText(text, kind, kind === "rixcel" ? file.name : `${file.name.replace(/\.[^.]+$/u, "")}.rixcel`);
  dirty = false;
  persistRecovery();
  setStatus(`Opened ${file.name}`);
}
async function restoreCursor(cursor) {
  if (!documentLog || cursor < sessionFloorCursor || cursor > documentLog.events.length)
    return;
  const candidate = setRixCelCursor(documentLog, cursor);
  restoring = true;
  try {
    await evaluationWorker.request({ type: "validate", document: candidate });
    bindModel(importDocumentMain(candidate), name, candidate, { resetSession: false });
    dirty = true;
    setStatus(cursor < documentLog.events.length ? "Undo restored" : "Redo restored");
  } finally {
    restoring = false;
  }
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
      exportDelimited("csv");
    else if (action === "export-tsv")
      exportDelimited("tsv");
    else if (action === "undo")
      await restoreCursor(documentLog.cursor - 1);
    else if (action === "redo")
      await restoreCursor(documentLog.cursor + 1);
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

//# debugId=BB149F4CF8194D2864756E2164756E21
//# sourceMappingURL=main.js.map
