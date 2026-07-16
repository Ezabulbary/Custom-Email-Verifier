const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = 'super-secret-key-123';
const db = new sqlite3.Database('users.sqlite');

// Step 1: Check DB
db.all('SELECT id, email, credits, role FROM users', [], (err, users) => {
    console.log('=== DB USERS ===');
    if (err) console.error('DB ERROR:', err.message);
    else console.log(JSON.stringify(users, null, 2));

    // Step 2: Generate a super_admin token
    const superAdminUser = users.find(u => u.role === 'super_admin');
    if (!superAdminUser) {
        console.log('ERROR: No super_admin user found!');
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
