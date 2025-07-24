import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import puppeteer from 'puppeteer-core'; // Changed back to puppeteer-core
import ffmpeg from 'fluent-ffmpeg';

import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

const app = express();
app.use(express.json({ limit: '50mb' }));

// --- API Endpoint for PDF Generation ---
app.post('/generate-pdf', async (req, res) => {
    console.log('[API] Received request for PDF generation.');
    const { htmlContent } = req.body;
    if (!htmlContent) {
        return res.status(400).send({ error: 'htmlContent is required.' });
    }

    let browser = null;
    try {
        // Using the specific path for the Azure environment
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: "new"
        });
        const page = await browser.newPage();
        await page.goto(`data:text/html;charset=UTF-8,${encodeURIComponent(htmlContent)}`, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: "25px", bottom: "25px", left: "25px", right: "25px" } });
        
        console.log('[API] PDF generated successfully.');
        res.setHeader('Content-Type', 'application/pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('[API] PDF generation failed:', error);
        res.status(500).send({ error: 'Failed to generate PDF.' });
    } finally {
        if (browser) await browser.close();
    }
});


// --- SIMPLIFIED API Endpoint for SCROLLING VIDEO Generation ---
app.post('/generate-video', async (req, res) => {
    console.log('[API] Received request for Video generation.');
    const { htmlContent, audioBufferBase64 } = req.body;
    if (!htmlContent || !audioBufferBase64) {
        return res.status(400).send({ error: 'htmlContent and audioBufferBase64 are required.' });
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-gen-'));
    try {
        const audioBuffer = Buffer.from(audioBufferBase64, 'base64');
        const videoBuffer = await generateLetterVideo(audioBuffer, htmlContent, tempDir);
        
        console.log('[API] Video generated successfully.');
        await fs.rm(tempDir, { recursive: true, force: true });
        
        res.setHeader('Content-Type', 'video/mp4');
        res.send(videoBuffer);

    } catch (error) {
        console.error('[API] Video generation failed:', error);
        res.status(500).send({ error: 'Failed to generate video.' });
    }
});


// --- All other helper functions below have NO CHANGES ---

async function generateLetterVideo(audioBuffer, htmlContent, tempDir) {
    const audioPath = path.join(tempDir, 'audio.wav');
    const imagePath = path.join(tempDir, 'letter-image.png');
    const videoPath = path.join(tempDir, 'output.mp4');

    await fs.writeFile(audioPath, audioBuffer);
    const audioDuration = await getAudioDuration(audioPath);
    await createScreenshotFromHtml(htmlContent, imagePath);
    await createScrollingVideo(imagePath, audioPath, videoPath, audioDuration);
    
    return await fs.readFile(videoPath);
}

async function createScreenshotFromHtml(htmlContent, outputPath) {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: "new"
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.goto(`data:text/html;charset=UTF-8,${encodeURIComponent(htmlContent)}`, {
            waitUntil: 'networkidle0',
            timeout: 120000
        });
        await page.screenshot({ path: outputPath, type: 'png', fullPage: true });
    } finally {
        if (browser) await browser.close();
    }
}

async function createScrollingVideo(imagePath, audioPath, outputPath, duration) {
    const imageDimensions = await getImageDimensions(imagePath);
    const videoHeight = 720;
    const videoWidth = 1280;
    const imageHeight = imageDimensions.height;
    const scrollHeight = Math.max(0, imageHeight - videoHeight);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(imagePath).loop()
            .input(audioPath)
            .videoCodec('libx264').audioCodec('aac').audioBitrate('192k')
            .outputOptions(['-preset veryfast', '-crf 23', '-pix_fmt yuv420p'])
            .complexFilter([`color=s=${videoWidth}x${videoHeight}:c=black[bg]; [bg][0:v]overlay=x=(W-w)/2:y='-t/${duration}*${scrollHeight}'[out]`])
            .duration(duration)
            .outputOptions("-map", "[out]", "-map", "1:a")
            .on('end', resolve)
            .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
            .save(outputPath);
    });
}

function getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) return reject(new Error(`ffprobe error: ${err.message}`));
            if (!metadata?.format?.duration) return reject(new Error('Could not determine audio duration.'));
            resolve(metadata.format.duration);
        });
    });
}

function getImageDimensions(imagePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(imagePath, (err, metadata) => {
            if (err || !metadata.streams[0].width || !metadata.streams[0].height) {
                return reject(new Error(`Could not get image dimensions: ${err?.message || 'Unknown error'}`));
            }
            resolve({ width: metadata.streams[0].width, height: metadata.streams[0].height });
        });
    });
}


const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Media Generation API is running on port ${PORT}`);
});