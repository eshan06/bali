# Bali - AWS Setup Guide (MVP)

Region: **us-east-1**

## 1. RDS (PostgreSQL)

1. Go to **RDS > Create database**
2. Settings:
   - Engine: PostgreSQL 15
   - Template: Free tier
   - Instance: `db.t3.micro`
   - Storage: 20 GB gp2
   - DB instance identifier: `bali-db`
   - Master username: `bali_admin`
   - Master password: (save securely)
   - Public access: **Yes**
   - Database name: `bali`
3. Security group: allow inbound TCP 5432 from:
   - Your development IP
   - (Lambda won't be in VPC, so it uses public endpoint)
4. After creation, note the endpoint URL
5. Connect and run migrations:
   ```bash
   psql postgresql://bali_admin:<password>@<endpoint>:5432/bali -f packages/db/migrations/001_initial_schema.sql
   psql postgresql://bali_admin:<password>@<endpoint>:5432/bali -f packages/db/migrations/002_indexes.sql
   psql postgresql://bali_admin:<password>@<endpoint>:5432/bali -f packages/db/migrations/003_seed.sql
   ```

## 2. Cognito User Pool

1. Go to **Cognito > Create user pool**
2. Settings:
   - Pool name: `bali-user-pool`
   - Sign-in: Email
   - Password policy: Min 8 chars, uppercase + number
   - MFA: Off
   - Email delivery: Cognito default
3. App client:
   - Name: `bali-web`
   - Auth flows: `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`
   - No client secret
4. Hosted UI:
   - Domain: `bali-auth` (or available name)
   - Callback URLs: `http://localhost:3000/auth/callback/`, `https://<production>/auth/callback/`
   - Sign-out URLs: `http://localhost:3000/login/`, `https://<production>/login/`
   - OAuth scopes: `openid`, `email`, `profile`
5. Google IdP (optional):
   - Create OAuth client in Google Cloud Console
   - Add client ID + secret to Cognito identity providers
   - Attribute mapping: `email -> email`, `name -> name`
6. Note: User Pool ID, Client ID, Domain

## 3. Lambda Function

1. Go to **Lambda > Create function**
2. Settings:
   - Name: `bali-api`
   - Runtime: Node.js 20.x
   - Architecture: x86_64
   - Memory: 256 MB
   - Timeout: 30 seconds
3. Environment variables:
   ```
   DATABASE_URL=postgresql://bali_admin:<pass>@<rds-endpoint>:5432/bali
   DATABASE_SSL=true
   COGNITO_USER_POOL_ID=us-east-1_XXXXXXX
   COGNITO_CLIENT_ID=<app-client-id>
   API_KEY=<generate: openssl rand -hex 32>
   CORS_ORIGIN=http://localhost:3000
   DEFAULT_SCHOOL_ID=11111111-1111-1111-1111-111111111111
   ```
4. **Do NOT** put Lambda in a VPC (avoids NAT Gateway cost)
5. Deploy:
   ```bash
   cd packages/api
   npm run build
   cd dist
   zip -r ../lambda.zip router.js router.js.map
   aws lambda update-function-code --function-name bali-api --zip-file fileb://../lambda.zip
   ```

## 4. API Gateway (HTTP API)

1. Go to **API Gateway > Create API > HTTP API**
2. Name: `bali-api-gateway`
3. Add integration: Lambda `bali-api`
4. Routes:
   - `ANY /api/{proxy+}` -> Lambda integration
5. CORS:
   - Allow origins: `http://localhost:3000`, `https://<production-domain>`
   - Allow methods: `GET, POST, PUT, DELETE, OPTIONS`
   - Allow headers: `Content-Type, Authorization, X-API-Key`
   - Max age: 3600
6. Stage: `$default` with auto-deploy enabled
7. Note the API Gateway URL (e.g., `https://abc123.execute-api.us-east-1.amazonaws.com`)

## 5. Frontend Hosting

The admin console uses Next.js with dynamic routes (server-rendered on demand).
For MVP, host via one of these options:

### Option A: AWS Amplify Hosting (recommended for MVP)
1. Go to **AWS Amplify > Host web app**
2. Connect your Git repo (GitHub)
3. Set build settings:
   - Build command: `cd packages/web && npm run build`
   - Output directory: `packages/web/.next`
4. Add environment variables (the `NEXT_PUBLIC_*` vars listed below)
5. Deploy — Amplify handles SSR, CDN, and custom domains

### Option B: EC2/Lightsail (manual)
1. Launch a small instance (t3.micro, free tier)
2. Install Node.js 20, clone repo, install deps
3. Build and run: `cd packages/web && npm run build && npm start`
4. Use nginx as reverse proxy on port 80/443

### Option C: Docker/ECS (future)
Build a Docker image with `next start` and deploy to ECS Fargate.

## 6. Environment Variables Summary

### Backend (Lambda)
| Variable | Value |
|----------|-------|
| DATABASE_URL | `postgresql://bali_admin:<pass>@<rds-endpoint>:5432/bali` |
| DATABASE_SSL | `true` |
| COGNITO_USER_POOL_ID | `us-east-1_XXXXXXX` |
| COGNITO_CLIENT_ID | `<app-client-id>` |
| API_KEY | `<random-hex-string>` |
| CORS_ORIGIN | `https://<cloudfront-domain>` |
| DEFAULT_SCHOOL_ID | `11111111-1111-1111-1111-111111111111` |

### Frontend (build-time)
| Variable | Value |
|----------|-------|
| NEXT_PUBLIC_API_URL | `https://<api-gateway-url>/api` |
| NEXT_PUBLIC_COGNITO_USER_POOL_ID | `us-east-1_XXXXXXX` |
| NEXT_PUBLIC_COGNITO_CLIENT_ID | `<app-client-id>` |
| NEXT_PUBLIC_COGNITO_DOMAIN | `<domain>.auth.us-east-1.amazoncognito.com` |
| NEXT_PUBLIC_REDIRECT_URI | `https://<cloudfront-domain>/auth/callback/` |

## 7. Hardware Device Integration

Devices send check-ins to:
```
POST https://<api-gateway-url>/api/checkin
Headers: X-API-Key: <API_KEY>, Content-Type: application/json
Body: { "deviceId": "BALI-DEV-0001", "timestamp": "2026-04-09T08:01:23Z" }
```

## 8. iOS App Integration

iOS app polls for blocking policy:
```
GET https://<api-gateway-url>/api/blocking/policy/<studentId>
Headers: X-API-Key: <API_KEY>
Response: { "blocking": true, "blockedApps": ["com.burbn.instagram", ...], "sessionId": "...", "updatedAt": "..." }
```
Poll every 30 seconds. When `blocking` is `false`, remove all restrictions.

## Cost Estimate (MVP)

| Service | Monthly Cost |
|---------|-------------|
| RDS db.t3.micro | Free tier (750 hrs/mo for 12 months) |
| Lambda | Free tier (1M requests/mo) |
| API Gateway | Free tier (1M requests/mo for 12 months) |
| S3 | ~$0.02 (static files) |
| CloudFront | Free tier (1TB/mo for 12 months) |
| Cognito | Free tier (50K MAU) |
| **Total** | **~$0/mo** (within free tier) |
