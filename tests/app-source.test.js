import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

describe("RiXCel standalone app", () => {
    test("exposes document, interchange, history, and save-before-switch controls", async () => {
        const html = await readFile(new URL("src/index.html", root), "utf8");
        for (const action of ["new", "open", "save", "export-csv", "export-tsv", "undo", "redo"]) {
            expect(html).toContain(`data-action="${action}"`);
        }
        expect(html).toContain('accept=".rixcel,.csv,.tsv');
        expect(html).toContain('id="switch-document-dialog"');
        for (const choice of ["save", "discard", "cancel"]) expect(html).toContain(`value="${choice}"`);
    });

    test("uses sparse event persistence and worker-guarded FormulaSheet editing", async () => {
        const source = await readFile(new URL("src/main.js", root), "utf8");
        expect(source).toContain("mountOutputWidgets");
        expect(source).toContain("appendRixCelEvent");
        expect(source).toContain("setRixCelCursor");
        expect(source).toContain("setRixCelDraft");
        expect(source).toContain("beforeSheetEdit: preflightEdit");
        expect(source).toContain("beforeSheetBatchEdit: preflightBatchEdit");
        expect(source).toContain('type: "slot:batch"');
        expect(source).toContain("evaluationWorker.request");
        expect(source).toContain("localStorage.setItem");
        expect(source).toContain("model.subscribe");
    });
});
