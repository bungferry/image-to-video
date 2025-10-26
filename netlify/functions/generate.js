import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static"; // Ubah penamaan import agar lebih jelas

// --- Logika Penyesuaian Jalur FFmpeg untuk Netlify Lambda ---
let ffmpegPath = ffmpegStatic;

// Jika kode berjalan di lingkungan AWS Lambda (Netlify), sesuaikan jalur
if (process.env.LAMBDA_TASK_ROOT) {
    // Jalur biner yang seringkali digunakan setelah Netlify membundel ffmpeg-static
    const functionRoot = process.env.LAMBDA_TASK_ROOT;
    const binPath = path.join(functionRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg');
    
    // Gunakan binPath jika ada, jika tidak, gunakan default ffmpegStatic
    if (fs.existsSync(binPath)) {
        ffmpegPath = binPath;
    }
}

// Atur jalur FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Berikan izin eksekusi (chmod) karena sering hilang saat di-deploy
try {
    fs.chmodSync(ffmpegPath, '755');
} catch (e) {
    console.error("Gagal mengatur izin eksekusi (chmod) FFmpeg:", e.message);
}
// -----------------------------------------------------------

export const handler = async (event) => {
  // Variabel untuk melacak file agar bisa dihapus meskipun terjadi error
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
        // Gunakan input options yang lebih andal untuk gambar diam
        .inputOptions([
          "-loop 1",       // Loop gambar
          "-t " + dur,     // Durasi video
          "-framerate 25", // Framerate input
        ])
        .videoCodec("libx264")
        .size("1920x1080")
        .outputOptions([
          "-preset veryfast", // Optimasi kecepatan konversi
          "-pix_fmt yuv420p",
          // Scale/pad untuk memastikan gambar pas di 1920x1080 tanpa distorsi
          "-vf scale='min(1920,iw):min(1080,ih):force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1:color=black'"
        ])
        .save(outputPath)
        .on("end", () => {
          console.log("FFmpeg Selesai.");
          resolve();
        })
        // Tangani error dengan mencatat stdout/stderr
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
