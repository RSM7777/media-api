import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, registerFont, loadImage } from 'canvas';
import { htmlToText } from 'html-to-text';

// --- FFMPEG SETUP ---
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

const app = express();
app.use(express.json({ limit: '50mb' }));

// --- FONT REGISTRATION ---
const FONT_PATH = path.join(process.cwd(), 'fonts', 'Lato-Regular.ttf');
registerFont(FONT_PATH, { family: 'Lato' });


app.post('/generate-video', async (req, res) => {
    console.log('[API] Received request for /generate-video.');
    const { htmlContent, audioBufferBase64 } = req.body;
    if (!htmlContent || !audioBufferBase64) {
        return res.status(400).send({ error: 'htmlContent and audioBufferBase64 are required.' });
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-gen-'));
    try {
        const audioBuffer = Buffer.from(audioBufferBase64, 'base64');
        const videoBuffer = await generateFastVideo(audioBuffer, htmlContent, tempDir);
        res.setHeader('Content-Type', 'video/mp4');
        res.send(videoBuffer);
    } catch (error) {
        console.error('[API] Video generation failed:', error);
        res.status(500).send({ error: 'Failed to generate video.' });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});


// --- VIDEO ORCHESTRATION ---
async function generateFastVideo(audioBuffer, htmlContent, tempDir) {
    const audioPath = path.join(tempDir, 'audio.wav');
    const headerPath = path.join(tempDir, 'header.png');
    const bodyPath = path.join(tempDir, 'body.png');
    const videoPath = path.join(tempDir, 'output.mp4');

    await fs.writeFile(audioPath, audioBuffer);

    // Extract SVG and Text from the incoming HTML
    const svgBase64 = extractSvgBase64(htmlContent);
    const text = htmlToText(htmlContent, { selectors: [{ selector: 'div.content', format: 'inline' }] });

    const svgBuffer = Buffer.from(svgBase64, 'base64');
    
    // Generate images using canvas
    const headerImage = await renderSvgToPng(svgBuffer, headerPath);
    const bodyImage = await renderTextToImage(text, bodyPath);
    const audioDuration = await getAudioDuration(audioPath);
    
    await composeVideo(headerImage, bodyImage, audioDuration, headerPath, bodyPath, audioPath, videoPath);
    
    return await fs.readFile(videoPath);
}

// --- HELPER FUNCTIONS ---

function extractSvgBase64(html) {
    const match = html.match(/src='data:image\/svg\+xml;base64,([^']*)'/);
    if (!match || !match[1]) {
        throw new Error('Could not find or parse SVG data URI in HTML content.');
    }
    return match[1];
}

async function renderSvgToPng(svgBuffer, outputPath) {
    const image = await loadImage(svgBuffer);
    const aspectRatio = image.width / image.height;
    const targetWidth = 1280;
    const targetHeight = Math.round(targetWidth / aspectRatio);
    const canvas = createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    const pngBuffer = canvas.toBuffer('image/png');
    await fs.writeFile(outputPath, pngBuffer);
    return { width: targetWidth, height: targetHeight };
}

async function renderTextToImage(text, outputPath) {
    const textBlockWidth = 800; const canvasWidth = 800;
    const fontSize = 24; const lineHeight = 36;
    const tempCanvas = createCanvas(canvasWidth, 1);
    const ctx = tempCanvas.getContext('2d');
    ctx.font = `${fontSize}px Lato`;
    
    const words = text.split(' ');
    let line = ''; const lines = [];
    for (const word of words) {
        const testLine = line + (line ? ' ' : '') + word;
        if (ctx.measureText(testLine).width > textBlockWidth && line !== '') {
            lines.push(line);
            line = word;
        } else {
            line = testLine;
        }
    }
    lines.push(line);

    const canvasHeight = (lines.length * lineHeight);
    const finalCanvas = createCanvas(canvasWidth, canvasHeight);
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.fillStyle = '#fff'; finalCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    finalCtx.font = `${fontSize}px Lato`; finalCtx.fillStyle = '#444'; finalCtx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
        finalCtx.fillText(lines[i], 0, (i * lineHeight));
    }
    const buffer = finalCanvas.toBuffer('image/png');
    await fs.writeFile(outputPath, buffer);
    return { width: canvasWidth, height: canvasHeight };
}

function getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err || !metadata?.format?.duration) return reject(new Error(`Could not get audio duration: ${err?.message || 'Unknown error'}`));
            resolve(metadata.format.duration);
        });
    });
}

async function composeVideo(headerImage, bodyImage, audioDuration, headerPath, bodyPath, audioPath, outputPath) {
    const videoWidth = 1280; const videoHeight = 720;
    const headerHeight = headerImage.height;
    const totalImageHeight = headerHeight + bodyImage.height; 
    const scrollHeight = Math.max(0, totalImageHeight - videoHeight);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(headerPath)
            .input(bodyPath)
            .input(audioPath)
            .complexFilter([
                `[1:v]pad=width=${videoWidth}:height=ih:x=(ow-iw)/2:y=0:color=white[padded_body]`,
                `[0:v][padded_body]vstack=inputs=2[letter]`,
                `color=s=${videoWidth}x${videoHeight}:c=white[bg]`,
                `[bg][letter]overlay=x=(W-w)/2:y='-t/${audioDuration}*${scrollHeight}'[out]`
            ])
            .outputOptions(['-map', '[out]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'])
            .duration(audioDuration)
            .toFormat('mp4')
            .on('end', resolve)
            .on('error', (err) => reject(new Error(`FFMPEG failed: ${err.message}`)))
            .save(outputPath);
    });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Media Generation API is running on port ${PORT}`);
});