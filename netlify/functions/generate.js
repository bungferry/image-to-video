import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import formidable from "formidable";

export const handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Gunakan metode POST dengan multipart/form-data",
    };
  }

  return new Promise((resolve) => {
    const form = new formidable.IncomingForm({
      multiples: false,
      keepExtensions: true,
      uploadDir: "/tmp",
    });

    form.parse(event, async (err, fields, files) => {
      try {
        if (err) throw err;
        if (!files.image) {
          resolve({
            statusCode: 400,
            body: JSON.stringify({ error: "File 'image' tidak ditemukan" }),
          });
          return;
        }

        let duration = Number(fields.duration) || 5;
        duration = Math.min(Math.max(duration, 1), 120);

        const inputPath = files.image.filepath || files.image.path;
        const outputPath = path.join("/tmp", `result-${Date.now()}.mp4`);

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
        let stderr = "";

        ff.stderr.on("data", (d) => (stderr += d.toString()));

        ff.on("close", (code) => {
          try { fs.unlinkSync(inputPath); } catch (_) {}

          if (code !== 0) {
            resolve({
              statusCode: 500,
              body: JSON.stringify({ error: "ffmpeg gagal", detail: stderr }),
            });
            return;
          }

          const buffer = fs.readFileSync(outputPath);
          try { fs.unlinkSync(outputPath); } catch (_) {}

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
      } catch (e) {
        console.error(e);
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: e.message }),
        });
      }
    });
  });
};
