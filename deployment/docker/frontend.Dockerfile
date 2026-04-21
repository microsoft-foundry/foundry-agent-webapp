# Stage 1: Build React Frontend
FROM node:22-alpine AS frontend-builder

# Build arguments for environment variables (required at build time)
ARG ENTRA_SPA_CLIENT_ID
ARG ENTRA_TENANT_ID
ARG ENTRA_BACKEND_CLIENT_ID=""
ARG APPLICATIONINSIGHTS_FRONTEND_CONNECTION_STRING=""

WORKDIR /app/frontend

# Copy all frontend files (includes package.json, .npmrc if present, and source)
COPY frontend/ ./

# Install dependencies (respects .npmrc for custom registries if present)
RUN npm ci

# Remove ALL local environment files to prevent localhost config from being used
RUN rm -f .env.local .env.development .env

# Set environment variables for Vite build
ENV NODE_ENV=production
ENV VITE_ENTRA_SPA_CLIENT_ID=$ENTRA_SPA_CLIENT_ID
ENV VITE_ENTRA_TENANT_ID=$ENTRA_TENANT_ID
ENV VITE_ENTRA_BACKEND_CLIENT_ID=$ENTRA_BACKEND_CLIENT_ID
ENV VITE_APPLICATIONINSIGHTS_CONNECTION_STRING=$APPLICATIONINSIGHTS_FRONTEND_CONNECTION_STRING
# Don't set VITE_API_URL - will default to "/api" (same origin)

# Build the frontend
RUN npm run build

# Stage 2: Build .NET API Backend
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend-builder

WORKDIR /app

# Copy solution and project files
COPY backend/WebApp.sln ./
COPY backend/WebApp.Api/WebApp.Api.csproj ./backend/WebApp.Api/
COPY backend/WebApp.ServiceDefaults/WebApp.ServiceDefaults.csproj ./backend/WebApp.ServiceDefaults/

# Restore dependencies
RUN dotnet restore backend/WebApp.Api/WebApp.Api.csproj

# Copy source code
COPY backend/ ./backend/

# Build and publish
RUN dotnet publish backend/WebApp.Api/WebApp.Api.csproj -c Release -o /app/publish

# Stage 3: Runtime - .NET API serving both backend and frontend static files
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine

WORKDIR /app

# Copy published .NET API
COPY --from=backend-builder /app/publish ./

# Copy built React frontend into wwwroot (ASP.NET static files directory)
COPY --from=frontend-builder /app/frontend/dist ./wwwroot

# Expose port
EXPOSE 8080

# Set environment variables
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production

# Run as non-root user (built-in 'app' user in ASP.NET alpine images)
USER app

# Start the .NET API (which will also serve frontend static files from wwwroot)
ENTRYPOINT ["dotnet", "WebApp.Api.dll"]
