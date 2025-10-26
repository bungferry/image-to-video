// netlify/functions/generate.js
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import formidable from "formidable";
import { Readable } from "stream";

export const handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed. Gunakan POST." };
  }

  // cek apakah ffmpeg tersedia
  if (!ffmpegPath) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ffmpeg-static tidak ditemukan. Pastikan dependency ter-install dan termasuk di bundle." }),
    };
  }

  // Netlify mengirim body sebagai base64 ketika ada binary upload.
  // Kita ubah body base64 jadi stream agar formidable bisa parse.
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  if (!contentType.startsWith("multipart/form-data")) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Content-Type harus multipart/form-data" }),
    };
  }

  // buat Readable stream dari body base64
  const bodyBuffer = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");
  const rs = new Readable();
  rs.push(bodyBuffer);
  rs.push(null);

  // configure formidable untuk menyimpan di /tmp
  const form = new formidable.IncomingForm({
    multiples: false,
    keepExtensions: true,
    uploadDir: "/tmp",
    maxFileSize: 50 * 1024 * 1024, // 50 MB limit (sesuaikan)
  });

  return new Promise((resolve) => {
    form.parse(rs, async (err, fields, files) => {
      try {
        if (err) {
          console.error("formidable error:", err);
          resolve({
            statusCode: 400,
            body: JSON.stringify({ error: "Gagal parse form-data", detail: err.message }),
          });
          return;
        }

        const file = files.image || files.file || files.upload;
        if (!file) {
          resolve({ statusCode: 400, body: JSON.stringify({ error: "Field file 'image' tidak ditemukan" }) });
          return;
        }

        // path/file property bisa berbeda tergantung versi formidable
        const inputPath = file.filepath || file.path || file.pathName || file.path;
        if (!inputPath || !fs.existsSync(inputPath)) {
          resolve({ statusCode: 500, body: JSON.stringify({ error: "File upload tidak tersedia di disk", detail: { inputPath } }) });
          return;
        }

        let duration = Number(fields.duration) || 5;
        duration = Math.min(Math.max(duration, 1), 300); // 1..300 detik

        const outputPath = path.join("/tmp", `result-${Date.now()}.mp4`);

        const args = [
          "-y",
          "-loop", "1",
          "-i", inputPath,
          "-t", String(duration),
          "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black",
          "-r", "30",
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-crf", "18",
          "-preset", "veryfast", // ubah ke veryfast untuk mengurangi waktu CPU di fungsi
          outputPath,
        ];

        console.log("Menjalankan ffmpeg:", ffmpegPath, args.join(" "));

        const ff = spawn(ffmpegPath, args, { windowsHide: true });

        let fferr = "";
        ff.stderr.on("data", (d) => {
          fferr += d.toString();
          // print ke log agar bisa dilihat di Netlify logs
          console.log("[ffmpeg]", d.toString());
        });

        ff.on("error", (spawnErr) => {
          console.error("ffmpeg spawn error:", spawnErr);
        });

        ff.on("close", (code) => {
          // hapus file input agar bersih
          try { fs.unlinkSync(inputPath); } catch (e) {}

          if (code !== 0) {
            console.error("ffmpeg exit code:", code);
            resolve({
              statusCode: 500,
              body: JSON.stringify({ error: "ffmpeg gagal meng-encode", code, ffmpegLog: fferr.slice(-2000) }),
            });
            // hapus output jika ada
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
            return;
          }

          // baca hasil dan kirim sebagai base64 (Netlify membutuhkan isBase64Encoded true)
          try {
            const outBuf = fs.readFileSync(outputPath);
            // hapus output setelah dibaca
            try { fs.unlinkSync(outputPath); } catch (e) {}
            resolve({
              statusCode: 200,
              headers: {
                "Content-Type": "video/mp4",
                "Content-Disposition": `attachment; filename="result-${Date.now()}.mp4"`,
              },
              body: outBuf.toString("base64"),
              isBase64Encoded: true,
            });
          } catch (readErr) {
            console.error("gagal baca output:", readErr);
            resolve({ statusCode: 500, body: JSON.stringify({ error: "Gagal membaca output", detail: readErr.message }) });
          }
        });
      } catch (e) {
        console.error("handler error:", e);
        resolve({ statusCode: 500, body: JSON.stringify({ error: e.message }) });
      }
    });
  });
};
