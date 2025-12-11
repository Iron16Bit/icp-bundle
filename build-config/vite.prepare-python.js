import { defineConfig } from 'vite';
import path from "path";
import { fileURLToPath } from "url";

export default defineConfig({
    resolve: {
        // The uint8arrays package needed by libp2p has some internal specifiers like "#compare" and "#util/..." which aren't automatically resolved
        // To do so, we can "manually" resolve them to their import path
        alias: [
        {
            // Map any "#util/..." internal specifier to the actual file in node_modules
            find: /^#util\/(.*)/,
            replacement:
            path.resolve(__dirname, "../node_modules/uint8arrays/dist/src/util") +
            "/$1.js",
        },
        { find: "#compare", replacement: "uint8arrays/compare"},
        { find: "#concat", replacement: "uint8arrays/concat" },
        { find: "#equals", replacement: "uint8arrays/equals" },
        { find: "#from-string", replacement: "uint8arrays/from-string" },
        { find: "#to-string", replacement: "uint8arrays/to-string" },
        { find: "#coerce", replacement: "uint8arrays/coerce" },
        { find: "#alloc", replacement: "uint8arrays/alloc" },
        ],
    },
    // Ensure esbuild accepts BigInt literals
    esbuild: {
        target: "esnext",
    },
    build: {
        // ensure the bundler target supports BigInt literals
        target: "esnext",
        outDir: 'src/modules/workers',
        emptyOutDir: false,
        lib: {
            entry: 'src/modules/workers/pythonOfflineWorker.ts',
            formats: ['iife'],
            fileName: 'pythonWorkerBundle',
            name: 'PythonWorker',
        }
    },
});