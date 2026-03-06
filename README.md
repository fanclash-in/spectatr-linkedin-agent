# Spectatr.ai LinkedIn Ad Intelligence Agent

Daily AI-powered LinkedIn ad analysis. Runs at 06:00 UTC via GitHub Actions. Dashboard lives on GitHub Pages, updated automatically after every agent run.

## Live Dashboard

https://uday864.github.io/spectatr-linkedin-agent/

## How It Works

1. GitHub Actions triggers agent at 06:00 UTC
2. Claude fetches LinkedIn data → analyses → generates suggestions, copy variants, new audiences
3. Writes results to `dashboard/data/*.json`
4. Commits back → GitHub Pages auto-deploys fresh dashboard

## Manual Run

```bash
gh workflow run daily-analysis.yml
```

## Local Dev

```bash
cp .env.example .env   # add your keys
npm install && npm run dev
```

## Update Brand Context

Edit `CLAUDE.md` and push — the agent picks up changes on next run.
