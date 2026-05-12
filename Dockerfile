# Use the official Node.js image with Alpine for a smaller footprint
FROM node:22-alpine

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies required for Vite build)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the React frontend using Vite
RUN npm run build

# Expose the port your server listens on (must match PORT in server.ts / Cloud Run defaults)
EXPOSE 3001

# Start the Node backend server
CMD ["npm", "start"]
