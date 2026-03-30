import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

// Define paths
const UPLOADS_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

// FFmpeg path (found earlier)
const FFMPEG_PATH = "C:\\Users\\duvan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe";

// Whisper binary path (will be moved soon)
const WHISPER_PATH = join(process.cwd(), 'whisper');
const MODEL_PATH = join(WHISPER_PATH, 'models', 'ggml-base.bin');

const app = new Elysia()
    .use(cors())
    .post('/transcribe', async ({ body }) => {
        const file = (body as any).file as File;
        if (!file) return { error: 'No file provided' };

        const id = crypto.randomUUID();
        const inputPath = join(UPLOADS_DIR, `${id}_${file.name}`);
        const wavPath = join(UPLOADS_DIR, `${id}.wav`);

        try {
            // Save file
            const buffer = Buffer.from(await file.arrayBuffer());
            writeFileSync(inputPath, buffer);

            // Convert to 16kHz mono wav (required by whisper.cpp)
            await new Promise((resolve, reject) => {
                const ffmpeg = spawn(FFMPEG_PATH, [
                    '-i', inputPath,
                    '-ar', '16000',
                    '-ac', '1',
                    '-c:a', 'pcm_s16le',
                    wavPath,
                    '-y'
                ]);
                let stderr = '';
                ffmpeg.stderr.on('data', (d) => stderr += d.toString());
                ffmpeg.on('close', (code) => code === 0 ? resolve(null) : reject(`FFmpeg failed (${code}): ${stderr}`));
            });

            // Find whisper binary (try main.exe or whisper-cli.exe)
            let whisperBinary = join(WHISPER_PATH, 'main.exe');
            if (!existsSync(whisperBinary)) {
                whisperBinary = join(WHISPER_PATH, 'whisper-cli.exe');
            }
            if (!existsSync(whisperBinary)) {
                whisperBinary = join(WHISPER_PATH, 'whisper.exe');
            }

            if (!existsSync(whisperBinary)) {
              throw new Error(`Whisper binary not found at ${whisperBinary}`);
            }

            // Run whisper using relative paths to avoid space-in-path issues on Windows
            const relWavPath = join('..', 'uploads', `${id}.wav`);
            const relModelPath = join('models', 'ggml-base.bin');

            const result = await new Promise<string>((resolve, reject) => {
                const whisper = spawn('cmd.exe', [
                    '/c', 
                    `whisper-cli.exe -m ${relModelPath} -f ${relWavPath}`
                ], {
                    cwd: WHISPER_PATH
                });
                
                let stdout = '';
                let stderr = '';
                whisper.stdout.on('data', (data) => stdout += data.toString());
                whisper.stderr.on('data', (data) => stderr += data.toString());
                
                whisper.on('close', (code) => {
                    if (code === 0) {
                        // Filter out the "whisper_..." and "system_info" logs from stdout if they appear there
                        // Actually, -nt might still show some info in stderr
                        resolve(stdout);
                    } else {
                        reject(new Error(`Whisper failed with code ${code}. Stderr: ${stderr}`));
                    }
                });
            });

            // Return raw output lines so frontend can parse timestamps
            const rawLines = result
                .split('\n')
                .filter(line => line.trim() && !line.trim().startsWith('whisper_') && !line.trim().startsWith('system_info'))
                .map(line => line.trim());

            return { lines: rawLines, text: rawLines.join(' ') };
        } catch (error: any) {
            console.error('Processing error detailed:', error);
            // The original instruction included an 'alert' which is a browser-side function.
            // For a backend Node.js application, we should return an error response.
            return { error: error.message || 'Processing failed' };
        } finally {
            // Clean up files synchronously after response
            setTimeout(() => {
                try {
                    if (existsSync(inputPath)) unlinkSync(inputPath);
                    if (existsSync(wavPath)) unlinkSync(wavPath);
                } catch (e) {
                    console.error('Cleanup error:', e);
                }
            }, 5000);
        }
    }, {
        body: t.Object({
            file: t.Any()
        })
    })
    .get('/', () => ({ status: 'ready', message: 'Whisper Backend Functional' }))
    .listen(3005);

console.log(`\n✅ Whisper Backend Server active!`);
console.log(`📍 Endpoint: POST http://localhost:3005/transcribe (form-data: file)`);
console.log(`📍 Health:   GET  http://localhost:3005/`);
