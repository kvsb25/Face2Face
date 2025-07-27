# Use the official Node.js runtime as a base image
FROM node:20

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install application dependencies
RUN npm install --production --silent

# Copy the rest of the application files
COPY . .

# Command to run the application
CMD ["./start.sh"]