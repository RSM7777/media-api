import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, registerFont, loadImage } from 'canvas';
import puppeteer from 'puppeteer-core';

// --- FFMPEG & FONT SETUP ---
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

const FONT_PATH = path.join(process.cwd(), 'fonts', 'Lato-Regular.ttf');
registerFont(FONT_PATH, { family: 'Lato' });
const TITLE_FONT_PATH = path.join(process.cwd(), 'fonts', 'PlayfairDisplay-Bold.ttf');
registerFont(TITLE_FONT_PATH, { family: 'Playfair Display' });

// --- GLOBAL BROWSER INSTANCE ---
let browserInstance;
const app = express();
app.use(express.json({ limit: '50mb' }));

// --- API ENDPOINT ---
app.post('/generate-video', async (req, res) => {
    const { title, content, authorName, templateId, audioBufferBase64 } = req.body;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-gen-'));
    try {
        const audioBuffer = Buffer.from(audioBufferBase64, 'base64');
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
    const templateSvgPath = path.join(process.cwd(), 'templates', `template${letterData.templateId}.svg`);

    const headerImage = await renderSvgWithPuppeteer(templateSvgPath, headerPath);
    const bodyImage = await renderTextToImage(letterData, bodyPath);
    const audioDuration = await getAudioDuration(audioPath);
    
    await composeVideo(headerImage, bodyImage, audioDuration, headerPath, bodyPath, audioPath, videoPath);
    
    return await fs.readFile(videoPath);
}


// --- HELPER FUNCTIONS ---

async function renderSvgWithPuppeteer(svgPath, outputPath) {
    let page = null;
    try {
        page = await browserInstance.newPage();
        await page.goto(`file://${svgPath}`);
        const svgElement = await page.$('svg');
        if (!svgElement) throw new Error('SVG element not found in template file.');
        await svgElement.screenshot({ path: outputPath, omitBackground: true });
        return await getImageDimensions(outputPath);
    } finally {
        if (page) await page.close();
    }
}

function getImageDimensions(imagePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(imagePath, (err, metadata) => {
            if (err || !metadata.streams[0]?.width || !metadata.streams[0]?.height) {
                return reject(new Error(`Could not get image dimensions: ${err?.message || 'Unknown error'}`));
            }
            resolve({ width: metadata.streams[0].width, height: metadata.streams[0].height });
        });
    });
}

async function renderTextToImage(letterData, outputPath) {
    const textBlockWidth = 800;
    const canvasWidth = 800;
    const fontSize = 24; const lineHeight = 36; const padding = 40;
    const tempCtx = createCanvas(1, 1).getContext('2d');
    let currentY = padding;

    tempCtx.font = `700 48px "Playfair Display"`;
    const titleLines = wrapText(tempCtx, letterData.title || '', textBlockWidth);
    currentY += titleLines.length * 60;
    currentY += 60;
    
    tempCtx.font = `${fontSize}px Lato`;
    const contentLines = wrapText(tempCtx, letterData.content || '', textBlockWidth);
    currentY += contentLines.length * 44;
    currentY += 60;
    
    tempCtx.font = `italic 28px "Playfair Display"`;
    currentY += 40;
    const canvasHeight = currentY + padding;

    const finalCanvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = finalCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    currentY = padding;

    ctx.font = `700 48px "Playfair Display"`;
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    for (const line of titleLines) {
        ctx.fillText(line, canvasWidth / 2, currentY);
        currentY += 60;
    }
    currentY += 60;

    ctx.font = `${fontSize}px Lato`;
    ctx.fillStyle = '#444';
    ctx.textAlign = 'left';
    for (const line of contentLines) {
        ctx.fillText(line, padding, currentY);
        currentY += 44;
    }
    currentY += 60;

    ctx.font = `italic 28px "Playfair Display"`;
    ctx.fillStyle = '#555';
    const authorText = `- ${letterData.authorName || ''}`;
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
        if (word === '\n') { lines.push(currentLine); currentLine = ''; continue; }
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

/**
 * FINAL STABLE VERSION of the FFmpeg command.
 * It forces both images to the correct width before combining them.
 */
async function composeVideo(headerImage, bodyImage, audioDuration, headerPath, bodyPath, audioPath, outputPath) {
    const videoWidth = 1280;
    const videoHeight = 720;
    
    // Calculate the final height of the header after it's been scaled to 1280px wide
    const scaledHeaderHeight = Math.round(videoWidth * (headerImage.height / headerImage.width));
    const totalImageHeight = scaledHeaderHeight + bodyImage.height; 
    const scrollHeight = Math.max(0, totalImageHeight - videoHeight);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(headerPath)
            .input(bodyPath)
            .input(audioPath)
            .complexFilter([
                // Take header [0:v], scale it to 1280 wide (maintaining aspect ratio), and name it [header]
                `[0:v]scale=${videoWidth}:-1[header]`,
                // Take body [1:v], pad it to 1280 wide, and name it [body]
                `[1:v]pad=width=${videoWidth}:height=ih:x=(ow-iw)/2:y=0:color=white[body]`,
                // Stack the correctly sized header and body
                `[header][body]vstack=inputs=2[letter]`,
                // Create the background and overlay the scrolling letter
                `color=s=${videoWidth}x${videoHeight}:c=white[bg]`,
                `[bg][letter]overlay=x=0:y='-t/${audioDuration}*${scrollHeight}'[out]`
            ])
            .outputOptions(['-map', '[out]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'])
            .duration(audioDuration)
            .on('end', resolve)
            .on('error', (err, stdout, stderr) => {
                console.error('--- FFMPEG STDERR ---', stderr);
                reject(new Error(`FFMPEG failed: ${err.message}`));
            })
            .save(outputPath);
    });
}


// --- SERVER INITIALIZATION ---
async function startServer() {
    console.log('Initializing persistent browser instance...');
    try {
        browserInstance = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log('✅ Browser initialized successfully.');
        
        const PORT = process.env.PORT || 8080;
        app.listen(PORT, () => {
            console.log(`🚀 Media Generation API is running on port ${PORT}`);
        });
    } catch (err) {
        console.error('❌ Failed to launch browser:', err);
        process.exit(1);
    }
}

startServer();