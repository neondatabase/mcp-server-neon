
# Use the imbios/bun-node image as the base image with Node and Bun
# Keep bun and node version in sync with package.json
ARG NODE_VERSION=22.0.0
ARG BUN_VERSION=1.2.13
FROM imbios/bun-node:1.2.13-22-slim AS base

LABEL fly_launch_runtime="Node.js"

# Set the working directory in the container
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"

# Throw-away build stage to reduce size of final image
FROM base As builder

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install the root dependencies and devDependencies
RUN npm install

# Copy landing package.json and package-lock.json
COPY landing/package.json landing/package-lock.json ./landing/

# Install the landing dependencies and devDependencies
RUN cd landing && npm install --include dev

# Copy the entire project to the working directory
COPY . .

# Install the dependencies and devDependencies
RUN npm ci --include=dev

# Build the project
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev

# We don't need Next.js dependencies since landing is statically exported during build step.
RUN rm -rf landing/node_modules

# Final stage for app image
FROM base

# Copy built application
COPY --from=builder /app /app


# Define environment variables
ENV NODE_ENV=production

EXPOSE 3001
# Specify the command to run the MCP server
CMD ["node", "dist/index.js", "start:sse"]
