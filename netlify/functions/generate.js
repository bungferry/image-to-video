import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// --- Logika Penyesuaian Jalur FFmpeg untuk Netlify Lambda ---
// Ini penting untuk memastikan Netlify menemukan binary FFmpeg
let ffmpegPath = ffmpegStatic;

if (process.env.LAMBDA_TASK_ROOT) {
    const functionRoot = process.env.LAMBDA_TASK_ROOT;
    // Tentukan path ke binary FFmpeg di lingkungan Lambda
    const binPath = path.join(functionRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg');
    
    if (fs.existsSync(binPath)) {
        ffmpegPath = binPath;
    }
}
ffmpeg.setFfmpegPath(ffmpegPath);
// -----------------------------------------------------------

export const handler = async (event) => {
  let inputPath = null;
  let outputPath = null;

  try {
    if (!event.body) throw new Error("Tidak ada body di request.");

    const { imageBase64, duration, resolution } = JSON.parse(event.body);
    if (!imageBase64) throw new Error("Tidak ada file gambar.");
    
    // --- Proses Resolusi ---
    // Target resolusi default adalah 1920x1080 (16:9)
    const targetResolution = resolution || "1920x1080"; 
    const [W, H] = targetResolution.split('x').map(Number); // W = lebar, H = tinggi
    if (isNaN(W) || isNaN(H)) {
        throw new Error("Format resolusi tidak valid.");
    }
    console.log(`Target Resolution: ${W}x${H}`);
    // -----------------------

    const tmpDir = "/tmp";
    const uniqueId = Date.now();
    inputPath = path.join(tmpDir, `input-${uniqueId}.jpg`);
    outputPath = path.join(tmpDir, `output-${uniqueId}.mp4`);

    // Tulis buffer gambar ke file sementara
    fs.writeFileSync(inputPath, Buffer.from(imageBase64, "base64"));
    console.log(`Input file saved to: ${inputPath}`);

    const dur = duration ? Number(duration) : 5;

    // Proses ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOptions([
          "-loop 1",        // Looping gambar sebagai video
          "-t " + dur,      // Durasi video
          "-framerate 25",  // Framerate 25 fps
        ])
        .videoCodec("libx264")
        .outputOptions([
          "-preset veryfast",
          "-pix_fmt yuv420p",
          
          // FILTER UTAMA: Scale dan Pad untuk Rasio Apapun
          // Filter ini memastikan gambar diskalakan (tanpa distorsi) dan di-pad dengan bingkai hitam
          // agar sesuai dengan W x H target (termasuk rasio 1200x630, 1080x1350, dll.)
          `-vf scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`
        ])
        .save(outputPath)
        .on("end", () => {
          console.log("FFmpeg Selesai.");
          resolve();
        })
        .on("error", (err, stdout, stderr) => {
          console.error("FFmpeg Error:", err.message);
          console.error("FFmpeg Stderr:", stderr);
          reject(new Error("Gagal mengonversi video: " + err.message));
        });
    });

    const videoBuffer = fs.readFileSync(outputPath);

    return {
      statusCode: 200,
      headers: { 
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="output-${uniqueId}.mp4"`
      },
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
