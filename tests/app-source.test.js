import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

describe("RiXCel standalone app", () => {
    test("exposes document, interchange, and history controls", async () => {
        const html = await readFile(new URL("src/index.html", root), "utf8");
        for (const action of ["new", "open", "save", "export-csv", "export-tsv", "undo", "redo"]) {
            expect(html).toContain(`data-action="${action}"`);
        }
        expect(html).toContain('accept=".rixcel,.csv,.tsv');
    });

    test("uses FormulaSheet persistence and the shared widget protocol", async () => {
        const source = await readFile(new URL("src/main.js", root), "utf8");
        expect(source).toContain("mountOutputWidgets");
        expect(source).toContain("stringifyRixCelDocument");
        expect(source).toContain(".RiXCelImport(hosttext)");
        expect(source).toContain("localStorage.setItem");
        expect(source).toContain("model.subscribe");
    });
});
