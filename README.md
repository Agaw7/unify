# UNIFY

A web-based investment management platform built using Next.js, TypeScript, and Supabase.

UNIFY is designed to provide users with a centralized platform for managing accounts, viewing investment products, monitoring transactions, and accessing financial information through a responsive dashboard.

**Disclaimer:** UNIFY is currently under development. Any demonstration balances, investment returns, or payment transactions are for testing purposes unless supported by verified financial integrations and the required regulatory authorizations.

## Setup

1. Install Node.js 20.9 or later.
2. Install the project dependencies:

   ```bash
   npm install
   ```

3. Create a Supabase project at https://supabase.com/dashboard.
4. Open the Supabase SQL Editor and execute the project's database schema.
5. Copy `.env.example` to `.env.local` and configure your Supabase URL and publishable key.
6. Configure authentication in Supabase.
7. Start the development server:

   ```bash
   npm run dev
   ```

8. Open http://localhost:3000 in your browser.
9. Register or sign in to access the UNIFY dashboard.
10. Configure administrator access using the appropriate database roles and permissions.

## Project Structure

- `src/app/page.tsx` - Main application interface, dashboard, and user features.
- `src/app/layout.tsx` - Application layout and metadata.
- `src/app/globals.css` - Global styles and responsive design.
- `src/lib/supabase.ts` - Supabase client configuration.
- `src/app/api/` - Backend API routes, where implemented.
- `public/` - Static assets and product images.
- `supabase/` - Database schema and SQL scripts, where applicable.

## Features

- User registration and authentication
- Responsive user dashboard
- Investment product information
- User account management
- Transaction history
- Wallet and payment tracking
- Administrator dashboard
- Database-backed records
- Account security and access controls

*Feature availability depends on the current implementation.*

## Security

- Supabase Authentication for user access.
- Row Level Security (RLS) for protecting database records.
- Server-side validation for sensitive transactions.
- Secure handling of environment variables and API credentials.
- Role-based authorization for administrator functionality.
- Transaction logging and audit mechanisms where implemented.
- Never expose Supabase service-role keys in frontend code.

## Technologies

- Next.js
- React
- TypeScript
- Supabase
- PostgreSQL
- HTML and CSS
- Git and GitHub

## Development

UNIFY is actively under development. Additional features, security improvements, testing, and integrations may be introduced in future updates.

## GitHub Repository

https://github.com/Agaw7/unify

## License

No license has been specified yet.

## Project Status

Under Development
