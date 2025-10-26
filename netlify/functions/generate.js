import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import Busboy from "busboy";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Gunakan metode POST" };
  }

  const tmpDir = "/tmp";
  const inputPath = path.join(tmpDir, `input-${Date.now()}.jpg`);
  const outputPath = path.join(tmpDir, `result-${Date.now()}.mp4`);

  return new Promise((resolve) => {
    const busboy = Busboy({
      headers: event.headers,
    });

    let duration = 5;

    busboy.on("field", (fieldname, val) => {
      if (fieldname === "duration") duration = Number(val) || 5;
    });

    busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
      const saveTo = fs.createWriteStream(inputPath);
      file.pipe(saveTo);
    });

    busboy.on("finish", async () => {
      try {
        const args = [
          "-y",
          "-loop", "1",
          "-i", inputPath,
          "-t", String(duration),
          "-vf",
          "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black",
          "-r", "30",
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-crf", "18",
          "-preset", "slow",
          outputPath,
        ];

        const ff = spawn(ffmpegPath, args);
        ff.on("close", () => {
          const buffer = fs.readFileSync(outputPath);
          try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch {}

          resolve({
            statusCode: 200,
            headers: {
              "Content-Type": "video/mp4",
              "Content-Disposition": "attachment; filename=result.mp4",
            },
            body: buffer.toString("base64"),
            isBase64Encoded: true,
          });
        });
      } catch (err) {
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: err.message }),
        });
      }
    });

    // Parse body stream
    const buffer = Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
    busboy.end(buffer);
  });
};
