# Shafhaven Wish Lists

A gift editor and a separate shopper link. The editor always shows all gifts and receives no purchase status. The shopper view hides purchased gifts. A single conditional database update prevents two shoppers from marking the same gift purchased.

## Local preview

Use Node 24. Run npm install, then npm run dev.
Open http://127.0.0.1:4173/owner with editor key local-editor.
The local shopper link is http://127.0.0.1:4173/shop#key=local-shopper.
Local changes are saved in a local SQLite file. Start with an empty list on the live site.

## Vercel deployment

1. Extract the ZIP, push the project to a GitHub repository, and import it into Vercel. Choose Other and Node 24. The included Vercel config serves the frontend and routes.
2. Connect a Neon Postgres database through the Vercel Marketplace. Set DATABASE_URL to the pooled Postgres connection URL. The database role needs permission to create the gifts table on first use.
3. Set OWNER_KEY and SHOPPER_KEY to two distinct random secrets and deploy. For each secret, run: node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
4. Bookmark /owner and sign in with OWNER_KEY. Add your gifts. Use Copy shopper link with SHOPPER_KEY and send that URL to family. Shoppers need only the link.

Photos are optional and accept JPEG, PNG, and WebP. The browser resizes and compresses photos before saving. Purchase marks are final in this version. Anyone who opens the full shopper link can see available gifts and mark purchases, including you. Keep the shopper link out of your bookmarks if you want to preserve the surprise.
