import fs from 'fs/promises';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, registerFont, loadImage } from 'canvas';

// --- FFMPEG SETUP ---
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

// --- CONFIGURATION ---
const FONT_PATH = path.join(process.cwd(), 'test-data', 'Lato-Regular.ttf');
const TEMPLATE_SVG_PATH = path.join(process.cwd(), 'test-data', 'template.svg');
const AUDIO_PATH = path.join(process.cwd(), 'test-data', 'test.mp3');

const TEMP_HEADER_IMAGE_PATH = 'header-from-svg.png';
const TEMP_BODY_IMAGE_PATH = 'body-from-canvas.png';
const OUTPUT_VIDEO_PATH = 'fast_output.mp4';

const LETTER_TEXT = "This is a much faster method. By using node-canvas, we avoid launching a slow and heavy browser instance entirely. The process involves rendering text directly onto an image buffer, which is orders of magnitude more efficient than taking a screenshot with Puppeteer. This approach significantly reduces CPU and memory usage, allowing the entire video generation to complete in seconds rather than minutes. It's the key to making the service both cheap to run and incredibly responsive for users, even with very long letters.\n\nThis new paragraph demonstrates how line breaks are handled. Each new paragraph will be rendered correctly, preserving the structure of the original letter content. This makes the final output look professional and well-formatted without the overhead of HTML and CSS rendering. This is the professional way to handle programmatic video generation for text-based content, ensuring both speed and scalability for the application.This is a much faster method. By using node-canvas, we avoid launching a slow and heavy browser instance entirely. The process involves rendering text directly onto an image buffer, which is orders of magnitude more efficient than taking a screenshot with Puppeteer. This approach significantly reduces CPU and memory usage, allowing the entire video generation to complete in seconds rather than minutes. It's the key to making the service both cheap to run and incredibly responsive for users, even with very long letters.\n\nThis new paragraph demonstrates how line breaks are handled. Each new paragraph will be rendered correctly, preserving the structure of the original letter content. This makes the final output look professional and well-formatted without the overhead of HTML and CSS rendering. This is the professional way to handle programmatic video generation for text-based content, ensuring both speed and scalability for the application.";



// --- HELPER FUNCTIONS ---

/**
 * UPDATED: Calculates the correct aspect ratio for the SVG.
 */
async function renderSvgToPng() {
    const svgBuffer = await fs.readFile(TEMPLATE_SVG_PATH);
    const image = await loadImage(svgBuffer);

    // Calculate the correct height to maintain the aspect ratio for a 1280px width
    const aspectRatio = image.width / image.height;
    const targetWidth = 1280;
    const targetHeight = Math.round(targetWidth / aspectRatio);

    const canvas = createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    
    const pngBuffer = canvas.toBuffer('image/png');
    await fs.writeFile(TEMP_HEADER_IMAGE_PATH, pngBuffer);
    console.log(`[CANVAS] Header image saved with correct dimensions: ${targetWidth}x${targetHeight}`);
    return { width: targetWidth, height: targetHeight };
}

async function renderTextToImage() {
    registerFont(FONT_PATH, { family: 'Lato' });
    const textBlockWidth = 800;
    const canvasWidth = 800;
    const fontSize = 24; const lineHeight = 36;
    const canvas = createCanvas(canvasWidth, 1);
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontSize}px Lato`;
    const words = LETTER_TEXT.split(' ');
    let line = ''; const lines = [];
    for (const word of words) {
        const newParagraphs = word.split('\n');
        for (let i = 0; i < newParagraphs.length; i++) {
            const part = newParagraphs[i];
            const testLine = line + (line ? ' ' : '') + part;
            if (ctx.measureText(testLine).width > textBlockWidth && line !== '') { lines.push(line); line = part; } else { line = testLine; }
            if (i < newParagraphs.length - 1) { lines.push(line); line = ''; }
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
    await fs.writeFile(TEMP_BODY_IMAGE_PATH, buffer);
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

/**
 * UPDATED: Uses the dynamic header height.
 */
async function composeVideo(headerImage, bodyImage, audioDuration) {
    const videoWidth = 1280;
    const videoHeight = 720;
    const headerHeight = headerImage.height; // Use the actual calculated height
    const totalImageHeight = headerHeight + bodyImage.height;
    const scrollHeight = Math.max(0, totalImageHeight - videoHeight);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(TEMP_HEADER_IMAGE_PATH)
            .input(TEMP_BODY_IMAGE_PATH)
            .input(AUDIO_PATH)
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
            .save(OUTPUT_VIDEO_PATH);
    });
}

// --- MAIN EXECUTION ---
async function main() {
    try {
        console.log('--- Starting Fast Video Generation Test ---');
        const headerImage = await renderSvgToPng();
        const bodyImage = await renderTextToImage();
        const audioDuration = await getAudioDuration(AUDIO_PATH);
        await composeVideo(headerImage, bodyImage, audioDuration);
        console.log(`--- ✅ Test Complete! Video saved to ${OUTPUT_VIDEO_PATH} ---`);
    } catch (err) {
        console.error('--- ❌ An error occurred ---', err);
    }
}

main();