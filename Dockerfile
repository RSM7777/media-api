# Start from the official Azure App Service Node.js 20 image
FROM mcr.microsoft.com/appsvc/node:20-lts

# Install system dependencies for Canvas, FFmpeg, and Puppeteer
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    ffmpeg \
    # Add Puppeteer dependencies
    libgbm-dev \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# Download and install Google Chrome
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb

# Set the working directory
WORKDIR /home/site/wwwroot

# Copy and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of your app code
COPY . .

# Command to run the server
CMD ["npm", "start"]