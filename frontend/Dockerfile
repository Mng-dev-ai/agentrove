FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

COPY . .

# Expose the port
EXPOSE 3000

# Command to run dev server with auto-reload
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]