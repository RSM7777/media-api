import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, registerFont, loadImage } from 'canvas';
import { htmlToText } from 'html-to-text';
import puppeteer from 'puppeteer-core'; // We need puppeteer back for this one task


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

    // Use the new, fast canvas method for BOTH images
    const headerImage = await renderSvgToPng(templateSvgPath, headerPath);
    const bodyImage = await renderTextToImage(letterData, bodyPath);
    const audioDuration = await getAudioDuration(audioPath);
    
    await composeVideo(headerImage, bodyImage, audioDuration, headerPath, bodyPath, audioPath, videoPath);
    
    return await fs.readFile(videoPath);
}

/**
 * FINAL, CORRECTED VERSION: Renders the SVG at high resolution for perfect quality.
 */
async function renderSvgToPng_Puppeteer(svgPath, outputPath) {
    console.log('[PUPPETEER] Rendering SVG to PNG for perfect quality...');
    let browser = null;
    try {
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        // Set the browser viewport to the final video width
        await page.setViewport({ width: 1280, height: 720 });

        const svgContent = await fs.readFile(svgPath, 'utf-8');
        
        // Set page content with CSS to make the SVG fill the width
        await page.setContent(`
            <html>
              <head>
                <style>
                  body, html { margin: 0; padding: 0; }
                  svg { width: 100%; height: auto; display: block; }
                </style>
              </head>
              <body>${svgContent}</body>
            </html>
        `);
        
        const svgElement = await page.$('svg');
        if (!svgElement) throw new Error('SVG element not found in template file.');

        await svgElement.screenshot({ path: outputPath });
        
        console.log(`[PUPPETEER] High-quality header image saved successfully.`);
        return await getImageDimensions(outputPath);
    } finally {
        if (browser) await browser.close();
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

// --- HELPER FUNCTIONS ---

function extractSvgBase64(html) {
    const match = html.match(/src='data:image\/svg\+xml;base64,([^']*)'/);
    if (!match || !match[1]) {
        throw new Error('Could not find or parse SVG data URI in HTML content.');
    }
    return match[1];
}

/**
 * FINAL VERSION: Renders SVG to PNG at high quality WITHOUT Puppeteer.
 */
async function renderSvgToPng(svgPath, outputPath) {
    console.log('[CANVAS] Rendering SVG to PNG with correct aspect ratio...');
    const svgContent = await fs.readFile(svgPath, 'utf-8');
    
    // Manually parse width/height from the SVG tag to get the correct aspect ratio
    const widthMatch = svgContent.match(/width="(\d+)"/);
    const heightMatch = svgContent.match(/height="(\d+)"/);
    if (!widthMatch || !heightMatch) {
        throw new Error('SVG file must have explicit width and height attributes.');
    }
    const width = parseInt(widthMatch[1], 10);
    const height = parseInt(heightMatch[1], 10);
    const aspectRatio = width / height;

    // Render it to a high-quality PNG
    const targetWidth = 1280;
    const targetHeight = Math.round(targetWidth / aspectRatio);

    const image = await loadImage(Buffer.from(svgContent));
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
    const videoWidth = 1280;
    const videoHeight = 720;
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
            .outputOptions([
                '-map', '[out]',
                '-map', '2:a',
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', '23',
                // CORRECTED LINE
                '-pix_fmt', 'yuv420p'
            ])
            .duration(audioDuration)
            .toFormat('mp4')
            .on('end', resolve)
            .on('error', (err, stdout, stderr) => {
                console.error('--- FFMPEG STDERR ---', stderr);
                reject(new Error(`FFMPEG failed: ${err.message}`));
            })
            .save(outputPath);
    });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Media Generation API is running on port ${PORT}`);
});