import { describe, expect, test } from "bun:test";
import {
    createRixCelDocument,
    appendRixCelEvent,
} from "../../../rix/src/index.js";
import {
    RIXCEL_WITHHELD_CAPABILITIES,
    createRixCelEvaluationState,
    evaluateRixCelRequest,
} from "../src/evaluation-runtime.js";

describe("RiXCel worker evaluation runtime", () => {
    test("withholds host, plugin, dynamic-code, and asynchronous capabilities", () => {
        const { systemContext } = createRixCelEvaluationState();
        for (const capability of RIXCEL_WITHHELD_CAPABILITIES) {
            expect(systemContext.has(capability)).toBe(false);
        }
        expect(systemContext.has("RiXCelImport")).toBe(true);
        expect(systemContext.has("Abs")).toBe(true);
    });

    test("validates a sparse history and its formula dependencies", () => {
        let document = createRixCelDocument({ id: "worker", shape: [1, 2] });
        document = appendRixCelEvent(document, {
            type: "slot:set", index: [1, 1], source: "7", assignmentMode: ":=", view: {},
        });
        document = appendRixCelEvent(document, {
            type: "slot:set", index: [1, 2], source: "grid[1,1] * 3", assignmentMode: ":=", view: {},
        });
        const result = evaluateRixCelRequest({ type: "validate", document });
        expect(result.document.events).toHaveLength(2);
        expect(() => evaluateRixCelRequest({
            type: "validate",
            document: appendRixCelEvent(document, {
                type: "slot:set", index: [1, 1], source: "grid[1,2]", assignmentMode: ":=", view: {},
            }),
        })).toThrow("Formula cycle");
    });

    test("imports CSV into the versioned event-log format", () => {
        const result = evaluateRixCelRequest({
            type: "import",
            kind: "csv",
            text: "name,value\nalpha,3",
            header: true,
            id: "csv-worker",
        });
        expect(result.document.version).toBe(2);
        expect(result.document.shape).toEqual([1, 2]);
        expect(result.document.events).toHaveLength(2);
    });
});
