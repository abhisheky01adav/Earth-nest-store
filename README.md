# 🌿 EarthNest Eco Store

A complete store: **customer storefront**, **login page**, and **admin portal** — all run by one small Node.js server.
No `npm install` needed. Your data (products, orders, users) is saved in `db.json`.

## 1. Run it on your computer (first time)

1. Install Node.js (the **LTS** button): https://nodejs.org  → install with all default options.
2. Unzip this folder (right-click → Extract All).
3. Open a terminal **inside the folder**:
   - **Windows:** open the folder, click the address bar at the top, type `cmd`, press Enter.
   - **Mac:** right-click the folder → *New Terminal at Folder*.
4. In the black window type this and press Enter:

       node server.js

5. Open your browser:
   - Store: http://localhost:3000
   - Login: http://localhost:3000/login.html
   - Admin: http://localhost:3000/admin.html

   **Admin login:** `admin@earthnest.local` / `admin123`
   👉 Go to **Admin → Payment & Settings → Change admin password** right away.

To stop the server press `Ctrl + C`.

## 2. What the admin can do
- **Dashboard:** revenue, orders, payments waiting for verification, low-stock alerts
- **Orders:** see address, items, UPI UTR number; change status (placed → confirmed → shipped → delivered / cancelled)
- **Customers:** list of everyone who registered (name, email, mobile, joined date, orders, total spent) with search and CSV download
- **Products:** add, edit, delete, change stock and price — live on the store instantly
- **Payment & Settings:** your UPI ID, bank details (shown at checkout, QR is generated automatically), shipping rules, admin password

## 3. Put it on a live server (VPS such as DigitalOcean, Hostinger, AWS Lightsail — Ubuntu)

    # on the server
    sudo apt update && sudo apt install -y nodejs npm nginx
    # upload this folder (e.g. with FileZilla/WinSCP) to /var/www/earthnest, then:
    cd /var/www/earthnest
    sudo npm install -g pm2
    ADMIN_EMAIL=you@yourmail.com ADMIN_PASSWORD='ChooseAStrongOne' pm2 start server.js --name earthnest
    pm2 save && pm2 startup

Point nginx to the app (`/etc/nginx/sites-available/default`):

    server {
      listen 80;
      server_name yourdomain.com www.yourdomain.com;
      location / { proxy_pass http://127.0.0.1:3000; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header Host $host; }
    }

Then `sudo nginx -t && sudo systemctl restart nginx`, and add free HTTPS: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx`.

**Render / Railway:** works too (start command `node server.js`), but you must attach a **persistent disk** and set `DATA_FILE=/that/disk/path/db.json`, otherwise orders disappear on every restart.

## Forgot password (mobile OTP or email)
Customers now give their **mobile number** when they create an account. On the login page, **Forgot password?** offers two ways:
- **📱 Mobile OTP (recommended):** the customer enters their mobile number and receives a 6-digit OTP by SMS (valid 15 minutes, 5 tries), then sets a new password.
- **✉️ Email:** the code appears in **Admin → Dashboard → Password-reset requests**. Verify the customer by call/WhatsApp and give them the code.

### Turn on real SMS (Fast2SMS)
1. Create an account at https://www.fast2sms.com, add some balance, and copy your **API key** (Dev API section). Check in their dashboard that the **OTP route** is enabled for your account.
2. Start the server with the key:
   - Windows (cmd): `set FAST2SMS_API_KEY=yourkey` then `node server.js`
   - Mac/Linux / VPS: `FAST2SMS_API_KEY=yourkey pm2 start server.js --name earthnest`

Without the key the store still works: the OTP is printed in the server window and shown in the Admin dashboard so you can pass it to the customer yourself.

### Store owner (admin)
Set `ADMIN_PHONE=98XXXXXXXX` (with the SMS key) to reset the admin password by OTP too. Otherwise the code is printed in the server window (`pm2 logs earthnest` on a live server). You can always restart with `ADMIN_PASSWORD='NewPassword'` to reset it.

## Settings (environment variables, all optional)
| Name | Meaning | Default |
|---|---|---|
| `PORT` | port to listen on | 3000 |
| `ADMIN_EMAIL` | admin login email | admin@earthnest.local |
| `ADMIN_PASSWORD` | sets/resets the admin password at start | admin123 (warning shown) |
| `FAST2SMS_API_KEY` | sends password-reset OTPs by SMS | not set (OTP shown in Admin) |
| `ADMIN_PHONE` | admin mobile for OTP reset | not set |
| `DATA_FILE` | where the database file lives | ./db.json |

## Good to know
- UPI payments are **verified manually**: customer pays, enters the 12-digit UTR, you match it in your bank app and mark the order *confirmed*.
- Back up `db.json` regularly — it holds everything.
- Folder layout: `server.js` (backend) · `db.json` (data) · `public/` (index.html store, login.html, admin.html, style.css, app.js)
