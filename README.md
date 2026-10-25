# ParentPulse

A centralized, role-aware school-parent communication platform. Built per the
Review 1 SRS: Admin / Teacher / Parent / Student roles, RBAC, attendance,
assignments, announcements, notifications, dashboards, and reports, backed by a
REST API and Amazon DynamoDB, deployable to AWS.

## Stack

- **Backend:** Node.js + Express, Amazon DynamoDB (AWS SDK v3), JWT auth, bcrypt password hashing.
- **Frontend:** React (Vite), React Router, plain fetch-based API client.
- **Deployment:** AWS EC2 (Node + nginx + pm2) + DynamoDB (IAM instance role, no stored keys) — see [`deploy/aws/README.md`](deploy/aws/README.md).

## Project layout

```
backend/     Express REST API (see backend/src/routes for each domain)
frontend/    React app (role-specific dashboards, matching the Review 1 mockups)
deploy/aws/  Scripts to provision EC2 + DynamoDB access and deploy the app
```

## Local development

### 1. Database

The app talks to real Amazon DynamoDB (there is no local database to install).
Point `AWS_PROFILE` and `AWS_REGION` in `backend/.env` at your AWS account; local
development uses separate `_dev`-suffixed tables (`TABLE_ENV=dev`), so it never
touches the deployed `_prod` data.

### 2. Backend

```bash
cd backend
cp .env.example .env      # edit if your DB credentials differ
npm install
npm run db:init           # creates the DynamoDB tables if missing
npm run db:seed           # creates demo admin/teacher/parent/student accounts
npm run dev                # starts the API on http://localhost:4000
```

Demo accounts created by `db:seed` (see `backend/src/db/seed.js`):

| Role    | Email                       | Password     |
|---------|------------------------------|--------------|
| Admin   | admin@parentpulse.local      | Admin@123    |
| Teacher | teacher@parentpulse.local    | Teacher@123  |
| Parent  | parent@parentpulse.local     | Parent@123   |
| Student | student@parentpulse.local    | Student@123  |

### 3. Frontend

```bash
cd frontend
cp .env.example .env      # VITE_API_URL, defaults to http://localhost:4000/api
npm install
npm run dev                # starts on http://localhost:5173, proxies /api to :4000
```

Open http://localhost:5173 and sign in with one of the demo accounts above, or
register a new parent/teacher/student account.

## Requirements coverage

The backend routes map directly to the FRs in the SRS:

| FR | Route(s) |
|----|----------|
| FR-01 Authentication | `POST /api/auth/register`, `/login`, `/logout` |
| FR-02 RBAC | `middleware/auth.js` (`requireRole`), enforced in every route |
| FR-03 User Management | `/api/users` |
| FR-04 Student Management | `/api/students` (incl. parent-student linking) |
| FR-05 Academic Management | `/api/classes`, `/api/subjects`, `/api/assignments` |
| FR-06 Attendance | `/api/attendance` |
| FR-07 Announcements | `/api/announcements` |
| FR-08 Notifications | `/api/notifications` |
| FR-09 Dashboards | Frontend `pages/Dashboard.jsx`, role-specific |
| FR-10 Search & Filtering | `/api/users?q=&role=`, `/api/students?classId=` |
| FR-11 Reports | `/api/reports/student/:id`, `/api/reports/class/:id/summary` |
| FR-12 Administration | `/api/admin/overview`, `/api/classes`, `/api/subjects` |
| FR-13 Cloud Data | Amazon DynamoDB, on-demand tables (see `deploy/aws`) |
| FR-14 CRUD | Throughout all routes, RBAC- and ownership-checked |

Data isolation (parents/teachers/students only see what they're authorized to,
per SRS §11) is enforced server-side in `backend/src/utils/authz.js` and used by
every route that returns student-linked data — never only in the UI.

## Child location sharing

Parents can see where their children are on a map (**Location** in the parent
menu). The position comes from the student's own device: the student turns it on
under **Location sharing**, the browser asks for permission, and updates are sent
(at most every 10 s, at least every 60 s, or on a 25 m move) while ParentPulse is
open on that device. A "Sharing location" indicator stays in the student's top bar.

- Only parents linked to the child can see it (`GET /api/location/children`);
  teachers and admins cannot. Only students can write their own location.
- Only the latest position is stored (`parentpulse_locations_*`, no history), and it
  is deleted when the student stops sharing or signs out.
- A website cannot track in the background - continuous tracking would need a
  native mobile app.
- `npm run db:seed:locations` adds demo positions around Vellore (tagged
  `source: 'demo'`); a student's real updates overwrite theirs.

## AWS deployment

See [`deploy/aws/README.md`](deploy/aws/README.md) for step-by-step instructions
to provision EC2 + DynamoDB and deploy the app, including switching the AWS CLI to a
different account/profile and tearing everything down afterward.
