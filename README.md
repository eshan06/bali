# Bali

Classroom productivity platform that helps teachers manage attendance, monitor devices, and control app usage during class sessions.

## Features

- **Class Management** — Create classes, enroll students manually or via CSV import
- **Session Control** — Start/end class sessions with real-time attendance tracking
- **NFC Check-in** — Students tap hardware devices to check in automatically
- **App Blocking** — Preset blocking profiles (Full Focus, No Social Media, No Games) or custom app selection
- **Student Profiles** — Per-student attendance history, charts, device info, and teacher notes
- **Device Management** — Register and assign devices to students

## Architecture

Monorepo with four packages:

| Package | Description |
|---------|-------------|
| `packages/web` | Next.js 14 admin console (teacher dashboard) |
| `packages/api` | AWS Lambda REST API |
| `packages/db` | PostgreSQL schema, migrations, and query layer |
| `packages/shared` | Shared TypeScript types, validators, and constants |

## Tech Stack

- **Frontend:** Next.js, React, Tailwind CSS, Recharts
- **Backend:** AWS Lambda, API Gateway, Node.js
- **Database:** PostgreSQL (AWS RDS)
- **Auth:** AWS Cognito (email/password + Google OAuth)

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database
- AWS account (Cognito user pool)

### Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL, Cognito config, etc.

# Run database migrations
cd packages/db && npm run migrate

# Build shared packages
cd packages/shared && npm run build
cd packages/db && npm run build

# Start the dev server
cd packages/web && npm run dev

# Start the API (separate terminal)
cd packages/api && npm run dev
```

## License

Private — all rights reserved.
