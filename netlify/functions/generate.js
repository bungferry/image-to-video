import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// --- Logika Penyesuaian Jalur FFmpeg untuk Netlify Lambda ---
let ffmpegPath = ffmpegStatic;

// Cari biner di tempat yang diharapkan oleh Lambda setelah bundling
if (process.env.LAMBDA_TASK_ROOT) {
    const functionRoot = process.env.LAMBDA_TASK_ROOT;
    const binPath = path.join(functionRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg');
    
    if (fs.existsSync(binPath)) {
        ffmpegPath = binPath;
    }
}
// Kode chmod (fs.chmodSync) sudah dihapus karena error EROFS

ffmpeg.setFfmpegPath(ffmpegPath);
// -----------------------------------------------------------

export const handler = async (event) => {
  let inputPath = null;
  let outputPath = null;

  try {
    if (!event.body) throw new Error("Tidak ada body di request.");

    const { imageBase64, duration } = JSON.parse(event.body);
    if (!imageBase64) throw new Error("Tidak ada file gambar.");

    const tmpDir = "/tmp";
    const uniqueId = Date.now();
    inputPath = path.join(tmpDir, `input-${uniqueId}.jpg`);
    outputPath = path.join(tmpDir, `output-${uniqueId}.mp4`);

    fs.writeFileSync(inputPath, Buffer.from(imageBase64, "base64"));
    console.log(`Input file saved to: ${inputPath}`);

    const dur = duration ? Number(duration) : 5;

    // Proses ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOptions([
          "-loop 1",
          "-t " + dur,
          "-framerate 25",
        ])
        .videoCodec("libx264")
        // Hapus .size() karena kita menggunakan filter (-vf)
        .outputOptions([
          "-preset veryfast",
          "-pix_fmt yuv420p",
          
          // PERBAIKAN SINTAKS FILTER (-vf)
          // 1. Scale gambar agar pas di 1920x1080 (menjaga rasio aspek).
          // 2. Pad (isi) sisanya dengan warna hitam.
          "-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black"
        ])
        .save(outputPath)
        .on("end", () => {
          console.log("FFmpeg Selesai.");
          resolve();
        })
        .on("error", (err, stdout, stderr) => {
          console.error("FFmpeg Error:", err.message);
          console.error("FFmpeg Stdout:", stdout);
          console.error("FFmpeg Stderr:", stderr);
          reject(new Error("Gagal mengonversi video: " + err.message));
        });
    });

    const videoBuffer = fs.readFileSync(outputPath);

    return {
      statusCode: 200,
      headers: { "Content-Type": "video/mp4" },
      body: videoBuffer.toString("base64"),
      isBase64Encoded: true,
    };
    
  } catch (err) {
    console.error("Global Catch Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Kesalahan Server Internal." }),
    };
  } finally {
    // Pastikan file sementara dihapus
    if (inputPath && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }
};
