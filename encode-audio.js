import fs from 'fs';
import path from 'path';

// --- Configuration ---
const inputAudioFile = 'test.mp3'; // The name of your audio file in the test-data folder
const outputTextFile = 'audio_base64.txt'; // The name of the file where the string will be saved
// -------------------

try {
    const audioPath = path.join(process.cwd(), 'test-data', inputAudioFile);
    const audioBuffer = fs.readFileSync(audioPath);
    const base64String = audioBuffer.toString('base64');

    fs.writeFileSync(outputTextFile, base64String);

    console.log(`✅ Success! The Base64 string has been saved to ${outputTextFile}`);
    console.log('You can now open that file and copy the full string for your Postman test.');

} catch (error) {
    if (error.code === 'ENOENT') {
        console.error(`❌ Error: Could not find the audio file at '${error.path}'.`);
        console.error(`Please make sure '${inputAudioFile}' exists inside the 'test-data' folder.`);
    } else {
        console.error('An unexpected error occurred:', error);
    }
}