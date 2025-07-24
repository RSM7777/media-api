import fs from 'fs';

const audioBuffer = fs.readFileSync('./test.mp3');
const base64String = audioBuffer.toString('base64');

console.log("--- COPY THE ENTIRE STRING BELOW ---");
console.log(base64String);