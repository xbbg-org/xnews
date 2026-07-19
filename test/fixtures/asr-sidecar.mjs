import process from "node:process";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const mode = process.argv[2];

if (mode === "protocol-mismatch") {
  send({ type: "ready", protocolVersion: 2 });
  process.once("SIGTERM", () => process.stdin.pause());
} else {
  send({ type: "ready", protocolVersion: 1 });
  let input = Buffer.alloc(0);
  let generation = 0;
  let emitted = false;
  let frameCount = 0;

  process.stdin.on("data", (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 5) {
      const frameType = input.readUInt8(0);
      const length = input.readUInt32LE(1);
      if (input.length < length + 5) return;
      const payload = input.subarray(5, length + 5);
      input = input.subarray(length + 5);

      if (frameType === 1 && (mode === "flood" || !emitted)) {
        emitted = mode !== "flood";
        frameCount += 1;
        const segmentId = `stub:${generation}:${frameCount}`;
        const partialText = mode === "metadata" ? "A😀" : "market";
        const finalText = mode === "metadata" ? "A😀 closes" : "market close";
        const metadata =
          mode === "metadata"
            ? {
                words: [{ text: "A😀", startMs: 0, durationMs: 100, confidence: 0.9 }],
                speakers: [
                  {
                    speakerId: "speaker-a",
                    speakerIndex: 0,
                    startMs: 0,
                    durationMs: 100,
                    textStart: 0,
                    textEnd: 3,
                  },
                ],
              }
            : {};
        send({
          type: "event",
          event: {
            type: "partial",
            generation,
            segmentId,
            revision: 1,
            text: partialText,
            timing: "model",
            startMs: generation * 200,
            durationMs: 100,
            ...metadata,
          },
        });
        send({
          type: "event",
          event: {
            type: "final",
            generation,
            segmentId,
            revision: 2,
            text: finalText,
            timing: "model",
            startMs: generation * 200,
            durationMs: 200,
            ...metadata,
          },
        });
      } else if (frameType === 2) {
        const gap = JSON.parse(payload.toString("utf8"));
        send({
          type: "event",
          event: {
            type: "gap",
            generation,
            startMs: (generation + 1) * 200,
            durationMs: 0,
            reason: gap.reason,
            message: gap.message,
            recoverable: true,
          },
        });
        generation += 1;
        emitted = false;
        frameCount = 0;
      } else if (frameType === 3) {
        send({ type: "ended" });
        process.stdin.pause();
        return;
      }
    }
  });
}
