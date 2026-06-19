import React, { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { Mail, List, Upload, Search, Download, CheckCircle, XCircle, AlertCircle, HelpCircle, Loader2, LogOut, LayoutDashboard, Settings } from 'lucide-react';
import './App.css';

const API_URL = 'http://localhost:3001';

// --- Auth Context ---
const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && !data.error) setUser(data);
        else localStorage.removeItem('token');
      })
      .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = (token, userData) => {
    localStorage.setItem('token', token);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, setUser }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

// --- API Utils ---
const apiFetch = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!options.body || typeof options.body === 'string') {
     headers['Content-Type'] = 'application/json';
  } else if (options.body instanceof FormData) {
     delete headers['Content-Type']; // Let browser set boundary
  }

  const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return response.json();
};

// --- Pages ---

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (data.error) throw new Error(data.error);
      login(data.token, data.user);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div className="auth-container animate-fade-in">
      <div className="auth-left">
        <h1>Email Verifier SaaS</h1>
        <p>Enterprise-grade verification for your lists.</p>
      </div>
      <div className="auth-right">
        <div className="auth-form-container">
          <div className="auth-title">Welcome Back</div>
          <div className="auth-subtitle">Log in to your account</div>
          {error && <div style={{color:'var(--danger)', marginBottom:'1rem'}}>{error}</div>}
          <form onSubmit={handleSubmit} className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-field" required />
            <label>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="input-field" required />
            <button type="submit" className="btn-primary" style={{marginTop:'1rem'}}>Sign In</button>
          </form>
          <div style={{marginTop:'1.5rem', textAlign:'center', color:'var(--text-secondary)'}}>
            Don't have an account? <Link to="/register" style={{color:'var(--accent-color)', fontWeight:600}}>Register</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

const Register = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      }).then(r => r.json());
      if (data.error) throw new Error(data.error);
      alert('Registration successful! Please login.');
      navigate('/login');
    } catch (err) {
      setError(err.message || 'Registration failed');
    }
  };

  return (
    <div className="auth-container animate-fade-in">
      <div className="auth-left">
        <h1>Email Verifier SaaS</h1>
        <p>Start verifying emails with 100 free credits.</p>
      </div>
      <div className="auth-right">
        <div className="auth-form-container">
          <div className="auth-title">Create Account</div>
          <div className="auth-subtitle">Sign up to get started</div>
          {error && <div style={{color:'var(--danger)', marginBottom:'1rem'}}>{error}</div>}
          <form onSubmit={handleSubmit} className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-field" required />
            <label>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="input-field" required />
            <button type="submit" className="btn-primary" style={{marginTop:'1rem'}}>Sign Up</button>
          </form>
          <div style={{marginTop:'1.5rem', textAlign:'center', color:'var(--text-secondary)'}}>
            Already have an account? <Link to="/login" style={{color:'var(--accent-color)', fontWeight:600}}>Login</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

const DashboardLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="dashboard-container animate-fade-in">
      <div className="sidebar">
        <div className="sidebar-header">
          <Mail color="var(--accent-color)" /> Verifier SaaS
        </div>
        <div className="sidebar-nav">
          <Link to="/dashboard" className={`nav-item ${location.pathname==='/dashboard'?'active':''}`}><LayoutDashboard size={18}/> Dashboard</Link>
          <Link to="/dashboard/single" className={`nav-item ${location.pathname==='/dashboard/single'?'active':''}`}><Search size={18}/> Single Verify</Link>
          <Link to="/dashboard/bulk" className={`nav-item ${location.pathname==='/dashboard/bulk'?'active':''}`}><List size={18}/> Bulk Verification</Link>
          <Link to="/dashboard/csv" className={`nav-item ${location.pathname==='/dashboard/csv'?'active':''}`}><Upload size={18}/> Clean a List</Link>
          <div style={{flex:1}}></div>
          <button onClick={logout} className="nav-item" style={{width:'100%', textAlign:'left'}}><LogOut size={18}/> Logout</button>
        </div>
      </div>
      <div className="main-content">
        <div className="top-header">
          <div style={{fontWeight:500}}>{user?.email}</div>
          <div className="credits-badge">Credits: {user?.credits || 0}</div>
        </div>
        <div className="page-content">
          {children}
        </div>
      </div>
    </div>
  );
};

const StatusIcon = ({ status }) => {
  switch (status) {
    case 'valid': return <CheckCircle size={18} color="#059669" />;
    case 'invalid': return <XCircle size={18} color="#dc2626" />;
    case 'catch-all': return <AlertCircle size={18} color="#d97706" />;
    default: return <HelpCircle size={18} color="#64748b" />;
  }
};

