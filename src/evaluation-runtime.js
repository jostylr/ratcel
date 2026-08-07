import {
    Context,
    createDefaultRegistry,
    createDefaultSystemContext,
    exportRixCelDocument,
    parseAndEvaluate,
    parseRixCelDocument,
} from "../../../rix/src/index.js";

export const RIXCEL_WITHHELD_CAPABILITIES = Object.freeze([
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
    "Retry",
]);

export function createRixCelEvaluationState() {
    return {
        context: new Context(),
        registry: createDefaultRegistry(),
        systemContext: createDefaultSystemContext().withhold(...RIXCEL_WITHHELD_CAPABILITIES),
    };
}

function setText(context, name, value) {
    context.setFresh(name, { type: "string", value: String(value ?? "") });
}

function evaluate(state, source) {
    return parseAndEvaluate(source, { ...state, file: "<rixcel-worker>" });
}

/**
 * Evaluate one isolated worker request. No state is shared between requests;
 * terminating the Worker therefore drops every active formula and capability.
 */
export function evaluateRixCelRequest(request) {
    const state = createRixCelEvaluationState();
    if (request?.type === "validate") {
        const document = parseRixCelDocument(request.document);
        setText(state.context, "hosttext", JSON.stringify(document));
        evaluate(state, ".RiXCelImport(hosttext)");
        return { document };
    }
    if (request?.type === "import") {
        const kind = request.kind === "tsv" ? "tsv" : request.kind === "csv" ? "csv" : "rixcel";
        if (kind === "rixcel") {
            const document = parseRixCelDocument(request.text);
            setText(state.context, "hosttext", JSON.stringify(document));
            evaluate(state, ".RiXCelImport(hosttext)");
            return { document };
        }
        setText(state.context, "hosttext", request.text);
        setText(state.context, "hostid", request.id || "imported");
        const fn = kind === "tsv" ? ".RiXCelImportTsv" : ".RiXCelImportCsv";
        const model = evaluate(
            state,
            `${fn}(hosttext, {= header=${request.header ? 1 : 0}, id=hostid })`,
        );
        return { document: exportRixCelDocument(model) };
    }
    throw new Error(`Unknown RiXCel worker request: ${request?.type || "missing type"}`);
}
