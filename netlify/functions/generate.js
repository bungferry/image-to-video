import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// --- Logika Penyesuaian Jalur FFmpeg untuk Netlify Lambda ---
let ffmpegPath = ffmpegStatic;

if (process.env.LAMBDA_TASK_ROOT) {
    // Cari biner di tempat yang diharapkan oleh Lambda setelah bundling
    const functionRoot = process.env.LAMBDA_TASK_ROOT;
    const binPath = path.join(functionRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg');
    
    // Periksa dan gunakan jalur yang sudah di-deploy
    if (fs.existsSync(binPath)) {
        ffmpegPath = binPath;
    }
}
// Hapus kode fs.chmodSync karena EROFS (Read-Only)

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

    // Simpan file gambar sementara
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
        .size("1920x1080")
        .outputOptions([
          "-preset veryfast",
          "-pix_fmt yuv420p",
          // PERBAIKAN SINTAKS VF: Hapus tanda kutip tunggal ('') yang tidak perlu
          "-vf scale=min(1920,iw):min(1080,ih):force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1:color=black"
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
    if (inputPath && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }
};
