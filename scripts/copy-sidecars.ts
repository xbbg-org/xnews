import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src/asr/moonshine-worker.py", import.meta.url));
const destination = fileURLToPath(new URL("../dist/moonshine-worker.py", import.meta.url));
await mkdir(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true });
await copyFile(source, destination);
