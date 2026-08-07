const DEFAULT_TIMEOUT_MS = 2000;

export class RixCelWorkerClient {
    constructor(options = {}) {
        this.WorkerConstructor = options.WorkerConstructor ?? globalThis.Worker;
        this.url = options.url ?? new URL("./evaluation-worker.js", import.meta.url);
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.nextId = 1;
        this.pending = new Map();
        this.worker = null;
        this.disposed = false;
    }

    start() {
        if (this.disposed) throw new Error("RiXCel evaluation worker has been disposed");
        if (this.worker) return this.worker;
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
        if (!entry) return;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.type === "result") entry.resolve(message.value);
        else entry.reject(new Error(message.message || "RiXCel evaluation failed"));
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
        if (this.disposed) return;
        this.disposed = true;
        this.failAll(new Error("RiXCel evaluation worker was disposed"));
        this.restart();
    }
}
