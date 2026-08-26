import {
  Context,
  createDefaultRegistry,
  createDefaultSystemContext,
  exportRixCelDocument,
  formatValue,
  parseAndEvaluate,
  parseRixCelDocument,
  renderOutputHtml
} from "./chunk-a86m3sxx.js";

// src/evaluation-runtime.js
var RIXCEL_WITHHELD_CAPABILITIES = Object.freeze([
  "ImportJS",
  "JSCall",
  "CapabilityRegister",
  "TypeRegister",
  "TraitRegister",
  "TypeInstall",
  "TypeImport",
  "TypeExport",
  "Plugin",
  "Host",
  "Core",
  "Stream",
  "Retry"
]);
function createRixCelEvaluationState() {
  return {
    context: new Context,
    registry: createDefaultRegistry(),
    systemContext: createDefaultSystemContext().withhold(...RIXCEL_WITHHELD_CAPABILITIES)
  };
}
function setText(context, name, value) {
  context.setFresh(name, { type: "string", value: String(value ?? "") });
}
function evaluate(state, source) {
  return parseAndEvaluate(source, { ...state, file: "<rixcel-worker>" });
}
function sameHistoryPrefix(current, candidate) {
  if (!current || candidate.cursor !== candidate.events.length)
    return false;
  if (candidate.events.length !== current.cursor + 1)
    return false;
  return JSON.stringify(candidate.events.slice(0, current.cursor)) === JSON.stringify(current.events.slice(0, current.cursor));
}
function windowFor(shape, requested = {}) {
  const rowTotal = shape[0];
  const columnTotal = shape[1] ?? 1;
  const positive = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? value : fallback;
  const rowStart = Math.min(positive(requested.rowStart, 1), rowTotal);
  const columnStart = Math.min(positive(requested.columnStart, 1), columnTotal);
  return {
    rowStart,
    rowCount: Math.min(positive(requested.rowCount, 40), rowTotal - rowStart + 1),
    columnStart,
    columnCount: Math.min(positive(requested.columnCount, 12), columnTotal - columnStart + 1)
  };
}

class RixCelEvaluationSession {
  constructor() {
    this.state = createRixCelEvaluationState();
    this.document = null;
    this.model = null;
  }
  open(value) {
    const document = parseRixCelDocument(value);
    const nextState = createRixCelEvaluationState();
    setText(nextState.context, "hosttext", JSON.stringify(document));
    const model = evaluate(nextState, ".RiXCelImport(hosttext)");
    nextState.context.setFresh("document", model);
    this.state = nextState;
    this.document = document;
    this.model = model;
    return this;
  }
  applyEvent(event) {
    if (event.type === "slot:set") {
      this.model.setFormulaSource(event.index, event.source, event.assignmentMode);
    } else if (event.type === "slot:batch") {
      this.model.setFormulaSources(event.edits);
    } else if (event.type === "view:axis-label") {
      this.model.setAxisLabel(event.axis, event.coordinate, event.label);
    } else {
      throw new Error(`Unsupported RiXCel session event: ${event.type}`);
    }
  }
  commit(value) {
    const candidate = parseRixCelDocument(value);
    if (!sameHistoryPrefix(this.document, candidate))
      return this.open(candidate);
    try {
      this.applyEvent(candidate.events.at(-1));
      this.document = candidate;
    } catch (error) {
      this.open(this.document);
      throw error;
    }
    return this;
  }
  project(requestedWindow = {}) {
    if (!this.model || !this.document)
      throw new Error("RiXCel worker has no open document");
    const window = windowFor(this.document.shape, requestedWindow);
    const view = evaluate(this.state, `.Sheet(document, {=
            title="RiXCel document",
            rowStart=${window.rowStart}, rowCount=${window.rowCount},
            columnStart=${window.columnStart}, columnCount=${window.columnCount}
        })`);
    const html = renderOutputHtml(view, (value) => formatValue(value, { context: this.state.context, evaluate: null }));
    return {
      document: this.document,
      html,
      epoch: this.model.epoch,
      shape: [...this.document.shape],
      window,
      materializedSlotCount: this.model.materializedSlotCount
    };
  }
  import(request) {
    const kind = request.kind === "tsv" ? "tsv" : request.kind === "csv" ? "csv" : "rixcel";
    if (kind === "rixcel")
      return this.open(parseRixCelDocument(request.text));
    const importState = createRixCelEvaluationState();
    setText(importState.context, "hosttext", request.text);
    setText(importState.context, "hostid", request.id || "imported");
    const fn = kind === "tsv" ? ".RiXCelImportTsv" : ".RiXCelImportCsv";
    const model = evaluate(importState, `${fn}(hosttext, {= header=${request.header ? 1 : 0}, id=hostid })`);
    return this.open(exportRixCelDocument(model));
  }
  exportDelimited(kind) {
    if (!this.model)
      throw new Error("RiXCel worker has no open document");
    const fn = kind === "tsv" ? ".RiXCelExportTsv" : ".RiXCelExportCsv";
    return evaluate(this.state, `${fn}(document)`).value;
  }
  handle(request) {
    if (request?.type === "open") {
      this.open(request.document);
      return this.project(request.window);
    }
    if (request?.type === "commit") {
      this.commit(request.document);
      return this.project(request.window);
    }
    if (request?.type === "project")
      return this.project(request.window);
    if (request?.type === "import") {
      this.import(request);
      return this.project(request.window);
    }
    if (request?.type === "export")
      return { text: this.exportDelimited(request.kind) };
    if (request?.type === "validate") {
      const isolated = new RixCelEvaluationSession;
      isolated.open(request.document);
      return { document: isolated.document };
    }
    throw new Error(`Unknown RiXCel worker request: ${request?.type || "missing type"}`);
  }
}

// src/evaluation-worker.js
var session = new RixCelEvaluationSession;
self.addEventListener("message", (event) => {
  const { id, request } = event.data || {};
  try {
    self.postMessage({ id, type: "result", value: session.handle(request) });
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

//# debugId=15479748D9F5CD9464756E2164756E21
//# sourceMappingURL=evaluation-worker.js.map
