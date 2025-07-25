# Start from the official Azure App Service Node.js 20 image
FROM mcr.microsoft.com/appsvc/node:20-lts

# Install all system dependencies ONCE during the build
# This is the slow part that will now happen before deployment
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /home/site/wwwroot

# Copy package files and install Node.js dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of your application code (server.js, fonts folder, etc.)
COPY . .

# The command that will run when the container starts
CMD ["npm", "start"]