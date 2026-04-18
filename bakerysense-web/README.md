# OpenNext Starter

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Read the documentation at https://opennext.js.org/cloudflare.

## Develop

Run the Next.js development server:

```bash
npm run dev
# or similar package manager command
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Preview

Preview the application locally on the Cloudflare runtime:

```bash
npm run preview
# or similar package manager command
```

## Deploy

Deploy the application to Cloudflare:

```bash
npm run deploy
# or similar package manager command
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Environment & Secrets

### Local Development

Local development uses `.dev.vars` (automatically loaded by `wrangler dev`). This file contains:

- `SESSION_SIGNING_KEY`: Random 32-byte base64 key for JWT session signing
- `JWKS_ENCRYPTION_KEY`: Random 32-byte base64 key for JWKS encryption
- `CONNECTOR_MEK`: Random 32-byte base64 key for connector encryption
- `OPS_ROTATE_SECRET`: Random 32-byte base64 key for operations rotation
- `OPENROUTER_API_KEY`: Placeholder for local testing (update with real key for AI features)
- `OPENROUTER_OAUTH_CLIENT_ID`: Placeholder for local testing

`.dev.vars` is gitignored and should never be committed to version control.

### Production Deployment

Before deploying to production, set all secrets using `wrangler secret put`:

```bash
wrangler secret put SESSION_SIGNING_KEY
wrangler secret put JWKS_ENCRYPTION_KEY
wrangler secret put CONNECTOR_MEK
wrangler secret put OPS_ROTATE_SECRET
wrangler secret put OPENROUTER_API_KEY
wrangler secret put OPENROUTER_OAUTH_CLIENT_ID
```

The same secrets must be available in production for the application to function correctly.
