# সার্ভারে ডিপ্লয় — লাইন বাই লাইন (copy-paste)

আপনি প্রতিটা কমান্ড এক এক করে সার্ভারে (VPS-এ) copy করে paste করবেন, Enter দিবেন।
`YOUR_...` লেখা জায়গাগুলো আপনার নিজের ভ্যালু দিয়ে বদলাবেন।

---

## যা আগে হাতে রাখুন
1. **serviceAccount.json** এর JSON — Firebase Console → ⚙️ Project settings →
   Service accounts → **Generate new private key** (একটা .json ফাইল নামবে, ওটা খুলে
   ভেতরের সব লেখা লাগবে)।
2. আপনার **domain** (যেমন `verifier.yourdomain.com`)। Domain না থাকলে সার্ভারের
   **IP** দিয়েও চলবে।

---

## STEP 0 — সার্ভারে ঢুকুন
নিজের কম্পিউটার থেকে:
```
ssh root@YOUR_SERVER_IP
```

## STEP 1 — প্রোজেক্ট ফোল্ডার খুঁজে বের করুন
আগে থেকে ডিপ্লয় করা থাকলে, server.js কোথায় আছে বের করুন:
```
find / -name server.js 2>/dev/null | grep -v node_modules
```
যে path দেখাবে (যেমন `/root/Custom-Email-Verifier/server.js`), তার ফোল্ডারে যান:
```
cd /root/Custom-Email-Verifier
```
> কিছু না দেখালে (একদম নতুন সার্ভার) — নিচের STEP 1b করুন, নাহলে skip করে STEP 2।

### STEP 1b — একদম নতুন হলে GitHub থেকে আনুন
> শর্ত: আপনি আগে Windows থেকে v20 কোড GitHub-এ push করেছেন।
```
cd /root
git clone https://github.com/Ezabulbary/Custom-Email-Verifier.git
cd Custom-Email-Verifier
```

## STEP 2 — সর্বশেষ কোড আনুন (আগে থেকে থাকলে)
```
git pull origin main
```
> `git pull` কাজ না করলে (আপনি zip দিয়ে কাজ করেন) — Windows থেকে নতুন কোড
> GitHub-এ push করে তারপর `git pull` দিন, অথবা v20 zip সার্ভারে আপলোড করে
> এই ফোল্ডারে extract করুন।

## STEP 3 — serviceAccount.json রাখুন
```
nano serviceAccount.json
```
Firebase-এর JSON পুরোটা paste করুন → `Ctrl+O` তারপর `Enter` (সেভ) → `Ctrl+X` (বের হন)।

## STEP 4 — .env ফাইল বানান
```
nano .env
```
নিচের লেখাটা paste করুন (YOUR_... বদলে দিন):
```
NODE_ENV=production
PORT=3001
JWT_SECRET=YOUR_LONG_RANDOM_SECRET
FRONTEND_URL=https://verifier.yourdomain.com
VERIFY_HELO_DOMAIN=mail.yourdomain.com
VERIFY_MAIL_FROM=verify@yourdomain.com
```
সেভ: `Ctrl+O` `Enter`, বের হন: `Ctrl+X`।

**JWT_SECRET বানাতে** (এই কমান্ড চালিয়ে যা আসবে, সেটা উপরে `JWT_SECRET=` এর পরে বসান):
```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## STEP 5 — ব্যাকএন্ড ইনস্টল
```
npm install
```

## STEP 6 — ফ্রন্টএন্ড বিল্ড (ব্যাকএন্ড নিজেই এটা দেখাবে)
```
cd frontend
echo "VITE_API_URL=" > .env.production
npm install
npm run build
cd ..
```

## STEP 7 — ব্যাকএন্ড চালু করুন (PM2 দিয়ে — বন্ধ হলে অটো চালু হয়)
```
npm install -g pm2
pm2 delete bouncecure 2>/dev/null
pm2 start server.js --name bouncecure
pm2 save
pm2 startup
```
লগ দেখুন (ঠিকঠাক চললে যা দেখবেন):
```
pm2 logs bouncecure --lines 25
```
এই লাইনগুলো দেখলে ঠিক আছে:
```
[Auth] Using ./serviceAccount.json
[Store] Active data store: FIRESTORE
[Web] Serving frontend from frontend/dist ...
[Diag] Outbound port 25 is OPEN ...
Email Verifier API running on port 3001
```
লগ থেকে বের হতে: `Ctrl+C`।

## STEP 8 — nginx কনফিগ (permanent — আর কখনো ভাঙবে না)
```
nano /etc/nginx/sites-available/bouncecure
```
নিচের পুরোটা paste করুন (`server_name` এ আপনার domain/IP বসান):
```
server {
    listen 80;
    server_name verifier.yourdomain.com;
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```
সেভ: `Ctrl+O` `Enter`, বের হন: `Ctrl+X`।

চালু + রিলোড:
```
ln -sf /etc/nginx/sites-available/bouncecure /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```
> `nginx -t` এ **"syntax is ok"** এবং **"test is successful"** দেখলে ঠিক আছে।

## STEP 9 — টেস্ট
ব্রাউজারে যান: `http://verifier.yourdomain.com` (বা `http://YOUR_SERVER_IP`)।
- অ্যাপ খুলবে → login করুন → একটা email verify করুন →
  **Tasks & Results** এ ডেটা দেখবেন (আর "HTTP 200" error আসবে না)।

`http://verifier.yourdomain.com/health` খুললে দেখাবে:
`{"status":"ok","store":"firestore","port25":true}`

---

## HTTPS (optional, কিন্তু recommended)
domain থাকলে ফ্রি SSL:
```
apt install -y certbot python3-certbot-nginx
certbot --nginx -d verifier.yourdomain.com
```

## পরে কোড আপডেট করলে (প্রতিবার)
```
cd /root/Custom-Email-Verifier
git pull origin main
npm install
cd frontend && npm install && npm run build && cd ..
pm2 restart bouncecure
```

---

## কিছু আটকে গেলে
- `pm2 logs bouncecure` চালিয়ে error লাইনটা আমাকে পাঠান।
- `[History] FAILED to save...` দেখলে → Firestore permission/config সমস্যা, লগ পাঠান।
- `port25` `false` দেখালে → port 25 block, host কে বলুন খুলতে।
