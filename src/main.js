import {
    Context,
    createDefaultRegistry,
    createDefaultSystemContext,
    formatValue,
    mountOutputWidgets,
    parseAndEvaluate,
    renderOutputHtml,
    stringifyRixCelDocument,
} from "../../../rix/src/index.js";

const STORAGE_KEY = "rixcel.autosave.v1";
const state = {
    context: new Context(),
    registry: createDefaultRegistry(),
    systemContext: createDefaultSystemContext(),
};
const host = document.querySelector("#sheet-host");
const fileInput = document.querySelector("#file-input");
const status = document.querySelector("#status");
const documentName = document.querySelector("#document-name");
const headerToggle = document.querySelector('[data-field="header"]');
const undoButton = document.querySelector('[data-action="undo"]');
const redoButton = document.querySelector('[data-action="redo"]');

let model = null;
let name = "Untitled.rixcel";
let disposeWidgets = null;
let unsubscribe = null;
let restoring = false;
let history = [];
let historyIndex = -1;

function evaluate(source) {
    return parseAndEvaluate(source, { ...state, file: "<rixcel>" });
}

function setHostText(text) {
    state.context.setFresh("hosttext", { type: "string", value: text });
}

function exactFormat(value) {
    return formatValue(value, { context: state.context, evaluate: null });
}

function setStatus(message) {
    status.textContent = message;
}

function updateHistoryButtons() {
    undoButton.disabled = historyIndex <= 0;
    redoButton.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
}

function remember() {
    if (restoring || !model) return;
    const snapshot = stringifyRixCelDocument(model);
    if (history[historyIndex] === snapshot) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    historyIndex = history.length - 1;
    updateHistoryButtons();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, document: snapshot }));
}

function bindModel(next, nextName, { resetHistory = true } = {}) {
    unsubscribe?.();
    model = next;
    name = nextName || "Untitled.rixcel";
    documentName.textContent = name;
    state.context.setFresh("document", model);
    if (resetHistory) {
        history = [];
        historyIndex = -1;
    }
    unsubscribe = model.subscribe((event) => {
        if (event.type === "formula:commit" || event.type === "formula:view") {
            remember();
            setStatus(event.type === "formula:view"
                ? "Saved labels locally"
                : `Saved locally · epoch ${model.epoch}`);
        } else if (event.type === "formula:error") {
            setStatus(event.error?.message || "Formula error");
        }
    });
    render();
    remember();
}

function render() {
    disposeWidgets?.();
    const view = evaluate('.Sheet(document, {= title="RiXCel document" })');
    host.innerHTML = renderOutputHtml(view, exactFormat);
    disposeWidgets = mountOutputWidgets(host, view, {
        format: exactFormat,
        onSelection(detail) {
            setStatus(detail.coordinateLabel || detail.address);
        },
    });
}

function blankCsv(rows = 20, columns = 8) {
    const letters = Array.from({ length: columns }, (_item, index) =>
        String.fromCharCode(65 + index));
    return [letters.join(","), ...Array.from({ length: rows }, () =>
        Array(columns).fill("").join(","))].join("\n");
}

function importText(text, kind, nextName) {
    setHostText(text);
    const header = headerToggle.checked ? 1 : 0;
    const expression = kind === "rixcel"
        ? ".RiXCelImport(hosttext)"
        : kind === "tsv"
            ? `.RiXCelImportTsv(hosttext, {= header=${header} })`
            : `.RiXCelImportCsv(hosttext, {= header=${header} })`;
    bindModel(evaluate(expression), nextName);
}

function newDocument() {
    setHostText(blankCsv());
    bindModel(evaluate('.RiXCelImportCsv(hosttext, {= header=1, id="untitled" })'), "Untitled.rixcel");
    setStatus("New document");
}

function download(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
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
    importText(text, kind, kind === "rixcel" ? file.name : `${file.name.replace(/\.[^.]+$/u, "")}.rixcel`);
    setStatus(`Opened ${file.name}`);
}

function restoreAt(index) {
    if (index < 0 || index >= history.length) return;
    restoring = true;
    try {
        setHostText(history[index]);
        bindModel(evaluate(".RiXCelImport(hosttext)"), name, { resetHistory: false });
        historyIndex = index;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, document: history[index] }));
        updateHistoryButtons();
        setStatus(index < history.length - 1 ? "Undo restored" : "Redo restored");
    } finally {
        restoring = false;
    }
}

document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "new") newDocument();
    else if (action === "open") fileInput.click();
    else if (action === "save") {
        download(stringifyRixCelDocument(model), name, "application/json");
        setStatus("Saved document");
    } else if (action === "export-csv") exportDelimited("csv");
    else if (action === "export-tsv") exportDelimited("tsv");
    else if (action === "undo") restoreAt(historyIndex - 1);
    else if (action === "redo") restoreAt(historyIndex + 1);
});

fileInput.addEventListener("change", async () => {
    const [file] = fileInput.files || [];
    fileInput.value = "";
    if (!file) return;
    try {
        await openFile(file);
    } catch (error) {
        setStatus(error.message || String(error));
    }
});

try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.document) importText(saved.document, "rixcel", saved.name);
    else newDocument();
} catch (error) {
    console.warn("RiXCel local recovery failed", error);
    newDocument();
    setStatus("Local recovery failed; opened a new document");
}
