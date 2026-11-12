# Shafhaven Wish Lists

Each person can create a password-protected wish list with a unique shopper link. The editor always shows all gifts and receives no purchase status. The shopper view hides purchased gifts. A single conditional database update prevents two shoppers from marking the same gift purchased.

## Local preview

Use Node 24. Run npm install, then npm run dev.
Open http://127.0.0.1:4173/owner and choose Create a list. Use a unique username, a list name, and a password of at least 10 characters. Sign in with that username and password on later visits. The home page also opens the editor.

To open pre-existing local gifts, choose Use existing editor key and enter local-editor.
The local shopper link is http://127.0.0.1:4173/shop#key=local-shopper.
Local changes are saved in a local SQLite file. Start with an empty list on the live site.

## Vercel deployment

1. Extract the ZIP, push the project to a GitHub repository, and import it into Vercel. Choose Other and Node 24. The included Vercel config serves the frontend and routes.
2. Connect a Neon Postgres database through the Vercel Marketplace. Set DATABASE_URL to the pooled Postgres connection URL. The database role needs permission to create the gifts table on first use.
3. Deploy. New personal lists do not require shared environment keys. To retain access to an existing list, keep OWNER_KEY and SHOPPER_KEY set to their existing distinct secrets. For a new legacy list, set two distinct random secrets. For each secret, run: node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
4. Bookmark /owner, choose Create a list, and add your gifts. Copy shopper link automatically copies the unique link for the signed-in list. Send that full URL to family; shoppers need only the link. Sign out to switch to another person’s list.

The database initializes lists and sessions and adds a list_id column to gifts automatically. The database role needs CREATE TABLE and ALTER TABLE permission. Existing gifts and purchase marks remain on the legacy list and existing links keep working. New accounts start with an empty, separate list. Back up the database before deploying schema changes.

Passwords are salted and hashed with scrypt; sessions expire after seven days and are revoked on sign-out. Five incorrect password attempts temporarily lock an account for 15 minutes. There is no password recovery interface yet, so save your credentials. Serve the deployed app over HTTPS.

Run npm test for database-backed checks of list isolation, authentication, purchase privacy, and legacy access.

Photos are optional and accept JPEG, PNG, and WebP. The browser resizes and compresses photos before saving. Purchase marks are final in this version. Anyone who opens the full shopper link can see available gifts and mark purchases, including you. Keep the shopper link out of your bookmarks if you want to preserve the surprise.
