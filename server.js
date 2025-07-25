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
const FONT_PATH = path.join(process.cwd(), 'test-data', 'Lato-Regular.ttf');
registerFont(FONT_PATH, { family: 'Lato' });


app.post('/generate-video', async (req, res) => {
    console.log('[API] Received request for /generate-video.');
    const { title, content, authorName, templateId, audioBufferBase64 } = req.body;
    
    // --- AUDIO DEBUG LOG #1: Check if data was received ---
    console.log(`[AUDIO DEBUG] Received audioBufferBase64 with length: ${audioBufferBase64 ? audioBufferBase64.length : '0'}`);

    if (!audioBufferBase64 || audioBufferBase64.length < 100) {
        return res.status(400).send({ error: 'Audio data is missing or empty.' });
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-gen-'));
    try {
        const audioBuffer = Buffer.from(audioBufferBase64, 'base64');
        
        // --- AUDIO DEBUG LOG #2: Check if data was decoded correctly ---
        console.log(`[AUDIO DEBUG] Decoded audioBuffer with size: ${audioBuffer.length} bytes.`);
        if (audioBuffer.length < 100) { // A valid WAV file header is ~44 bytes, so < 100 is suspicious.
             console.error('[AUDIO DEBUG] Audio buffer is too small. It might be empty or corrupt.');
        }

        const videoBuffer = await generateFastVideo(audioBuffer, { title, content, authorName, templateId }, tempDir);
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
async function generateFastVideo(audioBuffer, letterData, tempDir) {
    const audioPath = path.join(tempDir, 'audio.wav');
    const headerPath = path.join(tempDir, 'header.png');
    const bodyPath = path.join(tempDir, 'body.png');
    const videoPath = path.join(tempDir, 'output.mp4');

    await fs.writeFile(audioPath, audioBuffer);
    
    // The API now finds the template SVG based on the ID it receives
    const templateSvgPath = path.join(process.cwd(), 'test-data', `template.svg`); // Simplified to use one template for the test

    const headerImage = await renderSvgToPng(templateSvgPath, headerPath);
    const bodyImage = await renderTextToImage(letterData, bodyPath); // Pass all text data to the renderer
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

async function renderSvgToPng(svgPath, outputPath) {
    const svgBuffer = await fs.readFile(svgPath);
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

async function renderTextToImage(letterData, outputPath) {
    const canvasWidth = 1040; // The width of the final text block
    const padding = 40;
    const textBlockWidth = canvasWidth - (2 * padding);
    
    const tempCtx = createCanvas(1, 1).getContext('2d');
    let currentY = padding;

    // --- Calculate layout for all text elements to determine final image height ---
    tempCtx.font = '700 48px "Playfair Display"';
    const titleLines = wrapText(tempCtx, letterData.title || 'Your Title', textBlockWidth);
    currentY += titleLines.length * 60; // 60px line height for title
    
    currentY += 60; // Space after title
    
    tempCtx.font = '24px Lato';
    const contentLines = wrapText(tempCtx, letterData.content || '', textBlockWidth);
    currentY += contentLines.length * 44; // 44px line height for content

    currentY += 60; // Space after content
    
    tempCtx.font = 'italic 28px "Playfair Display"';
    const authorText = `- ${letterData.authorName || ''}`;
    currentY += 40; // line height for author

    const canvasHeight = currentY + padding;

    // --- Create final canvas and draw everything ---
    const finalCanvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = finalCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    currentY = padding;

    // Draw Title
    ctx.font = '700 48px "Playfair Display"';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    for (const line of titleLines) {
        ctx.fillText(line, canvasWidth / 2, currentY);
        currentY += 60;
    }
    currentY += 60;

    // Draw Content
    ctx.font = '24px Lato';
    ctx.fillStyle = '#444';
    ctx.textAlign = 'left';
    for (const line of contentLines) {
        ctx.fillText(line, padding, currentY);
        currentY += 44;
    }
    currentY += 60;

    // Draw Author
    ctx.font = 'italic 28px "Playfair Display"';
    ctx.fillStyle = '#555';
    ctx.textAlign = 'left';
    ctx.fillText(authorText, padding, currentY);

    const buffer = finalCanvas.toBuffer('image/png');
    await fs.writeFile(outputPath, buffer);
    return { width: canvasWidth, height: canvasHeight };
}

function wrapText(context, text, maxWidth) {
    const words = text.replace(/\n/g, ' \n ').split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
        if (word === '\n') {
            lines.push(currentLine);
            currentLine = '';
            continue;
        }
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        if (context.measureText(testLine).width > maxWidth && currentLine !== '') {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);
    return lines;
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
                `[1:v]pad=width=1280:height=ih:x=(ow-iw)/2:y=0:color=white[padded_body]`,
                `[0:v][padded_body]vstack=inputs=2[letter]`,
                `color=s=1280x720:c=white[bg]`,
                `[bg][letter]overlay=x=(W-w)/2:y='-t/${audioDuration}*${scrollHeight}'[out]`
            ])
            .outputOptions(['-map', '[out]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'])
            .duration(audioDuration)
            .toFormat('mp4')
            .on('end', resolve)
            // --- ADDED DETAILED ERROR LOGGING ---
            .on('error', (err, stdout, stderr) => {
                console.error('--- FFMPEG ERROR ---');
                console.error('Error message:', err.message);
                console.error('--- FFMPEG STDERR ---');
                console.error(stderr);
                reject(new Error(`FFMPEG failed: ${err.message}`));
            })
            .save(outputPath);
    });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Media Generation API is running on port ${PORT}`);
});