import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';

// --- CONFIGURATION ---
const VM_IP_ADDRESS = '20.57.133.60'; 
// --------------------

const API_BASE_URL = `http://${VM_IP_ADDRESS}:8080`;
const AUDIO_PATH = path.join(process.cwd(), 'test-data', 'test.mp3');

async function main() {
    console.log('--- Starting Full API Test (Without Template) ---');

    // --- 1. Prepare the Data Payload ---
    const audioBuffer = await fs.readFile(AUDIO_PATH);
    const letterData = {
        title: "A Letter Without a Template",
        content: "This is a test to ensure that the API can generate a letter and video correctly when no template is provided.",
        authorName: "The Developer",
        // The templateId line is removed to test the no-template case
        // templateId: "4", 
        audioBufferBase64: audioBuffer.toString('base64')
    };

    // --- 2. Test PDF Generation ---
    try {
        console.log(`\n[PDF TEST] Sending request to ${API_BASE_URL}/generate-pdf...`);
        const pdfResponse = await axios.post(`${API_BASE_URL}/generate-pdf`, letterData, {
            responseType: 'arraybuffer'
        });
        await fs.writeFile('final_output_no_template.pdf', pdfResponse.data);
        console.log('✅ [PDF TEST] Success! PDF saved to final_output_no_template.pdf');
    } catch (error) {
        console.error('❌ [PDF TEST] FAILED:', error.message);
    }

    // --- 3. Test Video Generation ---
    try {
        console.log(`\n[VIDEO TEST] Sending request to ${API_BASE_URL}/generate-video...`);
        const videoResponse = await axios.post(`${API_BASE_URL}/generate-video`, letterData, {
            responseType: 'arraybuffer'
        });
        await fs.writeFile('final_output_no_template.mp4', videoResponse.data);
        console.log('✅ [VIDEO TEST] Success! Video saved to final_output_no_template.mp4');
    } catch (error) {
        console.error('❌ [VIDEO TEST] FAILED:', error.message);
    }

    console.log('\n--- Test Complete ---');
}

main();