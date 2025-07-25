#!/bin/bash

echo "--- INSTALLING SYSTEM DEPENDENCIES FOR CANVAS & FFMPEG ---"
apt-get update
# Added dependencies for node-canvas
apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# Dependencies for Puppeteer/Chrome and FFmpeg
apt-get install -y ffmpeg wget ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libcups2 libgdk-pixbuf2.0-0 libnspr4 libnss3 libxrandr2 xdg-utils libgbm-dev

echo "--- INSTALLING GOOGLE CHROME ---"
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y ./google-chrome-stable_current_amd64.deb
rm google-chrome-stable_current_amd64.deb

echo "--- STARTING NODE APP ---"
npm start