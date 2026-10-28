# Team OKR Tracker

A standalone web app for annual OKRs, manager approvals, the weekly rhythm (standup, achievements, priorities, Friday review) and a weekly leaderboard.

- Front end: Vite, plain JavaScript (`src/`)
- Accounts, database and live updates: Supabase (Auth, Postgres, Realtime)
- Roles are enforced by the database (row-level security and the functions in `supabase/schema.sql`), not only by the interface
- Hosting: Vercel, or any static host

## 1. Create the Supabase project

1. Create a project at https://supabase.com.
2. Open **SQL Editor**, paste all of `supabase/schema.sql` and run it. It is safe to run again.
3. Open **Authentication > Providers** and keep Email enabled.
   - For a quick pilot, turn off **Confirm email** so people can sign in straight after creating an account. Leave it on if you prefer email confirmation.
4. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key.

## 2. Run it locally

```
cd app
copy .env.example .env      (then paste the URL and anon key into .env)
npm install
npm run dev
```

## 3. First sign-in

The first person to create an account becomes the **CEO**. Everyone after that sees "Your account is not set up yet" and appears under **People > New sign-ins** for the CEO, who links them to a person, role and team.

Roles: CEO (everything), HR (read-only across the company), Manager (their team), Member (themselves; team on the leaderboard).

## 4. Deploy to Vercel

1. Push the `app` folder to a Git repository (or import it with the Vercel CLI).
2. In Vercel, import the project. Framework: Vite. Build command `npm run build`, output `dist`.
3. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. In Supabase **Authentication > URL Configuration**, set the Site URL to your Vercel address.

The anon key is meant to be public. Access is controlled by the policies in the schema.

## What changed from the Claude page version

- Sign-in is email and password through Supabase instead of a Claude account.
- Approvals and key-result requests run through `set_kr` and `approve_kr` in the database, which check the routing rules (member to a manager of the same team, manager to the CEO).
- The leaderboard is computed by the `leaderboard` function, so members and managers receive only their team's rows.
- "Viewing as" is a read-only preview. Actions always run as the signed-in person.

## Known limits

- People are matched by name in OKR, standup and priority records, so names must be unique (the database enforces this).
- No email notifications yet.
- Week boundaries (Monday to Sunday) use the viewer's local date.