const ResultsTable = ({ results }) => {
  if (!results || results.length === 0) return null;
  
  const exportCSV = () => {
    if (results.length === 0) return;
    const headers = ['Email', 'Status', 'Syntax', 'Disposable', 'MX Found', 'SMTP Code', 'Catch-All', 'Reason'];
    const csvContent = [
      headers.join(','),
      ...results.map(r => [
        r.email, r.status, r.syntax, r.disposable, r.mxFound, r.smtpCode, r.isCatchAll, `"${r.reason.replace(/"/g, '""')}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'verification_results.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="results-table-wrapper animate-fade-in">
      <div style={{padding:'1rem', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--border-color)'}}>
        <h3 style={{fontSize:'1.1rem'}}>Results ({results.length})</h3>
        <button onClick={exportCSV} className="btn-secondary"><Download size={16}/> Export CSV</button>
      </div>
      <table className="results-table">
        <thead><tr><th>Email</th><th>Status</th><th>Details</th></tr></thead>
        <tbody>
          {results.map((res, idx) => (
            <tr key={idx}>
              <td><strong>{res.email}</strong></td>
              <td>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem'}}>
                  <StatusIcon status={res.status} />
                  <span className={`badge ${res.status}`}>{res.status.toUpperCase()}</span>
                </div>
              </td>
              <td style={{color:'var(--text-secondary)'}}>{res.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SingleVerify = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const { setUser, user } = useAuth();

  const handleVerify = async (e) => {
    e.preventDefault();
    if(!email) return;
    setLoading(true);
    try {
      const data = await apiFetch('/verify', { method: 'POST', body: JSON.stringify({ email }) });
      setResult(data);
      setUser({...user, credits: user.credits - 1});
    } catch(err) { alert(err.message); }
    setLoading(false);
  };

  return (
    <div className="card" style={{padding:'2rem', maxWidth:'600px'}}>
      <div className="page-title">Single Verification</div>
      <form onSubmit={handleVerify} className="form-group">
        <label>Email Address</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-field" placeholder="test@domain.com" required/>
        <button type="submit" className="btn-primary" disabled={loading} style={{marginTop:'1rem'}}>
          {loading ? <Loader2 className="loader" size={18}/> : <Search size={18}/>} Verify
        </button>
      </form>
      {result && <ResultsTable results={[result]} />}
    </div>
  );
};

const BulkVerify = () => {
  const [emails, setEmails] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const { setUser, user } = useAuth();

  const handleVerify = async (e) => {
    e.preventDefault();
    const arr = emails.split('\n').map(e=>e.trim()).filter(e=>e);
    if(arr.length === 0) return;
    setLoading(true);
    try {
      const data = await apiFetch('/verify/bulk', { method: 'POST', body: JSON.stringify({ emails: arr }) });
      setResults(data.results);
      setUser({...user, credits: user.credits - data.results.length});
    } catch(err) { alert(err.message); }
    setLoading(false);
  };

  return (
    <div className="card" style={{padding:'2rem'}}>
      <div className="page-title">Bulk Verification</div>
      <form onSubmit={handleVerify} className="form-group">
        <label>Paste Emails (one per line)</label>
        <textarea value={emails} onChange={e=>setEmails(e.target.value)} className="input-field" style={{minHeight:'200px'}} required/>
        <button type="submit" className="btn-primary" disabled={loading} style={{marginTop:'1rem', width:'max-content'}}>
          {loading ? <Loader2 className="loader" size={18}/> : <List size={18}/>} Verify List
        </button>
      </form>
      <ResultsTable results={results} />
    </div>
  );
};

const CsvVerify = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const { setUser, user } = useAuth();
  const fileInputRef = React.useRef(null);

  const handleUpload = async () => {
    if(!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setLoading(true);
    try {
      const data = await apiFetch('/verify/csv', { method: 'POST', body: formData });
      setResults(data.results);
      setUser({...user, credits: user.credits - data.results.length});
      setFile(null);
    } catch(err) { alert(err.message); }
    setLoading(false);
  };

  return (
    <div className="card" style={{padding:'2rem'}}>
      <div className="page-title">Clean a List (CSV)</div>
      <div 
        className="upload-area" 
        onClick={() => fileInputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
        onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('drag-over');
          if (e.dataTransfer.files && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" accept=".csv" ref={fileInputRef} onChange={e=>setFile(e.target.files[0])} style={{ display: 'none' }} />
        <Upload size={48} color="var(--accent-color)" />
        <p style={{fontSize:'1.2rem', fontWeight:500}}>{file ? file.name : "Drag & Drop your CSV list here, or click to browse"}</p>
      </div>
      <button onClick={handleUpload} className="btn-primary" disabled={!file || loading} style={{marginTop:'1.5rem', width:'max-content'}}>
        {loading ? <Loader2 className="loader" size={18}/> : <Upload size={18}/>} Process CSV List
      </button>
      <ResultsTable results={results} />
    </div>
  );
};

const DashboardHome = () => {
  const { user } = useAuth();
  return (
    <div>
      <div className="page-title">Dashboard Overview</div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(250px, 1fr))', gap:'1.5rem'}}>
        <div className="card" style={{padding:'2rem'}}>
          <div style={{color:'var(--text-secondary)', fontWeight:500}}>Available Credits</div>
          <div style={{fontSize:'2.5rem', fontWeight:700, color:'var(--accent-color)', marginTop:'0.5rem'}}>{user?.credits}</div>
        </div>
        <div className="card" style={{padding:'2rem'}}>
          <div style={{color:'var(--text-secondary)', fontWeight:500}}>Lists Cleaned</div>
          <div style={{fontSize:'2.5rem', fontWeight:700, marginTop:'0.5rem'}}>0</div>
        </div>
      </div>
    </div>
  );
};

const ProtectedRoute = ({ children }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  return <DashboardLayout>{children}</DashboardLayout>;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
      <Route path="/dashboard/single" element={<ProtectedRoute><SingleVerify /></ProtectedRoute>} />
      <Route path="/dashboard/bulk" element={<ProtectedRoute><BulkVerify /></ProtectedRoute>} />
      <Route path="/dashboard/csv" element={<ProtectedRoute><CsvVerify /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/login" />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
