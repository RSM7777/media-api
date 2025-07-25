import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';



const API_URL = 'http://20.57.133.60:8080/generate-video';
const AUDIO_PATH = path.join(process.cwd(), 'test-data', 'test.mp3');
const OUTPUT_VIDEO_PATH = 'final_output.mp4';

async function main() {
    try {
        console.log('--- Starting Final Local Test ---');
        
        const audioBuffer = await fs.readFile(AUDIO_PATH);

        // This is the simple JSON payload we send now
        const payload = {
            title: "A Letter to a Friend",
            content: "If you're reading this letter, it means you've reached a moment in life where words, memories, and meaning matter. Maybe you're sitting by a window watching the rain fall. Maybe it's 2 AM and the world is asleep, but your mind is wide awake, searching for something real. Whatever the case—I'm glad you're here.\n\nLet's go back for a moment. Remember the days when everything felt new? The world was a canvas, and we were the artists. We painted our dreams with bold strokes, unafraid of making mistakes.",
            authorName: "Someone Who Cares",
            templateId: "1", // This would match a template on the server
            audioBufferBase64: audioBuffer.toString('base64')
        };

        console.log(`Sending request to ${API_URL}...`);
        const response = await axios.post(API_URL, payload, {
            responseType: 'arraybuffer'
        });

        await fs.writeFile(OUTPUT_VIDEO_PATH, response.data);
        console.log(`--- ✅ Test Complete! Video saved to ${OUTPUT_VIDEO_PATH} ---`);

    } catch (error) {
        console.error('--- ❌ Test Failed ---', error.message);
    }
}

main();