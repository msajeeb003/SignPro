# Frontend Vercel deployment

The frontend lives in `../../frontend/` (the canonical source). This folder only holds Vercel-specific configuration files (`vercel.json`, `.env.production.example`). Vercel will build directly from the main `frontend/` directory.

## Deploy from this folder

```bash
cd vercel/frontend

# 1. Link to a new Vercel project (one-time)
vercel link

# 2. Configure environment
vercel env add VITE_API_URL production
# When prompted, enter your backend URL: https://signpro-api.vercel.app

# 3. Deploy
cd ../../frontend                    # build from the main frontend source
cp ../vercel/frontend/vercel.json .  # copy the Vercel config over
vercel --prod
```

## Alternative: deploy directly from `frontend/` with the Vercel dashboard

1. Push the repo to GitHub (already done).
2. Go to https://vercel.com/new and import `msajeeb003/SignPro`.
3. Set **Root Directory** to `frontend`.
4. **Framework Preset**: Vite.
5. **Build Command**: `npm run build` (auto-detected).
6. **Output Directory**: `dist` (auto-detected).
7. Add environment variable `VITE_API_URL=https://your-api.vercel.app`.
8. Click **Deploy**.
9. After it's live, copy `vercel/frontend/vercel.json` into the `frontend/` directory and redeploy so the security headers and SPA rewrites apply.

## Custom domain

In the Vercel dashboard → Project → Domains, add `app.signpro.example.com`. Vercel auto-provisions SSL.
