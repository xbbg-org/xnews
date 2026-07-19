import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const mode = process.argv[2];
const argumentList = process.argv.slice(3);
const argumentSet = new Set(argumentList);
const pcmArgumentsValid =
  hasPair("-acodec", "pcm_s16le") &&
  hasPair("-ac", "1") &&
  hasPair("-ar", "16000") &&
  hasPair("-f", "s16le") &&
  argumentList.at(-1) === "pipe:1";

function hasPair(name, value) {
  const index = argumentList.indexOf(name);
  return index >= 0 && argumentList[index + 1] === value;
}

function emitPcm() {
  process.stdout.write(Buffer.from([0, 0, 1, 0, 2, 0, 3, 0]));
}

async function waitForTermination() {
  await new Promise((resolve) => process.once("SIGTERM", resolve));
}

if (argumentSet.has("--version") || argumentSet.has("-version")) {
  console.log(`${mode} fixture 1.0`);
} else if (mode === "yt-finite" || mode === "yt-live") {
  console.log(
    JSON.stringify({
      id: "fedCut2026A",
      url: "https://signed.invalid/audio?token=do-not-expose",
      is_live: mode === "yt-live",
      live_status: mode === "yt-live" ? "is_live" : "not_live",
    }),
  );
} else if (mode === "yt-live-rotate") {
  const statePath = argumentList[0];
  if (!statePath) throw new Error("missing fixture state path");
  const previous = existsSync(statePath) ? Number.parseInt(readFileSync(statePath, "utf8"), 10) : 0;
  const attempt = previous + 1;
  writeFileSync(statePath, String(attempt));
  console.log(
    JSON.stringify({
      id: "fedCut2026A",
      url: `https://signed.invalid/audio?attempt=${attempt}`,
      is_live: true,
      live_status: "is_live",
    }),
  );
} else if (mode === "ffmpeg-finite") {
  if (!pcmArgumentsValid || argumentSet.has("-reconnect_at_eof")) {
    process.exitCode = 9;
  } else {
    emitPcm();
  }
} else if (mode === "ffmpeg-finite-error") {
  emitPcm();
  process.exitCode = 7;
} else if (mode === "ffmpeg-tree-hang") {
  const pidPath = argumentList[0];
  if (!pcmArgumentsValid || !pidPath) {
    process.exitCode = 8;
  } else {
    const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (descendant.pid === undefined) throw new Error("missing descendant pid");
    writeFileSync(pidPath, String(descendant.pid));
    emitPcm();
    await waitForTermination();
  }
} else if (mode === "ffmpeg-live-hang") {
  if (!pcmArgumentsValid || argumentSet.has("-reconnect_at_eof")) {
    process.exitCode = 8;
  } else {
    emitPcm();
    await waitForTermination();
  }
} else if (mode === "ffmpeg-live-fail") {
  if (!pcmArgumentsValid || argumentSet.has("-reconnect_at_eof")) {
    process.exitCode = 8;
  } else {
    emitPcm();
    process.exitCode = 7;
  }
} else if (mode === "ffmpeg-live-rotate") {
  const inputIndex = argumentList.indexOf("-i");
  const inputUrl = inputIndex >= 0 ? argumentList[inputIndex + 1] : undefined;
  if (!pcmArgumentsValid || argumentSet.has("-reconnect_at_eof") || !inputUrl) {
    process.exitCode = 8;
  } else if (inputUrl.endsWith("attempt=1")) {
    emitPcm();
    process.exitCode = 7;
  } else if (inputUrl.endsWith("attempt=2")) {
    emitPcm();
    await waitForTermination();
  } else {
    process.exitCode = 9;
  }
} else {
  process.exitCode = 2;
}
