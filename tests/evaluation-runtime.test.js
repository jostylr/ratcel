import { describe, expect, test } from "bun:test";
import {
    createRixCelDocument,
    appendRixCelEvent,
} from "../../../rix/src/index.js";
import {
    RIXCEL_WITHHELD_CAPABILITIES,
    RixCelEvaluationSession,
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

    test("owns one persistent graph and projects bounded visible windows", () => {
        const session = new RixCelEvaluationSession();
        const document = createRixCelDocument({ id: "large-worker", shape: [1000, 1000] });
        session.open(document);
        const model = session.model;
        const first = session.project({ rowStart: 1, rowCount: 10, columnStart: 1, columnCount: 5 });
        expect(first.window).toEqual({ rowStart: 1, rowCount: 10, columnStart: 1, columnCount: 5 });
        expect(first.materializedSlotCount).toBe(50);
        expect((first.html.match(/<td /gu) || [])).toHaveLength(50);

        const candidate = appendRixCelEvent(document, {
            type: "slot:set", index: [1, 1], source: "7", assignmentMode: ":=", view: {},
        });
        session.commit(candidate);
        expect(session.model).toBe(model);
        expect(session.project(first.window).html).toContain(">7</td>");

        const second = session.project({ rowStart: 991, rowCount: 40, columnStart: 996, columnCount: 12 });
        expect(second.window).toEqual({ rowStart: 991, rowCount: 10, columnStart: 996, columnCount: 5 });
        expect((second.html.match(/<td /gu) || [])).toHaveLength(50);
    });
});
