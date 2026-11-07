# Blood Booking (full stack)

Express backend + your existing single-page frontend.

## Run in VS Code
1. Install Node.js 18+ from https://nodejs.org
2. Unzip, then **File > Open Folder** and pick `blood-booking`
3. Open the terminal (Ctrl+`) and run:
   ```
   npm install
   npm start
   ```
   (or press F5 to run with the debugger; `npm run dev` auto-restarts on changes)
4. Open http://localhost:3000

## Accounts
- Create an account on the sign-in screen (mobile number + password).
- Seeded admin (sees all orders in the Blood centre / Coordinator tabs): phone `9999999999`, password `admin123`.

## Structure
- `public/index.html` frontend (UI, map, order tracking simulation)
- `server/server.js` backend: auth (JWT), stock, orders, prescription upload, status updates
- `data/db.json` created on first run (users, stock, orders). Delete it to reset.
- `uploads/` prescription files (not publicly served)

## API
| Method | Path | Notes |
|---|---|---|
| POST | /api/auth/signup, /api/auth/login | returns `{token}` |
| GET | /api/me | current user |
| GET | /api/stock | inventory by bank / group / component |
| GET | /api/orders | own orders (admin: all) |
| POST | /api/orders | multipart; server recomputes price and checks stock |
| PATCH | /api/orders/:id/status | status only moves forward (0 to 6) |
| GET | /api/orders/:id/prescription | owner or admin |

## Before real-world use
This is a coursework preview. Set `JWT_SECRET` (env var) and change the admin password. Payment, OTP, live stock, delivery tracking and the hospital/blood bank directory are simulated and not connected to real services. Blood supply is safety-critical: use licensed blood centres and verified data.
