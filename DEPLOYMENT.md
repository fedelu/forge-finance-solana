# 🚀 Deploying Forge Finance to Vercel

This guide explains how to deploy your Forge Finance application to Vercel.

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com) (free account works)
2. **GitHub Repository**: Your code should be pushed to GitHub
3. **Node.js**: Ensure you have Node.js installed locally for testing

## Method 1: Deploy via Vercel Dashboard (Recommended)

This is the easiest method and sets up automatic deployments.

### Step 1: Connect Your Repository

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **"Add New Project"**
3. Import your GitHub repository: `forge-finance-solana`
4. Vercel will automatically detect it's a Next.js project

### Step 2: Configure Project Settings

Vercel will show you the project configuration. Use these settings:

**Framework Preset:** Next.js (auto-detected)

**Root Directory:** `./` (root)

**Build Command:** 
```bash
cp next.config.prod.js next.config.js && npm run build
```

**Output Directory:** `out`

**Install Command:** `npm install`

### Step 3: Set Environment Variables

Add these environment variables in the Vercel dashboard:

```
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_EXPLORER_URL=https://explorer.solana.com
NEXT_PUBLIC_COMMITMENT=confirmed
```

**How to add:**
1. In project settings, go to **"Environment Variables"**
2. Add each variable above
3. Make sure they're set for **Production**, **Preview**, and **Development**

### Step 4: Deploy

1. Click **"Deploy"**
2. Wait for the build to complete (usually 2-5 minutes)
3. Your app will be live at: `https://your-project-name.vercel.app`

### Step 5: Configure Custom Domain (Optional)

1. Go to **Project Settings** → **Domains**
2. Add your custom domain
3. Follow DNS configuration instructions

---

## Method 2: Deploy via Vercel CLI

For more control and automation.

### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

### Step 2: Login to Vercel

```bash
vercel login
```

This will open a browser window for authentication.

### Step 3: Deploy

From your project root directory:

```bash
# First deployment (will ask questions)
vercel

# Production deployment
vercel --prod
```

### Step 4: Set Environment Variables

```bash
vercel env add NEXT_PUBLIC_SOLANA_NETWORK
# Enter: devnet
# Select: Production, Preview, Development

vercel env add NEXT_PUBLIC_RPC_URL
# Enter: https://api.devnet.solana.com
# Select: Production, Preview, Development

vercel env add NEXT_PUBLIC_EXPLORER_URL
# Enter: https://explorer.solana.com
# Select: Production, Preview, Development

vercel env add NEXT_PUBLIC_COMMITMENT
# Enter: confirmed
# Select: Production, Preview, Development
```

---

## Method 3: Using the Deployment Script

A script is already configured in your project:

```bash
# Make script executable (first time only)
chmod +x scripts/deploy-to-vercel.sh

# Run the deployment script
./scripts/deploy-to-vercel.sh
```

This script will:
1. Check prerequisites
2. Install dependencies
3. Configure for production
4. Build the project
5. Deploy to Vercel

---

## Configuration Files

Your project already has the necessary configuration:

### `vercel.json`
- Configures build command
- Sets output directory
- Defines environment variables
- Sets up redirects

### `next.config.prod.js`
- Production Next.js configuration
- Static export mode
- Webpack aliases for Solana packages

---

## Automatic Deployments

Once connected to GitHub:

- **Every push to `main` branch** → Deploys to production
- **Pull requests** → Creates preview deployments
- **Other branches** → Creates preview deployments

---

## Troubleshooting

### Error: routes-manifest.json couldn't be found

**Solution:** This happens when Vercel tries to use Next.js as a serverless framework instead of static export. The `vercel.json` is already configured with `"framework": null` to fix this.

If you still see this error:
1. **In Vercel Dashboard:**
   - Go to Project Settings → General
   - Under "Framework Preset", select **"Other"** or **"Static HTML"**
   - Save and redeploy

2. **Or remove framework detection:**
   - The `vercel.json` already has `"framework": null` which should prevent this

### Build Fails

1. **Check build logs** in Vercel dashboard
2. **Test build locally**:
   ```bash
   cp next.config.prod.js next.config.js
   npm run build
   ```

### Environment Variables Not Working

1. Ensure variables start with `NEXT_PUBLIC_` for client-side access
2. Redeploy after adding new variables
3. Check variable names match exactly (case-sensitive)

### Static Export Issues

- The project uses `output: 'export'` for static hosting
- Some Next.js features (API routes, server-side rendering) won't work
- This is fine for a frontend-only app
- Vercel should detect static export automatically, but if not, set framework to "Other" in dashboard

### Wallet Connection Issues

- Ensure `NEXT_PUBLIC_RPC_URL` points to a public RPC endpoint
- Consider using a paid RPC provider (like Helius, QuickNode) for production
- Devnet RPC is free but has rate limits

---

## Production Checklist

Before deploying to production:

- [ ] Test build locally: `npm run build`
- [ ] Verify environment variables are set
- [ ] Test wallet connection on preview deployment
- [ ] Test deposits and withdrawals
- [ ] Check all pages load correctly
- [ ] Verify images and assets load
- [ ] Test on mobile devices
- [ ] Set up custom domain (optional)
- [ ] Configure analytics (optional)

---

## Useful Commands

```bash
# Test production build locally
cp next.config.prod.js next.config.js
npm run build
npm run start

# Deploy to preview
vercel

# Deploy to production
vercel --prod

# View deployment logs
vercel logs

# List all deployments
vercel ls
```

---

## Post-Deployment

After deployment:

1. **Test the live site** - Verify all features work
2. **Share the URL** - Your app is live!
3. **Monitor** - Check Vercel dashboard for errors
4. **Set up domain** - Add custom domain if needed
5. **Configure analytics** - Enable Vercel Analytics (optional)

---

## Support

- **Vercel Docs**: https://vercel.com/docs
- **Next.js Deployment**: https://nextjs.org/docs/deployment
- **Vercel Dashboard**: https://vercel.com/dashboard

---

**Your app will be live at:** `https://your-project-name.vercel.app`

