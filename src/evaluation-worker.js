import { evaluateRixCelRequest } from "./evaluation-runtime.js";

self.addEventListener("message", (event) => {
    const { id, request } = event.data || {};
    try {
        self.postMessage({ id, type: "result", value: evaluateRixCelRequest(request) });
    } catch (error) {
        self.postMessage({
            id,
            type: "error",
            message: error instanceof Error ? error.message : String(error),
        });
    }
});
