// api/generate.js
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const formidable = require("formidable");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Gunakan metode POST dengan multipart/form-data");
    return;
  }

  const form = new formidable.IncomingForm({
    multiples: false,
    keepExtensions: true,
    uploadDir: "/tmp",
  });

  form.parse(req, async (err, fields, files) => {
    try {
      if (err) throw err;
      if (!files.image) {
        res.status(400).json({ error: "File 'image' tidak ditemukan" });
        return;
      }

      let duration = Number(fields.duration) || 5;
      duration = Math.min(Math.max(duration, 1), 120); // 1–120 detik

      const inputPath = files.image.path;
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

      let fferr = "";
      ff.stderr.on("data", (d) => (fferr += d.toString()));

      ff.on("close", (code) => {
        try { fs.unlinkSync(inputPath); } catch (_) {}

        if (code !== 0) {
          console.error("ffmpeg gagal:", code, fferr);
          res.status(500).json({ error: "Encoding gagal", detail: fferr });
          return;
        }

        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", 'attachment; filename="result.mp4"');
        const stream = fs.createReadStream(outputPath);
        stream.pipe(res);
        stream.on("close", () => {
          try { fs.unlinkSync(outputPath); } catch (_) {}
        });
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });
};
