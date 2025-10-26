import { IncomingForm } from "formidable";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { PassThrough } from "stream";

export const handler = async (event) => {
  try {
    ffmpeg.setFfmpegPath(ffmpegPath);

    const tmpDir = "/tmp";
    const inputPath = path.join(tmpDir, `input-${Date.now()}.jpg`);
    const outputPath = path.join(tmpDir, `output-${Date.now()}.mp4`);

    if (!event.body) throw new Error("Tidak ada body di request.");

    // Decode Base64 body
    const buffer = Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");

    // Simulasikan stream untuk formidable
    const stream = new PassThrough();
    stream.end(buffer);

    const form = new IncomingForm({ multiples: false, keepExtensions: true });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(stream, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    if (!files.image) throw new Error("Tidak ada file gambar.");

    fs.copyFileSync(files.image.filepath, inputPath);

    const duration = fields.duration ? Number(fields.duration) : 5;

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .loop(duration)
        .videoCodec("libx264")
        .size("1920x1080")
        .outputOptions(["-pix_fmt yuv420p"])
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    const videoBuffer = fs.readFileSync(outputPath);

    // Hapus file sementara
    try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch {}

    return {
      statusCode: 200,
      headers: { "Content-Type": "video/mp4" },
      body: videoBuffer.toString("base64"),
      isBase64Encoded: true
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
