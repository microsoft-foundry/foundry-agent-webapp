# Mazhar AI Web App

A simple, clean AI chat interface. No enterprise patterns. No microservices. Just Node.js + React + OpenAI.

## What This Is

A straightforward web app where you type messages and get AI responses. That's it.

**Stack:**
- Backend: Node.js + Express
- Frontend: React + Vite
- AI: OpenAI API (gpt-4o-mini)
- Deploy: Azure App Service (Free tier)

## Prerequisites

- **Node.js 18+** - https://nodejs.org
- **OpenAI API Key** - https://platform.openai.com/api-keys
- **Azure Account** (for deployment) - https://azure.microsoft.com/free

That's it. No PowerShell. No Docker. No .NET. No azd.

## Local Development

### 1. Set up the backend

```bash
cd server
npm install
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:
```
OPENAI_API_KEY=sk-your-key-here
PORT=3000
NODE_ENV=development
```

### 2. Set up the frontend

```bash
cd ../client
npm install
```

### 3. Run both (use two terminals)

Terminal 1 (backend):
```bash
cd server
npm run dev
```

Terminal 2 (frontend):
```bash
cd client
npm run dev
```

Open http://localhost:5173

## Deploy to Azure App Service (Free Tier)

### Option 1: Via Azure Portal (Easiest)

1. **Create App Service**
   - Go to https://portal.azure.com
   - Click "Create a resource" → "Web App"
   - Fill in:
     - Name: `mazhar-ai-webapp` (or whatever you want)
     - Runtime: **Node 18 LTS**
     - Operating System: **Linux**
     - Region: Pick one close to you
     - Pricing: **Free F1**
   - Click "Review + Create"

2. **Build the frontend**
   ```bash
   cd client
   npm run build
   ```

3. **Prepare for deployment**
   ```bash
   # Copy built frontend into server's public directory
   cp -r client/dist server/public
   ```

4. **Configure Deployment**
   - In Azure Portal, go to your App Service
   - Click "Deployment Center" → "GitHub" (or "Local Git")
   - Connect your repo: `Mazmansoor/mazhar-ai-webapp`
   - Branch: `claude/nodejs-azure-rebuild-eYJFf`
   - Build: **App Service build service**
   - Set startup command: `cd server && npm install && npm start`

5. **Add Environment Variables**
   - In App Service, go to "Configuration" → "Application settings"
   - Add:
     - `OPENAI_API_KEY` = your-key-here
     - `NODE_ENV` = production
     - `PORT` = 8080 (Azure default)

6. **Deploy**
   - Push to your branch and Azure will auto-deploy
   - Or use "Deployment Center" → "Sync" to trigger manual deploy

### Option 2: Via Azure CLI

```bash
# Login
az login

# Create resource group
az group create --name mazhar-ai-rg --location eastus

# Create App Service plan (Free tier)
az appservice plan create \
  --name mazhar-ai-plan \
  --resource-group mazhar-ai-rg \
  --sku F1 \
  --is-linux

# Create web app
az webapp create \
  --name mazhar-ai-webapp \
  --resource-group mazhar-ai-rg \
  --plan mazhar-ai-plan \
  --runtime "NODE:18-lts"

# Configure app settings
az webapp config appsettings set \
  --name mazhar-ai-webapp \
  --resource-group mazhar-ai-rg \
  --settings \
    OPENAI_API_KEY="your-key-here" \
    NODE_ENV="production" \
    PORT="8080"

# Set startup command
az webapp config set \
  --name mazhar-ai-webapp \
  --resource-group mazhar-ai-rg \
  --startup-file "cd server && npm install && npm start"

# Deploy from GitHub
az webapp deployment source config \
  --name mazhar-ai-webapp \
  --resource-group mazhar-ai-rg \
  --repo-url https://github.com/Mazmansoor/mazhar-ai-webapp \
  --branch claude/nodejs-azure-rebuild-eYJFf \
  --manual-integration
```

Your app will be at: `https://mazhar-ai-webapp.azurewebsites.net`

## Project Structure

```
mazhar-ai-webapp/
├── server/              # Node.js backend
│   ├── index.js         # Express server
│   ├── package.json
│   └── .env.example
├── client/              # React frontend
│   ├── src/
│   │   ├── App.jsx      # Main UI
│   │   ├── App.css      # Styles
│   │   └── main.jsx     # Entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── .gitignore
└── README.md
```

## How It Works

1. User types message in React UI
2. React sends `POST /api/chat` with `{message: "..."}`
3. Express server calls OpenAI API
4. Server returns `{reply: "..."}`
5. React displays response

No databases. No auth. No sessions. No websockets. Just HTTP and state in React.

## Later (Not Today)

Once this works and you have mental peace:
- Add Azure OpenAI instead of OpenAI API
- Add authentication (MSAL)
- Add conversation history (database)
- Add streaming responses
- Add multi-agent patterns

But not yet. First, get this boring version working.

## Troubleshooting

**"Cannot find module 'express'"**
- Run `npm install` in the server directory

**"API key not configured"**
- Make sure `.env` file exists in server directory
- Make sure `OPENAI_API_KEY` is set

**Frontend can't reach backend locally**
- Backend should be on port 3000
- Vite proxy is configured to forward `/api/*` to `http://localhost:3000`

**Azure deployment fails**
- Check Application Insights / Log stream in Azure Portal
- Common issue: forgot to set `OPENAI_API_KEY` in App Service configuration

## License

Do whatever you want with this. It's too simple to license.
