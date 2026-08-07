import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const output = path.join(root, "docs");
const assets = path.join(output, "assets");

const browserNodeShims = {
    name: "browser-node-shims",
    setup(build) {
        build.onResolve({ filter: /^node:fs$/ }, () => ({ path: "fs", namespace: "rixcel-shim" }));
        build.onResolve({ filter: /^node:path$/ }, () => ({ path: "path", namespace: "rixcel-shim" }));
        build.onResolve({ filter: /^node:module$/ }, () => ({ path: "module", namespace: "rixcel-shim" }));
        build.onLoad({ filter: /.*/, namespace: "rixcel-shim" }, ({ path: shim }) => {
            if (shim === "fs") return { contents: "export default { readFileSync() { throw new Error('File-system imports are unavailable in RiXCel.'); } };", loader: "js" };
            if (shim === "path") return { contents: "export default { isAbsolute() { return false; }, resolve() { throw new Error('Local paths are unavailable in RiXCel.'); }, dirname() { return ''; } };", loader: "js" };
            return { contents: "export function createRequire() { return () => { throw new Error('Module imports are unavailable in RiXCel.'); }; }", loader: "js" };
        });
    },
};

await mkdir(assets, { recursive: true });
for (const entry of await readdir(assets)) {
    if (entry.endsWith(".js") || entry.endsWith(".js.map")) {
        await rm(path.join(assets, entry));
    }
}
await Bun.write(path.join(output, ".nojekyll"), "");
await Bun.write(path.join(output, "index.html"), await readFile(path.join(root, "src", "index.html")));
const sharedCss = await readFile(path.resolve(root, "../../rix-web/src/app.css"), "utf8");
const appCss = await readFile(path.join(root, "src", "app.css"), "utf8");
await Bun.write(path.join(assets, "app.css"), `${sharedCss}\n${appCss}`);

const result = await Bun.build({
    entrypoints: [
        path.join(root, "src", "main.js"),
        path.join(root, "src", "evaluation-worker.js"),
    ],
    outdir: assets,
    target: "browser",
    format: "esm",
    sourcemap: "linked",
    splitting: true,
    plugins: [browserNodeShims],
});
if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
}
