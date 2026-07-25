const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');
const http = require('http');

// Must match the server's secret. The server reads JWT_SECRET from the
// environment, so read it the same way here — otherwise the token it signs
// will be rejected by the API with 403 Forbidden.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('ERROR: JWT_SECRET is not set. Start diagnose with the same JWT_SECRET the server uses,');
    console.error('e.g.  JWT_SECRET=your-secret node diagnose.js');
    process.exit(1);
}
const db = new sqlite3.Database('users.sqlite');

// Step 1: Check DB
db.all('SELECT id, email, credits, role FROM users', [], (err, users) => {
    console.log('=== DB USERS ===');
    if (err) console.error('DB ERROR:', err.message);
    else console.log(JSON.stringify(users, null, 2));

    // Step 2: Generate a superadmin token
    const superAdminUser = users.find(u => u.role === 'superadmin');
    if (!superAdminUser) {
        console.log('ERROR: No superadmin user found!');
        db.close();
        return;
    }

    const token = jwt.sign({ id: superAdminUser.id, email: superAdminUser.email, role: superAdminUser.role }, JWT_SECRET, { expiresIn: '1h' });
    console.log('\n=== TOKEN GENERATED ===');
    console.log('Token:', token.substring(0, 50) + '...');

    // Step 3: Hit /admin/users endpoint
    console.log('\n=== CALLING /admin/users ===');
    const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/admin/users',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('Status:', res.statusCode);
            console.log('Response:', data);
            db.close();
        });
    });

    req.on('error', (e) => {
        console.error('HTTP ERROR:', e.message);
        console.log('>>> Server is NOT running on port 3001!');
        db.close();
    });

    req.end();
});
