import { describe, expect, test } from "bun:test";
import { RixCelWorkerClient } from "../src/evaluation-worker-client.js";

class FakeWorker {
    static instances = [];

    constructor() {
        this.listeners = new Map();
        this.terminated = false;
        FakeWorker.instances.push(this);
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    postMessage(message) {
        this.lastMessage = message;
    }

    respond(value) {
        this.listeners.get("message")?.({
            data: { id: this.lastMessage.id, type: "result", value },
        });
    }

    terminate() {
        this.terminated = true;
    }
}

describe("restartable RiXCel worker client", () => {
    test("correlates successful requests", async () => {
        FakeWorker.instances = [];
        const client = new RixCelWorkerClient({ WorkerConstructor: FakeWorker, timeoutMs: 50 });
        const pending = client.request({ type: "validate" });
        FakeWorker.instances[0].respond({ ok: true });
        await expect(pending).resolves.toEqual({ ok: true });
        client.dispose();
    });

    test("terminates an errant worker and starts a fresh one", async () => {
        FakeWorker.instances = [];
        const client = new RixCelWorkerClient({ WorkerConstructor: FakeWorker, timeoutMs: 5 });
        await expect(client.request({ type: "validate" })).rejects.toThrow("worker was stopped and restarted");
        expect(FakeWorker.instances[0].terminated).toBe(true);
        const second = client.request({ type: "validate" }, { timeoutMs: 50 });
        expect(FakeWorker.instances).toHaveLength(2);
        FakeWorker.instances[1].respond({ ok: true });
        await expect(second).resolves.toEqual({ ok: true });
        client.dispose();
    });
});
