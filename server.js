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
    console.log('[API] Received request for /generate-video.');
    const { htmlContent, audioBufferBase64 } = req.body;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-gen-'));
    console.log(`[API LOG] Created temp directory: ${tempDir}`);
    try {
        const audioBuffer = Buffer.from(audioBufferBase64, 'base64');
        const videoBuffer = await generateLetterVideo(audioBuffer, htmlContent, tempDir);
        console.log('[API LOG] Video buffer received. Sending response.');
        res.setHeader('Content-Type', 'video/mp4');
        res.send(videoBuffer);
    } catch (error) {
        console.error('[API] Video generation failed:', error);
        res.status(500).send({ error: 'Failed to generate video.' });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log(`[API LOG] Cleaned up temp directory: ${tempDir}`);
    }
});


// --- All other helper functions below have NO CHANGES ---

async function generateLetterVideo(audioBuffer, htmlContent, tempDir) {
    const audioPath = path.join(tempDir, 'audio.wav');
    const headerPath = path.join(tempDir, 'header.png');
    const bodyPath = path.join(tempDir, 'body.png');
    const videoPath = path.join(tempDir, 'output.mp4');

    console.log('[API LOG] Writing audio buffer to file...');
    await fs.writeFile(audioPath, audioBuffer);
    console.log('[API LOG] Getting audio duration...');
    const audioDuration = await getAudioDuration(audioPath);
    console.log(`[API LOG] Audio duration is ${audioDuration} seconds.`);
    
    console.log('[API LOG] Starting image component generation...');
    await createImageComponents(htmlContent, headerPath, bodyPath);
    console.log('[API LOG] Finished image component generation.');

    console.log('[API LOG] Starting optimized video creation...');
    await createOptimizedScrollingVideo(headerPath, bodyPath, audioPath, videoPath, audioDuration);
    console.log('[API LOG] Finished optimized video creation.');
    
    console.log('[API LOG] Reading final video file into buffer...');
    return await fs.readFile(videoPath);
}

async function createImageComponents(htmlContent, headerPath, bodyPath) {
    console.log('[PUPPETEER] Launching browser...');
    let browser = null;
    try {
        browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox'], headless: "new" });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 1080 }); 
        await page.goto(`data:text/html;charset=UTF-8,${encodeURIComponent(htmlContent)}`, { waitUntil: 'networkidle0' });
        console.log('[PUPPETEER] Page content loaded.');

        const headerElement = await page.$('.template-image');
        if (headerElement) {
            await headerElement.screenshot({ path: headerPath });
            console.log(`[PUPPETEER] Header screenshot saved to ${headerPath}`);
        } else {
            throw new Error('Could not find header element with class "template-image"');
        }

        const bodyElement = await page.$('.content');
        if (bodyElement) {
            await bodyElement.screenshot({ path: bodyPath });
            console.log(`[PUPPETEER] Body screenshot saved to ${bodyPath}`);
        } else {
            throw new Error('Could not find content element with class "content"');
        }
    } finally {
        if (browser) await browser.close();
        console.log('[PUPPETEER] Browser closed.');
    }
}


async function createOptimizedScrollingVideo(headerPath, bodyPath, audioPath, outputPath, duration) {
    console.log('[FFMPEG] Calculating video dimensions...');
    const bodyDimensions = await getImageDimensions(bodyPath);
    
    const videoWidth = 1280;
    const videoHeight = 720;
    const headerHeight = 200;
    const bodyScrollHeight = Math.max(0, bodyDimensions.height - (videoHeight - headerHeight));
    console.log(`[FFMPEG] Body scroll height calculated: ${bodyScrollHeight}px`);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(headerPath)
            .input(bodyPath)
            .input(audioPath)
            .complexFilter([
                `color=s=${videoWidth}x${videoHeight}:c=black[canvas]`,
                `[canvas][0:v]overlay=x=0:y=0[with_header]`,
                `[with_header][1:v]overlay=x=(W-w)/2:y='${headerHeight} - (t/${duration})*${bodyScrollHeight}'`
            ])
            .outputOptions([
                '-map', '2:a',
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', '23',
                '-pix_fmt', 'yuv420p'
            ])
            .duration(duration)
            .on('start', (commandLine) => {
                console.log(`[FFMPEG] Started processing with command: ${commandLine}`);
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    console.log(`[FFMPEG] Encoding progress: ${progress.percent.toFixed(2)}%`);
                }
            })
            .on('end', resolve)
            .on('error', (err) => reject(new Error(`Optimized FFmpeg error: ${err.message}`)))
            .save(outputPath);
    });
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