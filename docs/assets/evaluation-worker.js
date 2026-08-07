import {
  evaluateRixCelRequest
} from "./chunk-0zbp4bt0.js";

// src/evaluation-worker.js
self.addEventListener("message", (event) => {
  const { id, request } = event.data || {};
  try {
    self.postMessage({ id, type: "result", value: evaluateRixCelRequest(request) });
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

//# debugId=79D7EB969D16349064756E2164756E21
//# sourceMappingURL=evaluation-worker.js.map
