import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

export const handler = async (event) => {
  try {
    ffmpeg.setFfmpegPath(ffmpegPath);

    if (!event.body) throw new Error("Tidak ada body di request.");

    const { imageBase64, duration } = JSON.parse(event.body);
    if (!imageBase64) throw new Error("Tidak ada file gambar.");

    const tmpDir = "/tmp";
    const inputPath = path.join(tmpDir, `input-${Date.now()}.jpg`);
    const outputPath = path.join(tmpDir, `output-${Date.now()}.mp4`);

    // Simpan file gambar sementara
    fs.writeFileSync(inputPath, Buffer.from(imageBase64, "base64"));

    const dur = duration ? Number(duration) : 5;

    // Proses ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .loop(dur)
        .videoCodec("libx264")
        .size("1920x1080")
        .outputOptions(["-pix_fmt yuv420p"])
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    const videoBuffer = fs.readFileSync(outputPath);

    // Hapus file sementara
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    return {
      statusCode: 200,
      headers: { "Content-Type": "video/mp4" },
      body: videoBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
