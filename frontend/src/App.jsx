import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { List, Upload, Search, Download, CheckCircle, XCircle, AlertCircle, HelpCircle, Loader2, LogOut, LayoutDashboard, History, Clock, ChevronDown, ChevronRight, Shield, FileText, Cookie, Scale, RefreshCw, Users, Trash2, Plus, Minus, ShieldCheck, Zap, ArrowRight, CheckCircle2, MailCheck, Menu, X, ArrowUp, Star, Quote, Phone, User, Lock, Eye, EyeOff, Smartphone } from 'lucide-react';
import './App.css';
import { googleSignIn } from './firebase';

// API base URL. Leave VITE_API_URL empty for local dev - requests then go to
// the same origin and Vite's dev proxy (see vite.config.js) forwards them to
// the backend, which avoids CORS and localhost/IPv6 issues. In production set
// VITE_API_URL to your API origin (or '' if same-origin behind nginx).
const API_URL = import.meta.env.VITE_API_URL || '';

// Brand / legal placeholders - replace with your real company details before
// going live. The legal pages below are professional templates and should be
// reviewed by a qualified legal professional for your jurisdiction.
const BRAND = {
  name: 'BounceCure',
  tagline: 'Stop the bounce. Cure your list.',
  company: '[Your Company Name]',
  contact: 'privacy@yourdomain.com',
  site: 'yourdomain.com',
  effectiveDate: 'July 2026',
  // Scheduling link for the "Book a quick call" buttons. Replace with your real
  // Calendly / Cal.com / Google Calendar booking URL.
  callUrl: 'https://calendly.com/your-team/15min',
};

// --- Logo (envelope + green check + motion lines) ---
const LogoMark = ({ size = 30, light = false }) => {
  const line = light ? 'rgba(255,255,255,0.5)' : '#cdd0f7';
  const stroke = light ? '#ffffff' : '#4f46e5';
  const fill = light ? 'rgba(255,255,255,0.92)' : '#ecebfe';
  return (
    <svg width={size * 1.32} height={size} viewBox="0 0 122 92" fill="none" style={{ flexShrink: 0, display: 'block' }}>
      <rect x="0" y="31" width="27" height="8" rx="4" fill={line} />
      <rect x="4" y="51" width="20" height="8" rx="4" fill={line} />
      <g transform="rotate(-7 72 46)">
        <rect x="34" y="18" width="80" height="56" rx="12" fill={fill} stroke={stroke} strokeWidth="5.5" />
        <path d="M39 26 L74 51 L109 26" fill="none" stroke={stroke} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="101" cy="68" r="18" fill="#22c55e" />
      <path d="M92.5 68 l5.5 5.5 l11 -12" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const Logo = ({ size = 30, light = false }) => (
  <span className="brand-logo" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
    <LogoMark size={size} light={light} />
    <span style={{ fontWeight: 800, fontSize: size * 0.62, letterSpacing: '-0.5px', whiteSpace: 'nowrap',
      color: light ? '#fff' : '#1a1a2e' }}>
      Bounce<span style={{ color: light ? '#c7d2fe' : '#4f46e5' }}>Cure</span>
    </span>
  </span>
);

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

  // Re-fetch the authoritative user (credits, profile) from the server so the
  // UI - e.g. the sidebar Credits - always reflects the real value.
  const refreshUser = useCallback(async () => {
    try {
      const d = await apiFetch('/auth/me');
      if (d && !d.error) setUser(d);
    } catch { /* ignore */ }
  }, []);

  // Keep credits/profile fresh: re-fetch whenever the tab regains focus, so a
  // change made elsewhere (e.g. an admin adjusting credits) shows up on return.
  useEffect(() => {
    const refreshIfLoggedIn = () => { if (localStorage.getItem('token')) refreshUser(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refreshIfLoggedIn(); };
    window.addEventListener('focus', refreshIfLoggedIn);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refreshIfLoggedIn);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, setUser, refreshUser }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

// Poll a background bulk/CSV verification job until it finishes, reporting
// progress along the way. Resolves with the final status (incl. batchId).
const pollJob = async (jobId, onProgress) => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const s = await apiFetch(`/verify/status/${jobId}`);
    if (s.error) throw new Error(s.error);
    if (onProgress) onProgress(s.processed || 0, s.total || 0);
    if (s.status === 'completed') return s;
    if (s.status === 'error') throw new Error(s.error || 'Verification failed');
    await new Promise(r => setTimeout(r, 1500));
  }
};

// Simple progress bar for running jobs.
const JobProgress = ({ processed, total }) => {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  return (
    <div className="job-progress">
      <div className="job-progress-head">
        <span><Loader2 className="loader" size={15} /> Verifying… {processed.toLocaleString()} / {total.toLocaleString()}</span>
        <strong>{pct}%</strong>
      </div>
      <div className="job-progress-track"><div className="job-progress-fill" style={{ width: `${pct}%` }} /></div>
      <span className="job-progress-note">Large lists are processed in the background. Every address is checked, nothing is skipped.</span>
    </div>
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

  // Parse defensively: an empty or non-JSON body (proxy hiccup, crashed
  // request, wrong API URL) must not blow up with "Unexpected end of JSON input".
  // When the body IS valid JSON we return it as-is, so callers can keep checking
  // `data.error` for handled (400/404/…) responses.
  const text = await response.text();
  if (!text) {
    if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}). Is the backend running and up to date?`);
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The server returned an unexpected response (HTTP ${response.status}). Check that VITE_API_URL points to your backend.`);
  }
};

// Turn a raw fetch/API failure into a message a person can act on. The most
// common cause in dev is the backend API not running on API_URL.
const friendlyError = (err) => {
  const m = (err && err.message) || '';
  if (m === 'Failed to fetch' || m === 'Load failed' || /NetworkError|ERR_CONNECTION/i.test(m)) {
    return 'Cannot reach the server. Make sure the backend API is running (node server.js).';
  }
  return m || 'Something went wrong. Please try again.';
};

// --- Shared bits ---

const LegalLinks = () => (
  <div className="legal-links">
    <Link to="/privacy">Privacy Policy</Link>
    <Link to="/terms">Terms of Service</Link>
    <Link to="/cookies">Cookie Policy</Link>
    <Link to="/gdpr">GDPR</Link>
  </div>
);

const AppFooter = () => (
  <footer className="app-footer">
    <span>© {BRAND.effectiveDate.split(' ').pop()} {BRAND.name}. All rights reserved.</span>
    <LegalLinks />
  </footer>
);

// Reoon-style fine-grained statuses -> display label + colour bucket. Keep in
// sync with statusBucket() in verifier.js.
const STATUS_META = {
  safe:       { label: 'Safe',       icon: 'ok',   color: '#059669' },
  role:       { label: 'Role',       icon: 'ok',   color: '#0d9488' },
  valid:      { label: 'Valid',      icon: 'ok',   color: '#059669' }, // legacy results
  'catch-all':{ label: 'Catch-all',  icon: 'warn', color: '#d97706' },
  inbox_full: { label: 'Inbox Full', icon: 'warn', color: '#d97706' },
  disposable: { label: 'Disposable', icon: 'bad',  color: '#dc2626' },
  disabled:   { label: 'Disabled',   icon: 'bad',  color: '#dc2626' },
  spamtrap:   { label: 'Spamtrap',   icon: 'bad',  color: '#b91c1c' },
  invalid:    { label: 'Invalid',    icon: 'bad',  color: '#dc2626' },
  not_catch_all: { label: 'Not catch-all', icon: 'unk', color: '#64748b' },
  unknown:    { label: 'Unknown',    icon: 'unk',  color: '#64748b' },
};
const statusMeta = (status) => STATUS_META[status] || STATUS_META.unknown;

const StatusIcon = ({ status }) => {
  const m = statusMeta(status);
  switch (m.icon) {
    case 'ok':   return <CheckCircle size={18} color={m.color} />;
    case 'bad':  return <XCircle size={18} color={m.color} />;
    case 'warn': return <AlertCircle size={18} color={m.color} />;
    default:     return <HelpCircle size={18} color={m.color} />;
  }
};

const ConfidenceBar = ({ value }) => {
  if (typeof value !== 'number') return <span>-</span>;
  const color = value >= 70 ? '#059669' : value >= 40 ? '#d97706' : '#dc2626';
  return (
    <div style={{display:'flex', alignItems:'center', gap:'0.5rem'}}>
      <div style={{width:'56px', height:'6px', background:'var(--border-color)', borderRadius:'3px', overflow:'hidden'}}>
        <div style={{width:`${value}%`, height:'100%', background: color}} />
      </div>
      <span style={{fontSize:'0.85rem', color:'var(--text-secondary)'}}>{value}%</span>
    </div>
  );
};

const buildCSV = (results) => {
  const csvCell = (val) => {
    let s = val === null || val === undefined ? '' : String(val);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // neutralise formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  // Preserve every ORIGINAL column from the uploaded file (r.source), in first-
  // seen order, then append the verification columns. For single/bulk (no
  // source) only the verification columns are written.
  const sourceKeys = [];
  for (const r of results) {
    if (r && r.source) for (const k of Object.keys(r.source)) if (!sourceKeys.includes(k)) sourceKeys.push(k);
  }
  const verifyCols = ['Verification Email', 'Verification Status', 'Confidence', 'Provider', 'Disposable', 'MX Found', 'Catch-All', 'Reason'];
  const headers = [...sourceKeys, ...verifyCols];
  return [
    headers.join(','),
    ...results.map(r => [
      ...sourceKeys.map(k => (r.source && r.source[k] != null) ? r.source[k] : ''),
      r.email, r.status, r.confidence, r.provider, r.disposable, r.mxFound, r.isCatchAll, r.reason
    ].map(csvCell).join(','))
  ].join('\n');
};

const downloadCSV = (results, filename = 'verification_results.csv') => {
  const blob = new Blob([buildCSV(results)], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const ResultsTable = ({ results, title = 'Results' }) => {
  if (!results || results.length === 0) return null;

  return (
    <div className="results-table-wrapper animate-fade-in">
      <div style={{padding:'1rem', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--border-color)'}}>
        <h3 style={{fontSize:'1.1rem'}}>{title} ({results.length})</h3>
        <button onClick={() => downloadCSV(results)} className="btn-secondary"><Download size={16}/> Export CSV</button>
      </div>
      <table className="results-table">
        <thead><tr><th>Email</th><th>Status</th><th>Confidence</th><th>Details</th></tr></thead>
        <tbody>
          {results.map((res, idx) => (
            <tr key={idx}>
              <td><strong>{res.email}</strong></td>
              <td>
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem'}}>
                  <StatusIcon status={res.status} />
                  <span className={`badge ${res.status || 'unknown'}`}>{statusMeta(res.status).label.toUpperCase()}</span>
                </div>
              </td>
              <td><ConfidenceBar value={res.confidence} /></td>
              <td style={{color:'var(--text-secondary)'}}>{res.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// --- Execution history (last 30 days, per verification type) ---

const TYPE_LABELS = { single: 'Single', bulk: 'Bulk', csv: 'CSV', catchall: 'Catch-all', bounce: 'Bounce' };

const formatDate = (iso) => {
  if (!iso) return '';
  // SQLite datetime('now') is UTC; append Z so it renders in local time.
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? iso : d.toLocaleString();
};

const CountPill = ({ label, value, cls }) => (
  <span className={`count-pill ${cls}`}>{label}: <strong>{value}</strong></span>
);

// Lazily fetch one batch's full per-address results (the list endpoint returns
// summaries only). Results are cached by id so we never refetch.
const useBatchResults = () => {
  const cache = useRef({});
  return useCallback(async (id) => {
    if (cache.current[id]) return cache.current[id];
    const batch = await apiFetch(`/history/${id}`);
    const results = (batch && batch.results) || [];
    cache.current[id] = results;
    return results;
  }, []);
};

// A readable title for a batch: its task name, or a "Type #N" fallback.
const batchTitle = (h) => h.name || `${TYPE_LABELS[h.type] || h.type} #${h.batchNumber ?? h.id}`;

const HistoryPanel = ({ type, version }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);      // results for the expanded row
  const [busy, setBusy] = useState(null);          // id currently downloading
  const [retentionDays, setRetentionDays] = useState(30);
  const getResults = useBatchResults();

  const load = () => {
    setLoading(true);
    apiFetch(`/history?limit=100${type ? `&type=${type}` : ''}`)
      .then(data => {
        if (data && Array.isArray(data.history)) {
          setHistory(data.history);
          if (data.retentionDays) setRetentionDays(data.retentionDays);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [type, version]);

  const toggle = async (h) => {
    if (expanded === h.id) { setExpanded(null); setDetail(null); return; }
    setExpanded(h.id); setDetail(null);
    try { setDetail(await getResults(h.id)); } catch { setDetail([]); }
  };

  const download = async (h) => {
    setBusy(h.id);
    try { downloadCSV(await getResults(h.id), `batch_${h.batchNumber ?? h.id}_${h.type}.csv`); }
    catch (err) { alert(friendlyError(err)); }
    finally { setBusy(null); }
  };

  return (
    <div className="card history-card" style={{marginTop:'2rem'}}>
      <div className="history-header">
        <div style={{display:'flex', alignItems:'center', gap:'0.6rem'}}>
          <History size={18} color="var(--accent-color)" />
          <h3 style={{fontSize:'1.05rem'}}>Recent History</h3>
          <span className="history-sub"><Clock size={13}/> last {retentionDays} days</span>
        </div>
        <button onClick={load} className="btn-secondary" title="Refresh">
          <RefreshCw size={15} className={loading ? 'loader' : ''}/> Refresh
        </button>
      </div>

      {loading && history.length === 0 ? (
        <div className="history-empty"><Loader2 className="loader" size={18}/> Loading…</div>
      ) : history.length === 0 ? (
        <div className="history-empty">No verifications yet. Your executions from the last {retentionDays} days will appear here.</div>
      ) : (
        <table className="results-table history-table">
          <thead>
            <tr><th></th><th>Batch</th><th>Date &amp; Time</th><th>Total</th><th>Breakdown</th><th></th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <React.Fragment key={h.id}>
                <tr className="history-row" onClick={() => toggle(h)}>
                  <td style={{width:'28px'}}>{expanded === h.id ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</td>
                  <td><strong>#{h.batchNumber ?? h.id}</strong> <span style={{color:'var(--text-secondary)'}}>{h.name || ''}</span></td>
                  <td>{formatDate(h.createdAt)}</td>
                  <td><strong>{h.total}</strong></td>
                  <td>
                    <div className="pill-row">
                      <CountPill label="Valid" value={h.counts.valid} cls="valid" />
                      <CountPill label="Invalid" value={h.counts.invalid} cls="invalid" />
                      <CountPill label="Catch-all" value={h.counts.catchAll} cls="catch-all" />
                      <CountPill label="Unknown" value={h.counts.unknown} cls="unknown" />
                    </div>
                  </td>
                  <td style={{textAlign:'right'}}>
                    {h.total > 0 && (
                      <button className="btn-secondary" title="Download CSV"
                        onClick={(e) => { e.stopPropagation(); download(h); }}>
                        {busy === h.id ? <Loader2 className="loader" size={14}/> : <Download size={14}/>}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === h.id && (
                  <tr className="history-detail">
                    <td colSpan={6}>
                      {detail === null
                        ? <div className="history-empty"><Loader2 className="loader" size={16}/> Loading results…</div>
                        : <ResultsTable results={detail} title={`${batchTitle(h)} results`} />}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// --- Interactive helpers (landing) ---

// Reveal-on-scroll wrapper. variant="up" slides up + fades; variant="fade" only
// fades (used on cards that have their own :hover transform so the two don't fight).
const Reveal = ({ children, className = '', variant = 'up', delay = 0, as: Tag = 'div', ...rest }) => {
  const ref = useRef(null);
  // Fall back to "shown" when IntersectionObserver isn't available (e.g. SSR/old
  // browsers) so content is never stuck hidden.
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); io.disconnect(); }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal reveal-${variant} ${shown ? 'in-view' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
};

// Counts up to a numeric value the first time it scrolls into view. Keeps any
// non-numeric prefix/suffix (e.g. "<2s", "15M+", "99.5%", "30-day").
const Counter = ({ value }) => {
  const match = /^(\D*)([\d.]+)(.*)$/.exec(String(value));
  const ref = useRef(null);
  const [n, setN] = useState(0);
  const done = useRef(false);

  const target = match ? parseFloat(match[2]) : NaN;
  const decimals = match && match[2].includes('.') ? 1 : 0;

  useEffect(() => {
    const el = ref.current;
    if (!el || !match || isNaN(target) || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || done.current) return;
      done.current = true;
      const duration = 1300;
      let start = null;
      const tick = (ts) => {
        if (start === null) start = ts;
        const p = Math.min((ts - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setN(target * eased);
        if (p < 1) requestAnimationFrame(tick); else setN(target);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [match, target]);

  if (!match || isNaN(target)) return <span>{value}</span>;
  const shown = decimals ? n.toFixed(1) : Math.round(n).toString();
  return <span ref={ref}>{match[1]}{shown}{match[3]}</span>;
};

// Smooth-scroll to a section id - works from any page (navigates home first if
// we're not on the landing page, so the nav links are usable everywhere).
const useSectionNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback((id) => {
    const scrollTo = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (location.pathname !== '/') {
      navigate('/');
      // let the landing page mount before scrolling
      setTimeout(scrollTo, 60);
      setTimeout(scrollTo, 220);
    } else {
      scrollTo();
    }
  }, [navigate, location.pathname]);
};

// Floating "back to top" button that appears once the user scrolls down.
const BackToTop = () => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <button
      className={`back-to-top ${show ? 'show' : ''}`}
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <ArrowUp size={20} />
    </button>
  );
};

// --- Landing / Marketing ---

const PLANS = [
  { name: 'Free', price: '0', period: 'forever', credits: '100 credits', highlight: false,
    features: ['100 verifications', 'Single & bulk verify', 'CSV list cleaning', '30-day history'] },
  { name: 'Starter', price: '19', period: '/mo', credits: '10,000 credits', highlight: true,
    features: ['10,000 verifications', 'Everything in Free', 'Catch-all detection', 'Priority verification', 'Email support'] },
  { name: 'Pro', price: '49', period: '/mo', credits: '50,000 credits', highlight: false,
    features: ['50,000 verifications', 'Everything in Starter', 'Microsoft 365 checks', 'Confidence scoring', 'API access (soon)'] },
];

const FEATURES = [
  { icon: Search, title: 'Syntax & MX', text: 'Validates email format and checks that the domain actually accepts mail.' },
  { icon: MailCheck, title: 'SMTP Mailbox Check', text: 'Connects to the mail server to confirm the mailbox really exists.' },
  { icon: Shield, title: 'Disposable Detection', text: 'Flags temporary/throwaway email providers automatically.' },
  { icon: AlertCircle, title: 'Catch-all Handling', text: 'Multi-probe detection with a confidence score for accept-all domains.' },
  { icon: ShieldCheck, title: 'Microsoft 365 Deep Check', text: 'Resolves mailboxes even on catch-all M365 tenants.' },
  { icon: History, title: '30-Day History', text: 'Every single, bulk and CSV run is saved and re-exportable.' },
];

const STATS = [
  { value: '99.5%', label: 'Verification accuracy' },
  { value: '<2s', label: 'Average check time' },
  { value: '15M+', label: 'Emails verified' },
  { value: '30-day', label: 'History retention' },
];

const STEPS = [
  { n: '1', title: 'Upload or paste', text: 'Add a single email, paste a list, or drag-and-drop a CSV file.' },
  { n: '2', title: 'We verify each one', text: 'Syntax, MX, SMTP, disposable, catch-all and provider checks run in real time.' },
  { n: '3', title: 'Download clean results', text: 'Get a status and confidence score per address, then export the clean list.' },
];

const TESTIMONIALS = [
  { quote: 'Our bounce rate dropped from 12% to under 1% after cleaning our list with BounceCure.', name: 'Sarah K.', role: 'Growth Lead', company: 'Northwind', rating: 5 },
  { quote: 'The catch-all confidence score is what won us over. We finally trust our "risky" segment.', name: 'Daniel R.', role: 'Email Marketer', company: 'Loop Media', rating: 5 },
  { quote: 'Bulk + CSV verification saved our sales team hours every week.', name: 'Aisha M.', role: 'Sales Ops', company: 'Brightlane', rating: 5 },
];

const FAQS = [
  { q: 'What does a verification actually check?', a: 'Every address goes through syntax validation, MX lookup, SMTP mailbox probing, disposable-domain detection and catch-all analysis, and returns a precise status with a 0-100 confidence score.' },
  { q: 'What do the statuses mean?', a: 'Safe = a real, deliverable mailbox (usually personal). Role = deliverable, but a group address like support@ or info@. Catch-all = the domain accepts every address, so we return a confidence score instead of a guarantee. Disposable = a temporary/throwaway provider. Invalid = it does not exist or the domain rejects mail. Inbox Full = the mailbox exists but is over quota. Disabled = the account existed but was disabled/suspended. Spamtrap = an address used to catch spammers. Never send to it. Unknown = the server did not give a definitive answer (greylisting, timeouts).' },
  { q: 'How accurate is BounceCure?', a: 'For domains that expose a mailbox, accuracy is typically 98-99%. Catch-all and unknown results reflect genuine limits of the SMTP protocol; no verifier can be 100% certain on those, which is exactly why we return a confidence score rather than a false “valid”.' },
  { q: 'How do you handle catch-all domains?', a: 'We send multiple probes and compare the server responses, and for Microsoft 365 tenants we run a deep mailbox check, so even accept-all domains get a meaningful confidence score instead of a blind “valid”.' },
  { q: 'Will verifying send an email to the address?', a: 'No. We talk to the mail server up to the point of checking the mailbox and then disconnect before any message is sent. Recipients never receive anything.' },
  { q: 'How fast is it and can I verify in bulk?', a: 'Single checks usually complete in under two seconds. You can paste a list or upload a CSV for bulk verification, and results stream back as each address is processed.' },
  { q: 'What file formats do you support for lists?', a: 'CSV files with one email per row (with or without a header). After processing you can export a clean CSV with the status, confidence and full details for every address.' },
  { q: 'Does verifying improve my deliverability?', a: 'Yes. Removing invalid and risky addresses lowers your bounce rate, protects your sender reputation, and keeps you out of spam traps, which means more of your email reaches the inbox.' },
  { q: 'How many free credits do I get?', a: 'Every new account starts with 100 free verification credits, with no credit card required. One credit = one verified address.' },
  { q: 'Do credits expire?', a: 'Free credits never expire. Paid plans renew monthly with a fresh allocation of credits.' },
  { q: 'Can I sign in with Google?', a: 'Yes. You can create your account or log in with “Continue with Google”, or use a regular email and password, whichever you prefer.' },
  { q: 'I forgot my password. What do I do?', a: 'On the login page click “Forgot password?”, enter your email, and we will send you a secure link to set a new password. If you signed up with Google, just use “Continue with Google” instead.' },
  { q: 'Is there an API?', a: 'A REST API is on the roadmap for the Pro plan so you can verify addresses directly from your app or signup form in real time. Contact us if you would like early access.' },
  { q: 'Is my data safe and private?', a: 'Passwords are hashed with bcrypt, all traffic is encrypted over TLS, we never sell your data, and verification history is automatically deleted after 30 days. See our Privacy Policy and GDPR page for details.' },
  { q: 'Do you store the lists I upload?', a: 'Only your results are kept, and only for 30 days so you can re-export them; after that they are deleted automatically. You can also request deletion at any time.' },
  { q: 'Can I cancel or get a refund?', a: 'You can cancel anytime and keep access until the end of your billing period. Unused credits are non-refundable, but there is no long-term contract.' },
  { q: 'Still have questions?', a: 'Book a quick call with us or email support. We are happy to walk you through how BounceCure fits your workflow.' },
];

const PricingCards = () => (
  <div className="pricing-grid">
    {PLANS.map(p => (
      <div key={p.name} className={`pricing-card ${p.highlight ? 'featured' : ''}`}>
        {p.highlight && <div className="pricing-tag">Most Popular</div>}
        <div className="pricing-name">{p.name}</div>
        <div className="pricing-price"><span>$</span>{p.price}<small>{p.period}</small></div>
        <div className="pricing-credits">{p.credits}</div>
        <ul className="pricing-features">
          {p.features.map((f, i) => <li key={i}><CheckCircle2 size={16} color="#059669"/> {f}</li>)}
        </ul>
        {/* Paid plans go straight to the in-app Buy Credits page (login first if
            needed); the free plan goes to registration. */}
        <Link to={p.price === '0' ? '/register' : '/dashboard/billing'} className={p.highlight ? 'btn-primary' : 'btn-secondary'} style={{width:'100%', justifyContent:'center'}}>
          {p.price === '0' ? 'Start Free' : 'Choose ' + p.name}
        </Link>
      </div>
    ))}
  </div>
);

const FaqItem = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq-item ${open ? 'open' : ''}`} onClick={() => setOpen(o => !o)}>
      <div className="faq-q">{q} <ChevronDown size={18} className="faq-chevron"/></div>
      {open && <div className="faq-a">{a}</div>}
    </div>
  );
};

// Display name for the profile trigger: the user's name, or the email's local
// part (before @) as a name-like fallback - never the full email.
const displayName = (u) => {
  const n = `${u?.firstName || ''} ${u?.lastName || ''}`.trim();
  if (n) return n;
  return u?.email ? u.email.split('@')[0] : 'Account';
};

// Reusable account dropdown (top-right corner). Shown when signed in - in the
// public nav and in the dashboard header.
const ProfileMenu = () => {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!user) return null;
  const initial = (displayName(user).charAt(0) || '?').toUpperCase();
  const go = (path) => { setOpen(false); navigate(path); };

  return (
    <div className="profile-menu" ref={ref}>
      <button className="profile-trigger" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="profile-avatar-sm">{initial}</span>
        <span className="profile-trigger-text">
          <strong>{displayName(user)}</strong>
          <small>Click to see options</small>
        </span>
        <ChevronDown size={16} className="profile-caret" />
      </button>
      {open && (
        <div className="profile-dropdown">
          <div className="profile-dropdown-head">Account:<span>{user.email}</span></div>
          <button onClick={() => go('/dashboard')}><LayoutDashboard size={16}/> Dashboard</button>
          <button onClick={() => go('/dashboard/account')}><User size={16}/> My Profile</button>
          <button className="danger" onClick={() => { setOpen(false); logout(); navigate('/'); }}><LogOut size={16}/> Logout</button>
        </div>
      )}
    </div>
  );
};

const PublicNav = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const goToSection = useSectionNav();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const anchor = (id) => (e) => {
    e.preventDefault();
    setOpen(false);
    goToSection(id);
  };
  const goHome = (e) => {
    e.preventDefault();
    setOpen(false);
    if (location.pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' });
    else navigate('/');
  };
  const close = () => setOpen(false);

  return (
    <div className={`public-nav-wrap ${scrolled ? 'scrolled' : ''}`}>
      <div className="public-nav">
        <Link to="/" className="nav-logo" style={{ textDecoration: 'none' }} onClick={close}><Logo /></Link>

        <button
          className="nav-toggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>

        <div className={`nav-menu ${open ? 'open' : ''}`}>
          <nav className="public-nav-links">
            <a href="/" onClick={goHome}>Home</a>
            <a href="#features" onClick={anchor('features')}>Features</a>
            <a href="#how" onClick={anchor('how')}>How it works</a>
            <a href="#pricing" onClick={anchor('pricing')}>Pricing</a>
          </nav>
          <div className="nav-actions">
            {user ? (
              <Link to="/dashboard" className="nav-cta" onClick={close}>Dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="nav-login" onClick={close}>Login</Link>
                <Link to="/register" className="nav-cta" onClick={close}>Get Started</Link>
              </>
            )}
          </div>
        </div>

        {open && <div className="nav-backdrop" onClick={close} />}
      </div>
    </div>
  );
};

const PublicFooter = () => {
  const goToSection = useSectionNav();
  const anchor = (id) => (e) => { e.preventDefault(); goToSection(id); };
  const year = BRAND.effectiveDate.split(' ').pop();

  return (
    <footer className="public-footer">
      <div className="footer-glow" />
      <div className="public-footer-inner">
        <div className="footer-brand">
          <Logo light />
          <p className="footer-tagline">{BRAND.tagline}</p>
          <span className="footer-status"><span className="footer-status-dot" /> All systems operational</span>
        </div>

        <div className="footer-col">
          <h4>Product</h4>
          <a href="#features" onClick={anchor('features')}>Features</a>
          <a href="#how" onClick={anchor('how')}>How it works</a>
          <a href="#pricing" onClick={anchor('pricing')}>Pricing</a>
        </div>

        <div className="footer-col">
          <h4>Legal</h4>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
          <Link to="/cookies">Cookie Policy</Link>
          <Link to="/gdpr">GDPR</Link>
        </div>

        <div className="footer-cta">
          <h4>Start in seconds</h4>
          <p>Create a free account and get 100 verifications. No card required.</p>
          <Link to="/register" className="footer-cta-btn">Create free account <ArrowRight size={16} /></Link>
        </div>
      </div>

      <div className="public-footer-copy">
        <span>© {year} {BRAND.name}. All rights reserved.</span>
        <span className="footer-made"><MailCheck size={14} /> Built for deliverability</span>
      </div>
    </footer>
  );
};

const Landing = () => (
  <div className="public-page animate-fade-in">
    <PublicNav />

    <section className="hero">
      <div className="hero-glow" />
      <div className="hero-badge"><Zap size={14}/> Trusted email verification for teams</div>
      <h1>Stop the bounce.<br/>Verify <span className="grad-text">every email.</span></h1>
      <p>{BRAND.name} checks syntax, MX, SMTP mailbox, disposable and catch-all, with a confidence score for every address, so your emails reach real inboxes.</p>
      <div className="hero-cta">
        <Link to="/register" className="btn-primary" style={{width:'auto', padding:'0.9rem 1.7rem'}}>Start free with 100 credits <ArrowRight size={18}/></Link>
        <a href="#pricing" className="btn-secondary" style={{padding:'0.9rem 1.7rem', textDecoration:'none'}}>View pricing</a>
      </div>
      <div className="hero-trust"><CheckCircle2 size={15} color="#059669"/> No credit card required · 100 free verifications</div>
    </section>

    <section className="stats-bar">
      {STATS.map((s, i) => (
        <Reveal key={i} variant="up" delay={i * 90} className="stat-item">
          <div className="stat-value"><Counter value={s.value} /></div>
          <div className="stat-label">{s.label}</div>
        </Reveal>
      ))}
    </section>

    <section id="features" className="features-section">
      <Reveal><h2 className="section-title">Everything you need to verify email</h2></Reveal>
      <Reveal delay={60}><p className="section-sub">One tool for real-time checks, bulk lists and CSV cleaning.</p></Reveal>
      <div className="features-grid">
        {FEATURES.map((f, i) => (
          <Reveal key={i} variant="fade" delay={i * 70} className="feature-card card">
            <div className="feature-icon"><f.icon size={22} color="var(--accent-color)"/></div>
            <div className="feature-title">{f.title}</div>
            <div className="feature-text">{f.text}</div>
          </Reveal>
        ))}
      </div>
    </section>

    <section id="how" className="how-section">
      <Reveal><h2 className="section-title">How it works</h2></Reveal>
      <Reveal delay={60}><p className="section-sub">From messy list to clean inbox-ready data in three steps.</p></Reveal>
      <div className="steps-grid">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} variant="up" delay={i * 110} className="step-card">
            <div className="step-num">{s.n}</div>
            <div className="feature-title">{s.title}</div>
            <div className="feature-text">{s.text}</div>
          </Reveal>
        ))}
      </div>
    </section>

    <section id="pricing" className="pricing-section">
      <Reveal><h2 className="section-title">Simple, transparent pricing</h2></Reveal>
      <Reveal delay={60}><p className="section-sub">Start free. Upgrade when you grow.</p></Reveal>
      <PricingCards />
    </section>

    <section className="testi-section">
      <Reveal><h2 className="section-title">Loved by senders</h2></Reveal>
      <Reveal delay={60}><p className="section-sub">Teams of every size trust BounceCure to keep their lists clean.</p></Reveal>
      <div className="testi-grid">
        {TESTIMONIALS.map((t, i) => (
          <Reveal key={i} variant="up" delay={i * 90} className="testi-card card">
            <Quote size={26} className="testi-mark" />
            <div className="testi-stars" aria-label={`${t.rating} out of 5 stars`}>
              {Array.from({ length: t.rating }).map((_, s) => <Star key={s} size={16} fill="currentColor" strokeWidth={0} />)}
            </div>
            <p className="testi-quote">{t.quote}</p>
            <div className="testi-author">
              <div className="testi-avatar">{t.name.charAt(0)}</div>
              <div>
                <strong>{t.name}</strong>
                <div className="testi-role">{t.role} · {t.company}</div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>

    <section id="faq" className="faq-section">
      <Reveal><h2 className="section-title">Frequently asked questions</h2></Reveal>
      <Reveal delay={60}><p className="section-sub">Everything you need to know. Can’t find an answer? Book a quick call.</p></Reveal>
      <div className="faq-list">
        {FAQS.map((f, i) => <FaqItem key={i} q={f.q} a={f.a} />)}
      </div>
      <Reveal className="faq-call" variant="up">
        <div className="faq-call-text">
          <strong>Still have questions?</strong>
          <span>Talk to a human. Grab a free 15-minute call and we’ll help you get set up.</span>
        </div>
        <a href={BRAND.callUrl} target="_blank" rel="noopener noreferrer" className="btn-primary faq-call-btn">
          <Phone size={17} /> Book a quick call
        </a>
      </Reveal>
    </section>

    <section className="cta-section">
      <Reveal className="cta-inner" variant="up">
        <h2>Ready to clean your list?</h2>
        <p>Get 100 free verifications. No credit card required.</p>
        <Link to="/register" className="btn-primary" style={{width:'auto', padding:'0.9rem 2rem', background:'#fff', color:'var(--accent-color)'}}>Get started free <ArrowRight size={18}/></Link>
      </Reveal>
    </section>

    <PublicFooter />
    <BackToTop />
  </div>
);

// --- Pages ---

// Google "G" mark (multicolour). lucide has no brand logo, so inline it.
const GoogleIcon = (props) => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" {...props}>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-8 20-21 0-1.3-.1-2.3-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 5.1 29.5 3 24 3 16 3 9.1 7.6 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.1 36 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9 40.4 15.9 45 24 45z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.9 35.6 44 30.3 44 24c0-1.3-.1-2.3-.4-3.5z"/>
  </svg>
);

// Two-part auth layout - both halves share the same light tone. One side is the
// form, the other is brand copy; `reverse` mirrors them (form left / brand right).
const AuthShell = ({ title, subtitle, error, children, alt, reverse, brandTitle, brandText }) => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [gError, setGError] = useState('');
  const [gLoading, setGLoading] = useState(false);

  const handleGoogle = async () => {
    setGError('');
    setGLoading(true);
    try {
      const idToken = await googleSignIn();
      const data = await apiFetch('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) });
      if (data.error) throw new Error(data.error);
      login(data.token, data.user);
      navigate('/dashboard');
    } catch (err) {
      setGError(friendlyError(err));
    } finally {
      setGLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <PublicNav />
      <div className={`auth-split ${reverse ? 'reverse' : ''}`}>
        <aside className="auth-brand-side">
          <div className="auth-glow" />
          <div className="auth-brand-inner">
            <Link to="/" className="auth-logo"><Logo size={38} /></Link>
            <h2 className="auth-brand-title">{brandTitle}</h2>
            <p className="auth-brand-text">{brandText}</p>
            <ul className="auth-brand-points">
              <li><CheckCircle2 size={18} /> Real-time SMTP mailbox checks</li>
              <li><CheckCircle2 size={18} /> Catch-all &amp; disposable detection</li>
              <li><CheckCircle2 size={18} /> 100 free verifications to start</li>
            </ul>
          </div>
        </aside>

        <div className="auth-form-side">
          <div className="auth-card">
            <div className="auth-title">{title}</div>
            <div className="auth-subtitle">{subtitle}</div>

            {(error || gError) && <div className="auth-error"><AlertCircle size={16} /> {error || gError}</div>}

            <button type="button" className="google-btn" onClick={handleGoogle} disabled={gLoading}>
              {gLoading ? <Loader2 className="loader" size={18} /> : <GoogleIcon />} Continue with Google
            </button>

            <div className="auth-divider"><span>or use your email</span></div>

            {children}

            <div className="auth-alt">{alt}</div>
            <p className="auth-legal-note">
              By continuing you agree to our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Password input with a show/hide toggle, for the auth forms (which supply
// their own <label>). My Account uses the fuller PasswordInput (with a lock).
const PasswordBox = ({ value, onChange, placeholder, required, minLength, autoComplete }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-box">
      <input
        type={show ? 'text' : 'password'}
        className="input-field"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
      />
      <button type="button" className="pw-eye" onClick={() => setShow(s => !s)} tabIndex={-1} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
};

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 2FA challenge (step 2 of login when the account has an authenticator app)
  const [tempToken, setTempToken] = useState('');
  const [code, setCode] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (data.error) throw new Error(data.error);
      // Account has 2FA - show the code prompt instead of logging in.
      if (data.twoFactorRequired) { setTempToken(data.tempToken); setLoading(false); return; }
      login(data.token, data.user);
      navigate('/dashboard');
    } catch (err) {
      setError(friendlyError(err)); setLoading(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await apiFetch('/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ tempToken, code })
      });
      if (data.error) throw new Error(data.error);
      login(data.token, data.user);
      navigate('/dashboard');
    } catch (err) {
      setError(friendlyError(err)); setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle={tempToken ? 'Enter your authenticator code' : 'Log in to your account'}
      error={error}
      brandTitle="Good to see you again."
      brandText="Log in to verify emails, clean your lists and keep your bounce rate low."
      alt={tempToken
        ? <>Changed your mind? <a href="#" onClick={e=>{e.preventDefault(); setTempToken(''); setCode(''); setError('');}}>Back to login</a></>
        : <>Don't have an account? <Link to="/register">Register</Link></>}
    >
      {tempToken ? (
        <form onSubmit={submitCode} className="form-group">
          <label>6-digit code</label>
          <input type="text" inputMode="numeric" maxLength={6} value={code}
            onChange={e=>setCode(e.target.value.replace(/\D/g, ''))} className="input-field"
            placeholder="123456" autoFocus required />
          <p className="muted" style={{fontSize:'0.85rem'}}>Open your authenticator app and enter the current code for BounceCure.</p>
          <button type="submit" className="btn-primary" style={{marginTop:'1rem'}} disabled={loading || code.length !== 6}>
            {loading ? <Loader2 className="loader" size={18} /> : null} Verify
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="form-group">
          <label>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-field" placeholder="you@company.com" required />
          <div className="label-row">
            <label>Password</label>
            <Link to="/forgot-password" className="forgot-link">Forgot password?</Link>
          </div>
          <PasswordBox value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password" />
          <button type="submit" className="btn-primary" style={{marginTop:'1rem'}} disabled={loading}>
            {loading ? <Loader2 className="loader" size={18} /> : null} Sign In
          </button>
        </form>
      )}
    </AuthShell>
  );
};

// Request a reset link.
const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      if (data.error) throw new Error(data.error);
      setSent(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We’ll email you a secure link to set a new one"
      error={error}
      brandTitle="Forgot your password?"
      brandText="No problem. Enter your email and we’ll send you a link to get back into your account."
      alt={<>Remembered it? <Link to="/login">Back to login</Link></>}
    >
      {sent ? (
        <div className="auth-success">
          <CheckCircle2 size={20} color="#059669" />
          <div>If an account exists for <strong>{email}</strong>, a password-reset link is on its way. Check your inbox (and spam).</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="form-group">
          <label>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-field" placeholder="you@company.com" required />
          <button type="submit" className="btn-primary" style={{marginTop:'1rem'}} disabled={loading}>
            {loading ? <Loader2 className="loader" size={18} /> : null} Send reset link
          </button>
        </form>
      )}
    </AuthShell>
  );
};

// Set a new password using the token from the emailed link.
const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get('token') || '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!token) { setError('This reset link is invalid or has expired. Request a new one.'); return; }
    setLoading(true);
    try {
      const data = await apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      if (data.error) throw new Error(data.error);
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Enter a new password for your account"
      error={error}
      brandTitle="Almost there."
      brandText="Pick a strong new password and you’ll be back to verifying in seconds."
      alt={<>Changed your mind? <Link to="/login">Back to login</Link></>}
    >
      {done ? (
        <div className="auth-success">
          <CheckCircle2 size={20} color="#059669" />
          <div>Password updated! Redirecting you to login…</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="form-group">
          <label>New password</label>
          <PasswordBox value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" required minLength={8} autoComplete="new-password" />
          <span style={{fontSize:'0.8rem', color:'var(--text-secondary)'}}>At least 8 characters.</span>
          <button type="submit" className="btn-primary" style={{marginTop:'1rem'}} disabled={loading}>
            {loading ? <Loader2 className="loader" size={18} /> : null} Update password
          </button>
        </form>
      )}
    </AuthShell>
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
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (data.error) throw new Error(data.error);
      alert('Registration successful! Please login.');
      navigate('/login');
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start verifying emails with 100 free credits"
      error={error}
      reverse
      brandTitle="Stop the bounce. Verify every email."
      brandText="Create a free account and get 100 verifications. No credit card required."
      alt={<>Already have an account? <Link to="/login">Login</Link></>}
    >
      <form onSubmit={handleSubmit} className="form-group">
        <label>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-field" placeholder="you@company.com" required />
        <label>Password</label>
        <PasswordBox value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" required minLength={8} autoComplete="new-password" />
        <span style={{fontSize:'0.8rem', color:'var(--text-secondary)'}}>At least 8 characters.</span>
        <button type="submit" className="btn-primary" style={{marginTop:'1rem'}}>Sign Up</button>
      </form>
    </AuthShell>
  );
};

const PAGE_TITLES = {
  '/dashboard': 'Overview',
  '/dashboard/verify': 'Email Verification',
  '/dashboard/catchall': 'Catch-All Verifier',
  '/dashboard/bounce': 'Bounce Rate',
  '/dashboard/billing': 'Buy Credits',
  '/dashboard/tasks': 'Tasks & Results',
  '/dashboard/account': 'My Account',
  '/admin': 'Admin Panel',
};

const DashboardLayout = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const pageTitle = PAGE_TITLES[location.pathname]
    || (location.pathname.startsWith('/admin/user/') ? 'User History' : '');

  return (
    <div className="dashboard-container animate-fade-in">
      <div className="sidebar">
        <div className="sidebar-header">
          <Link to="/"><Logo size={26} /></Link>
        </div>
        <div className="sidebar-nav">
          <Link to="/dashboard" className={`nav-item ${location.pathname==='/dashboard'?'active':''}`}><LayoutDashboard size={18}/> Overview</Link>
          <Link to="/dashboard/verify" className={`nav-item ${location.pathname==='/dashboard/verify'?'active':''}`}><CheckCircle size={18}/> Email Verification</Link>
          <Link to="/dashboard/catchall" className={`nav-item ${location.pathname==='/dashboard/catchall'?'active':''}`}><MailCheck size={18}/> Catch-All Verifier</Link>
          <Link to="/dashboard/bounce" className={`nav-item ${location.pathname==='/dashboard/bounce'?'active':''}`}><AlertCircle size={18}/> Bounce Rate</Link>
          <Link to="/dashboard/billing" className={`nav-item ${location.pathname==='/dashboard/billing'?'active':''}`}><Plus size={18}/> Buy Credits</Link>
          <Link to="/dashboard/tasks" className={`nav-item ${location.pathname==='/dashboard/tasks'?'active':''}`}><History size={18}/> Tasks &amp; Results</Link>
          <Link to="/dashboard/account" className={`nav-item ${location.pathname==='/dashboard/account'?'active':''}`}><User size={18}/> My Account</Link>
          {(user?.role === 'admin' || user?.role === 'superadmin') && (
            <Link to="/admin" className={`nav-item ${location.pathname==='/admin'?'active':''}`}><ShieldCheck size={18}/> Admin Panel</Link>
          )}
          <div style={{flex:1}}></div>
          <div className="sidebar-credits"><Zap size={15}/> Credits: <strong>{(user?.credits ?? 0).toLocaleString()}</strong></div>
        </div>
      </div>
      <div className="main-content">
        <div className="top-header">
          <div className="top-header-title">{pageTitle}</div>
          <ProfileMenu />
        </div>
        <div className="page-content">
          {children}
          <AppFooter />
        </div>
      </div>
    </div>
  );
};

// One unified verification page (Reoon-style): single email, paste-a-list, and
// CSV/TXT upload - all in one place.
// ---------------------------------------------------------------------------
// Column-mapping modal - shown after a file is picked, so the user can confirm
// which column holds the email, whether the first row is a header, and whether
// duplicates should be removed, before verification starts. Idea inspired by
// list-upload mappers (Reoon etc.), built for this app's own flow.
// ---------------------------------------------------------------------------
const EMAIL_RE_C = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_OPTIONS = ['Custom', 'Email', 'First Name', 'Last Name', 'Full Name', 'Company', 'Title', 'Phone'];

function guessField(header) {
  const h = String(header || '').toLowerCase();
  if (/e-?mail/.test(h)) return 'Email';
  if (/(first.?name|fname|given)/.test(h)) return 'First Name';
  if (/(last.?name|lname|surname|family)/.test(h)) return 'Last Name';
  if (/(full.?name|^name$)/.test(h)) return 'Full Name';
  if (/(company|organi[sz]ation|employer|account)/.test(h)) return 'Company';
  if (/(title|position|role|job)/.test(h)) return 'Title';
  if (/(phone|mobile|tel)/.test(h)) return 'Phone';
  return 'Custom';
}

// Small client-side CSV/TSV reader for the PREVIEW only (the server re-parses
// the real file). Handles quoted fields, escaped quotes, and , ; \t delimiters.
function parseCsvClient(text, maxRows = 8) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  const occ = (ch) => firstLine.split(ch).length - 1;
  const delim = occ('\t') > occ(',') && occ('\t') > occ(';') ? '\t' : occ(';') > occ(',') ? ';' : ',';

  const rows = [];
  let field = '', row = [], inQuotes = false;
  const pushRow = () => { row.push(field); field = ''; if (row.some(c => String(c).trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else field += ch;
  }
  if (rows.length < maxRows && (field !== '' || row.length)) pushRow();
  return rows;
}

const ColumnMapModal = ({ file, ctaLabel = 'Start Verification', onCancel, onStart }) => {
  const [rows, setRows] = useState(null);
  const [width, setWidth] = useState(0);
  const [labels, setLabels] = useState([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [dedupe, setDedupe] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (cancelled) return;
      const parsed = parseCsvClient(String(reader.result || ''), 8);
      if (!parsed.length) { setErr('The file looks empty or unreadable.'); setRows([]); return; }
      const w = parsed.reduce((m, r) => Math.max(m, r.length), 0);
      const rowHasEmail = (r) => r.some(c => EMAIL_RE_C.test(String(c || '').trim()));
      const detectedHeader = parsed.length > 1 && !rowHasEmail(parsed[0]) && parsed.slice(1).some(rowHasEmail);
      const dataRows = detectedHeader ? parsed.slice(1) : parsed;
      let emailCol = -1;
      for (let c = 0; c < w; c++) {
        if (dataRows.some(r => EMAIL_RE_C.test(String(r[c] || '').trim()))) { emailCol = c; break; }
      }
      const lbls = [];
      for (let c = 0; c < w; c++) {
        if (c === emailCol) lbls.push('Email');
        else lbls.push(detectedHeader ? guessField(parsed[0][c]) : 'Custom');
      }
      setRows(parsed); setWidth(w); setLabels(lbls); setHasHeader(detectedHeader); setErr('');
    };
    reader.onerror = () => { if (!cancelled) { setErr('Could not read the file.'); setRows([]); } };
    reader.readAsText(file);
    return () => { cancelled = true; };
  }, [file]);

  const setLabel = (c, v) => setLabels(prev => {
    const next = prev.slice();
    if (v === 'Email') for (let i = 0; i < next.length; i++) if (next[i] === 'Email') next[i] = 'Custom';
    next[c] = v;
    return next;
  });

  const start = () => {
    const emailCol = labels.indexOf('Email');
    if (emailCol === -1) { setErr('Please choose which column contains the email address.'); return; }
    onStart({ emailCol, hasHeader: hasHeader ? 'yes' : 'no', dedupe, labels });
  };

  const previewRows = rows ? (hasHeader ? rows.slice(1) : rows) : [];
  const cols = Array.from({ length: width }, (_, c) => c);

  return (
    <div className="colmap-overlay" onClick={onCancel}>
      <div className="colmap-modal" onClick={e => e.stopPropagation()}>
        <button className="colmap-close" onClick={onCancel} aria-label="Close"><X size={18} /></button>
        <h2 className="colmap-title">Match the columns in your file</h2>
        <p className="colmap-sub">Displaying the first few rows of your file:</p>
        <p className="colmap-file">{file?.name}</p>

        {!rows && !err && <p className="muted" style={{ textAlign: 'center', padding: '2rem' }}><Loader2 className="loader" size={18} /> Reading file…</p>}
        {err && <p className="colmap-err">{err}</p>}

        {rows && width > 0 && (
          <>
            <div className="colmap-tablewrap">
              <table className="colmap-table">
                <thead>
                  <tr>
                    {cols.map(c => (
                      <th key={c}>
                        <select className="colmap-select" value={labels[c] || 'Custom'} onChange={e => setLabel(c, e.target.value)}>
                          {FIELD_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 6).map((r, ri) => (
                    <tr key={ri}>
                      {cols.map(c => <td key={c}>{r[c] != null ? String(r[c]) : ''}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="colmap-conditions">
              <div className="colmap-cond">
                <span>Does your first row contain labels?</span>
                <label className="colmap-radio"><input type="radio" checked={hasHeader} onChange={() => setHasHeader(true)} /> Yes</label>
                <label className="colmap-radio"><input type="radio" checked={!hasHeader} onChange={() => setHasHeader(false)} /> No</label>
              </div>
              <p className="colmap-hint">If your file has a header on the first populated row, we'll skip it.</p>
              <div className="colmap-cond">
                <span>Can we remove duplicate emails?</span>
                <label className="colmap-radio"><input type="radio" checked={dedupe} onChange={() => setDedupe(true)} /> Yes</label>
                <label className="colmap-radio"><input type="radio" checked={!dedupe} onChange={() => setDedupe(false)} /> No</label>
              </div>
            </div>

            <div className="colmap-actions">
              <button className="btn-primary" onClick={start}>{ctaLabel}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Educational "learn" section shown at the bottom of the Email Verification
// page - explains what verification is, how to read a result, and why it matters.
const VERIFY_SIGNALS = [
  { icon: CheckCircle2, name: 'Syntax', desc: 'Confirms the address is formatted correctly before anything else.' },
  { icon: MailCheck, name: 'Deliverability', desc: 'Checks the address can actually receive mail.' },
  { icon: Shield, name: 'MX records', desc: "Verifies the domain's mail server accepts email." },
  { icon: AlertCircle, name: 'Catch-all', desc: 'Flags domains that accept everything but may go unread.' },
  { icon: Trash2, name: 'Disposable', desc: 'Detects temporary or throwaway addresses.' },
  { icon: ShieldCheck, name: 'Spam traps', desc: 'Identifies addresses that can blacklist your domain.' },
  { icon: Clock, name: 'Full inbox', desc: 'Spots accounts that are likely abandoned.' },
  { icon: User, name: 'Free provider', desc: 'Marks Gmail, Yahoo and other free addresses.' },
];
const VERIFY_WHY = [
  { icon: Star, title: 'Improve sender reputation', desc: 'Sending to invalid or inactive addresses pushes your bounce rate up, and mailbox providers notice. Verifying each address keeps bounces low and your reputation intact, so future emails keep landing in the inbox.' },
  { icon: Zap, title: 'Increase deliverability', desc: 'Risky addresses, full inboxes and dead domains all drag deliverability down. The verifier flags these before they cost you, so you only send to addresses worth sending to, lifting open and reply rates over time.' },
  { icon: ShieldCheck, title: 'Avoid spam folders', desc: 'Poor list quality, fake addresses and spam traps push messages into spam and trigger filters. Send to a clean, verified list and far more of your outreach lands where people actually read it.' },
];

const VerificationGuide = () => (
  <div className="vguide">
    <div className="card vguide-hero">
      <div className="vguide-hero-icon"><MailCheck size={26} /></div>
      <div>
        <h3>What is email verification?</h3>
        <p>Email verification checks whether an address exists, is active and is safe to send to, by looking at its syntax, domain, mail server and the risk signals tied to it. The goal is simple: confirm a real person sits behind the inbox before you hit send. Sending to bad addresses drives up bounces and quietly damages your sender reputation, so verifying first keeps your list clean and your emails landing where they should.</p>
      </div>
    </div>

    <div className="vguide-section">
      <h3>How to read your result</h3>
      <p className="muted">Every check returns a clear verdict and a confidence score from 0 to 100. A score in the 90s means the address is safe to send to. Below that, each signal is broken down so you see exactly <em>why</em> an address is safe or risky, not just a pass or fail.</p>
      <div className="vguide-signals">
        {VERIFY_SIGNALS.map((s) => (
          <div className="vguide-signal" key={s.name}>
            <span className="vguide-signal-icon"><s.icon size={18} /></span>
            <div><strong>{s.name}</strong><span>{s.desc}</span></div>
          </div>
        ))}
      </div>
    </div>

    <div className="vguide-section">
      <h3>Why email verification matters</h3>
      <div className="vguide-why">
        {VERIFY_WHY.map((w) => (
          <div className="card vguide-why-card" key={w.title}>
            <div className="vguide-why-icon"><w.icon size={22} /></div>
            <h4>{w.title}</h4>
            <p>{w.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const EmailVerification = () => {
  const { refreshUser } = useAuth();
  const [historyVersion, setHistoryVersion] = useState(0);
  const [results, setResults] = useState([]);
  const [resultsTitle, setResultsTitle] = useState('Results');
  const [progress, setProgress] = useState(null);

  const [email, setEmail] = useState('');
  const [singleLoading, setSingleLoading] = useState(false);

  const [bulkName, setBulkName] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  const [csvName, setCsvName] = useState('');
  const [file, setFile] = useState(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const fileInputRef = useRef(null);

  const pickFile = (f) => { if (f) { setFile(f); setShowMap(true); } };

  const verifySingle = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSingleLoading(true); setProgress(null);
    try {
      const data = await apiFetch('/verify', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      if (data.error) throw new Error(data.error);
      setResults([data]); setResultsTitle('Single result');
      await refreshUser(); setHistoryVersion(v => v + 1);
    } catch (err) { alert(err.message); }
    setSingleLoading(false);
  };

  // Shared runner for the two background-job flows (bulk / CSV).
  const runJob = async (submit, total, setLoading, title) => {
    setLoading(true); setResults([]); setProgress({ processed: 0, total });
    try {
      const job = await submit();
      if (job.error) throw new Error(job.error);
      setProgress({ processed: 0, total: job.total });
      const done = await pollJob(job.jobId, (p, t) => setProgress({ processed: p, total: t }));
      let out = done.results;
      if (!out && done.batchId) { const b = await apiFetch(`/history/${done.batchId}`); out = (b && b.results) || []; }
      setResults(out || []); setResultsTitle(title);
      await refreshUser(); setHistoryVersion(v => v + 1);
    } catch (err) { alert(err.message); }
    setProgress(null); setLoading(false);
    return true;
  };

  const verifyBulk = (e) => {
    e.preventDefault();
    const arr = bulkText.split('\n').map(s => s.trim()).filter(Boolean);
    if (!arr.length) return;
    runJob(
      () => apiFetch('/verify/bulk', { method: 'POST', body: JSON.stringify({ emails: arr, name: bulkName.trim() || undefined }) }),
      arr.length, setBulkLoading, 'Bulk results'
    );
  };

  const verifyCsv = (opts) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const nm = ((opts && opts.name) || csvName || '').trim();
    if (nm) fd.append('name', nm);
    if (opts) {
      fd.append('emailCol', String(opts.emailCol));
      fd.append('hasHeader', opts.hasHeader);
      fd.append('dedupe', opts.dedupe ? '1' : '0');
      fd.append('labels', JSON.stringify(opts.labels || []));
    }
    runJob(() => apiFetch('/verify/csv', { method: 'POST', body: fd }), 0, setCsvLoading, 'File results')
      .then(() => { setFile(null); setShowMap(false); });
  };

  return (
    <div>
      <p className="muted" style={{ marginTop: '0', marginBottom: '1.5rem' }}>
        Verify a single address, paste a list, or upload a file, all in one place.
      </p>

      {/* Single email */}
      <div className="card verify-single-card">
        <form onSubmit={verifySingle}>
          <label>Verify a single email</label>
          <div className="verify-single-row">
            <input type="email" className="input-field" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={singleLoading}>
              {singleLoading ? <Loader2 className="loader" size={18} /> : <Search size={18} />} Verify
            </button>
          </div>
        </form>
      </div>

      {/* Bulk paste + file upload */}
      <div className="verify-grid">
        <div className="card">
          <div className="verify-opt-title"><List size={17} /> Paste a list</div>
          <form onSubmit={verifyBulk} className="form-group">
            <label>Task Name <span className="muted-inline">(optional)</span></label>
            <input type="text" className="input-field" value={bulkName} onChange={e => setBulkName(e.target.value)} placeholder="e.g. July Newsletter" maxLength={120} />
            <label style={{ marginTop: '0.9rem' }}>Email addresses (one per line)</label>
            <textarea className="input-field" style={{ minHeight: '170px' }} value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder={"one@example.com\ntwo@example.com"} />
            <button type="submit" className="btn-primary" disabled={bulkLoading} style={{ marginTop: '1rem' }}>
              {bulkLoading ? <Loader2 className="loader" size={18} /> : <List size={18} />} Start Verification
            </button>
          </form>
        </div>

        <div className="card">
          <div className="verify-opt-title"><Upload size={17} /> Upload a file</div>
          <div className="form-group">
            <label>Task Name <span className="muted-inline">(optional)</span></label>
            <input type="text" className="input-field" value={csvName} onChange={e => setCsvName(e.target.value)} placeholder="e.g. CRM export Q3" maxLength={120} />
          </div>
          <div
            className="upload-area"
            onClick={() => fileInputRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
            onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if (e.dataTransfer.files && e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); }}
          >
            <input type="file" accept=".csv,.txt" ref={fileInputRef} onChange={e => { pickFile(e.target.files[0]); e.target.value = ''; }} style={{ display: 'none' }} />
            <Upload size={40} color="var(--accent-color)" />
            <p style={{ fontWeight: 500, margin: '0.5rem 0 0.25rem' }}>{file ? file.name : 'Drag & drop, or click to browse'}</p>
            <span className="muted-inline">CSV (any columns) or TXT (one email per line)</span>
          </div>
          <button onClick={() => file && setShowMap(true)} className="btn-primary" disabled={!file || csvLoading} style={{ marginTop: '1rem' }}>
            {csvLoading ? <Loader2 className="loader" size={18} /> : <Upload size={18} />} Start Verification
          </button>
        </div>
      </div>

      {showMap && file && (
        <ColumnMapModal
          file={file}
          ctaLabel="Start Verification"
          onCancel={() => setShowMap(false)}
          onStart={(opts) => { setShowMap(false); verifyCsv(opts); }}
        />
      )}

      {progress && <JobProgress processed={progress.processed} total={progress.total} />}
      {results.length > 0 && <ResultsTable results={results} title={resultsTitle} />}

      <HistoryPanel version={historyVersion} />

      <VerificationGuide />
    </div>
  );
};

// Upload any file → get the estimated bounce rate and a deliverability breakdown.
const BounceChecker = () => {
  const { refreshUser } = useAuth();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [mode, setMode] = useState('fast');
  const fileInputRef = useRef(null);

  const pickFile = (f) => { if (f) { setFile(f); setShowMap(true); } };

  const run = async (opts) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', mode);
    if (opts) {
      fd.append('emailCol', String(opts.emailCol));
      fd.append('hasHeader', opts.hasHeader);
      fd.append('dedupe', opts.dedupe ? '1' : '0');
      fd.append('labels', JSON.stringify(opts.labels || []));
      if (opts.name) fd.append('name', opts.name);
    }
    setShowMap(false);
    setLoading(true); setResults(null); setProgress({ processed: 0, total: 0 });
    try {
      const job = await apiFetch('/bounce/csv', { method: 'POST', body: fd });
      if (job.error) throw new Error(job.error);
      setProgress({ processed: 0, total: job.total });
      const done = await pollJob(job.jobId, (p, t) => setProgress({ processed: p, total: t }));
      let out = done.results;
      if (!out && done.batchId) { const b = await apiFetch(`/history/${done.batchId}`); out = (b && b.results) || []; }
      setResults(out || []);
      await refreshUser();
    } catch (err) { alert(friendlyError(err)); }
    setProgress(null); setLoading(false);
  };

  const summary = React.useMemo(() => {
    if (!results) return null;
    const s = { total: results.length, valid: 0, invalid: 0, catchAll: 0, unknown: 0 };
    for (const r of results) {
      // Bucket the fine-grained statuses the same way the backend does:
      // safe/role -> valid, invalid/disabled/disposable -> invalid,
      // catch-all -> catchAll, everything else (inbox_full/spamtrap/unknown) -> unknown.
      if (r.status === 'safe' || r.status === 'role' || r.status === 'valid') s.valid++;
      else if (r.status === 'invalid' || r.status === 'disabled' || r.status === 'disposable') s.invalid++;
      else if (r.status === 'catch-all') s.catchAll++;
      else s.unknown++;
    }
    const pct = (n) => s.total ? Math.round((n / s.total) * 100) : 0;
    const rawBounce = s.total ? (s.invalid / s.total) * 100 : 0;
    return { ...s, bounceRate: pct(s.invalid), rawBounce, deliverable: pct(s.valid), risky: pct(s.catchAll + s.unknown) };
  }, [results]);

  const bounceColor = summary ? (summary.rawBounce < 3 ? '#059669' : summary.rawBounce <= 10 ? '#d97706' : '#dc2626') : '#64748b';

  // NeverBounce-style headline label + friendly verdict message.
  const bounceLabel = !summary ? '' : summary.invalid === 0 ? '0%' : summary.rawBounce < 1 ? 'Less than 1%' : `${Math.round(summary.rawBounce)}%`;
  const verdict = !summary ? null
    : summary.rawBounce < 3 ? { msg: 'Congrats! This list may not require cleaning.', color: '#059669' }
    : summary.rawBounce <= 8 ? { msg: 'Looks decent. A light clean-up could lower your bounce rate.', color: '#d97706' }
    : summary.rawBounce <= 20 ? { msg: 'Consider cleaning this list before your next send.', color: '#d97706' }
    : { msg: 'This list needs cleaning to protect your sender reputation.', color: '#dc2626' };

  return (
    <div>
      <p className="muted" style={{ marginTop: '0', marginBottom: '1.5rem' }}>
        Upload any list (CSV or TXT) for a <strong>free</strong> bounce-rate analysis. No credits used.
        Pick <strong>Fast</strong> for a near-instant estimate, or <strong>Accurate</strong> for a real mailbox-level SMTP check.
      </p>

      <div className="card ba-upload">
        <div className="ba-mode">
          <button
            type="button"
            className={`ba-mode-opt ${mode === 'fast' ? 'active' : ''}`}
            onClick={() => setMode('fast')}
          >
            <Zap size={16} /> <span><strong>Fast estimate</strong><em>Syntax + mail-server + disposable · instant</em></span>
          </button>
          <button
            type="button"
            className={`ba-mode-opt ${mode === 'accurate' ? 'active' : ''}`}
            onClick={() => setMode('accurate')}
          >
            <ShieldCheck size={16} /> <span><strong>Accurate</strong><em>Full SMTP mailbox check · slower</em></span>
          </button>
        </div>

        <div
          className="upload-area"
          onClick={() => fileInputRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
          onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if (e.dataTransfer.files && e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); }}
        >
          <input type="file" accept=".csv,.txt" ref={fileInputRef} onChange={e => { pickFile(e.target.files[0]); e.target.value = ''; }} style={{ display: 'none' }} />
          <Upload size={40} color="var(--accent-color)" />
          <p style={{ fontWeight: 500, margin: '0.5rem 0 0.25rem' }}>{file ? file.name : 'Drag & drop, or click to browse'}</p>
          <span className="muted-inline">CSV (any columns) or TXT (one email per line)</span>
        </div>
        <button onClick={() => file && setShowMap(true)} className="btn-primary" disabled={!file || loading} style={{ marginTop: '1rem' }}>
          {loading ? <Loader2 className="loader" size={18} /> : <AlertCircle size={18} />} Check Bounce Rate
        </button>
        {progress && <JobProgress processed={progress.processed} total={progress.total} />}
      </div>

      {showMap && file && (
        <ColumnMapModal
          file={file}
          ctaLabel="Check Bounce Rate"
          onCancel={() => setShowMap(false)}
          onStart={(opts) => run(opts)}
        />
      )}

      {summary && (
        <div className="card ba-result">
          <div className="ba-result-head">Your Free Analysis Results <HelpCircle size={15} color="var(--text-secondary)" /></div>

          <div className="ba-verdict">
            <span className="ba-verdict-label">Estimated Bounce Rate:</span>
            <span className="ba-verdict-value" style={{ color: bounceColor }}>{bounceLabel}</span>
          </div>
          {verdict && <p className="ba-verdict-msg" style={{ color: verdict.color }}>{verdict.msg}</p>}

          <div className="ba-bar" role="img" aria-label="Deliverability breakdown">
            {summary.deliverable > 0 && <div style={{ width: `${summary.deliverable}%`, background: '#10b981' }} title={`Deliverable ${summary.deliverable}%`} />}
            {summary.risky > 0 && <div style={{ width: `${summary.risky}%`, background: '#f59e0b' }} title={`Risky ${summary.risky}%`} />}
            {summary.bounceRate > 0 && <div style={{ width: `${summary.bounceRate}%`, background: '#ef4444' }} title={`Undeliverable ${summary.bounceRate}%`} />}
          </div>
          <div className="ba-legend">
            <span><i style={{ background: '#10b981' }} /> Deliverable <strong>{summary.deliverable}%</strong></span>
            <span><i style={{ background: '#f59e0b' }} /> Risky <strong>{summary.risky}%</strong></span>
            <span><i style={{ background: '#ef4444' }} /> Undeliverable <strong>{summary.bounceRate}%</strong></span>
          </div>

          <div className="ba-tiles">
            <div className="ba-tile"><div className="ba-tile-num" style={{ color: '#059669' }}>{summary.valid.toLocaleString()}</div><div className="ba-tile-lbl">Valid</div></div>
            <div className="ba-tile"><div className="ba-tile-num" style={{ color: '#dc2626' }}>{summary.invalid.toLocaleString()}</div><div className="ba-tile-lbl">Invalid</div></div>
            <div className="ba-tile"><div className="ba-tile-num" style={{ color: '#d97706' }}>{summary.catchAll.toLocaleString()}</div><div className="ba-tile-lbl">Catch-all</div></div>
            <div className="ba-tile"><div className="ba-tile-num" style={{ color: '#64748b' }}>{summary.unknown.toLocaleString()}</div><div className="ba-tile-lbl">Unknown</div></div>
            <div className="ba-tile"><div className="ba-tile-num">{summary.total.toLocaleString()}</div><div className="ba-tile-lbl">Total</div></div>
          </div>

          <div className="ba-result-actions">
            <span className="muted-inline">{mode === 'accurate' ? 'Accurate mode · real SMTP mailbox check' : 'Fast mode · domain-level estimate'}</span>
            <button className="btn-secondary" onClick={() => downloadCSV(results, 'bounce_check.csv')}>
              <Download size={15} /> Download full results
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Catch-All Verifier -----------------------------------------------------
// A dedicated tool for the hard case: catch-all domains. It deep-resolves each
// address and reports whether a catch-all is actually deliverable, still risky,
// undeliverable, or simply not a catch-all (verify those normally).
const CATCHALL_BUCKET = (status) => {
  if (status === 'safe' || status === 'role') return 'deliverable';
  if (status === 'catch-all') return 'catchall';
  if (status === 'invalid' || status === 'disabled') return 'undeliverable';
  if (status === 'not_catch_all') return 'notCatchAll';
  return 'other';
};

const CatchAllVerifier = () => {
  const { refreshUser } = useAuth();
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(null);

  const [email, setEmail] = useState('');
  const [singleLoading, setSingleLoading] = useState(false);

  const [bulkText, setBulkText] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  const [file, setFile] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const fileInputRef = useRef(null);
  const pickFile = (f) => { if (f) { setFile(f); setShowMap(true); } };

  const verifySingle = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSingleLoading(true); setProgress(null);
    try {
      const data = await apiFetch('/catchall', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      if (data.error) throw new Error(data.error);
      setResults([data]);
      await refreshUser();
    } catch (err) { alert(friendlyError(err)); }
    setSingleLoading(false);
  };

  const runJob = async (submit, total, setLoading) => {
    setLoading(true); setResults([]); setProgress({ processed: 0, total });
    try {
      const job = await submit();
      if (job.error) throw new Error(job.error);
      setProgress({ processed: 0, total: job.total });
      const done = await pollJob(job.jobId, (p, t) => setProgress({ processed: p, total: t }));
      let out = done.results;
      if (!out && done.batchId) { const b = await apiFetch(`/history/${done.batchId}`); out = (b && b.results) || []; }
      setResults(out || []);
      await refreshUser();
    } catch (err) { alert(friendlyError(err)); }
    setProgress(null); setLoading(false);
  };

  const verifyBulk = (e) => {
    e.preventDefault();
    const arr = bulkText.split('\n').map(s => s.trim()).filter(Boolean);
    if (!arr.length) return;
    runJob(() => apiFetch('/catchall/bulk', { method: 'POST', body: JSON.stringify({ emails: arr }) }), arr.length, setBulkLoading);
  };

  const verifyCsv = (opts) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    if (opts) {
      fd.append('emailCol', String(opts.emailCol));
      fd.append('hasHeader', opts.hasHeader);
      fd.append('dedupe', opts.dedupe ? '1' : '0');
      fd.append('labels', JSON.stringify(opts.labels || []));
    }
    runJob(() => apiFetch('/catchall/csv', { method: 'POST', body: fd }), 0, setCsvLoading)
      .then(() => { setFile(null); setShowMap(false); });
  };

  const summary = React.useMemo(() => {
    if (!results.length) return null;
    const s = { total: results.length, deliverable: 0, catchall: 0, undeliverable: 0, notCatchAll: 0, other: 0 };
    for (const r of results) s[CATCHALL_BUCKET(r.status)]++;
    return s;
  }, [results]);

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, marginBottom: '1.5rem' }}>
        Catch-all domains accept every address, so standard SMTP can't tell a real mailbox from a fake one.
        This tool deep-resolves them using Microsoft&nbsp;365 signals and SMTP reply-differencing, so a catch-all can come back
        <strong> deliverable</strong> instead of just “risky”. Addresses that aren't catch-all are flagged so you verify them normally.
      </p>

      <div className="card verify-single-card">
        <form onSubmit={verifySingle}>
          <label>Verify a single catch-all address</label>
          <div className="verify-single-row">
            <input type="email" className="input-field" placeholder="name@catch-all-domain.com" value={email} onChange={e => setEmail(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={singleLoading}>
              {singleLoading ? <Loader2 className="loader" size={18} /> : <Search size={18} />} Verify
            </button>
          </div>
        </form>
      </div>

      <div className="verify-grid">
        <div className="card">
          <div className="verify-opt-title"><List size={17} /> Paste a list</div>
          <form onSubmit={verifyBulk} className="form-group">
            <label>Catch-all addresses (one per line)</label>
            <textarea className="input-field" style={{ minHeight: '170px' }} value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder={"one@domain.com\ntwo@domain.com"} />
            <button type="submit" className="btn-primary" disabled={bulkLoading} style={{ marginTop: '1rem' }}>
              {bulkLoading ? <Loader2 className="loader" size={18} /> : <List size={18} />} Start Verification
            </button>
          </form>
        </div>

        <div className="card">
          <div className="verify-opt-title"><Upload size={17} /> Upload a file</div>
          <div className="upload-area" onClick={() => fileInputRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
            onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if (e.dataTransfer.files && e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); }}>
            <input type="file" accept=".csv,.txt" ref={fileInputRef} onChange={e => { pickFile(e.target.files[0]); e.target.value = ''; }} style={{ display: 'none' }} />
            <Upload size={40} color="var(--accent-color)" />
            <p style={{ fontWeight: 500, margin: '0.5rem 0 0.25rem' }}>{file ? file.name : 'Drag & drop, or click to browse'}</p>
            <span className="muted-inline">CSV (any columns) or TXT (one email per line)</span>
          </div>
          <button onClick={() => file && setShowMap(true)} className="btn-primary" disabled={!file || csvLoading} style={{ marginTop: '1rem' }}>
            {csvLoading ? <Loader2 className="loader" size={18} /> : <Upload size={18} />} Start Verification
          </button>
        </div>
      </div>

      {showMap && file && <ColumnMapModal file={file} ctaLabel="Start Verification" onCancel={() => setShowMap(false)} onStart={(opts) => { setShowMap(false); verifyCsv(opts); }} />}

      {progress && <JobProgress processed={progress.processed} total={progress.total} />}

      {summary && (
        <div className="card ca-summary">
          <div className="ca-tiles">
            <div className="ca-tile"><div className="ca-num" style={{ color: '#059669' }}>{summary.deliverable.toLocaleString()}</div><div className="ca-lbl">Deliverable</div></div>
            <div className="ca-tile"><div className="ca-num" style={{ color: '#d97706' }}>{summary.catchall.toLocaleString()}</div><div className="ca-lbl">Still catch-all</div></div>
            <div className="ca-tile"><div className="ca-num" style={{ color: '#dc2626' }}>{summary.undeliverable.toLocaleString()}</div><div className="ca-lbl">Undeliverable</div></div>
            <div className="ca-tile"><div className="ca-num" style={{ color: '#64748b' }}>{summary.notCatchAll.toLocaleString()}</div><div className="ca-lbl">Not catch-all</div></div>
            <div className="ca-tile"><div className="ca-num">{summary.total.toLocaleString()}</div><div className="ca-lbl">Total</div></div>
          </div>
        </div>
      )}

      {results.length > 0 && <ResultsTable results={results} title="Catch-all results" />}
    </div>
  );
};

// --- Buy Credits / Billing --------------------------------------------------
const BillingPage = () => {
  const { user, refreshUser } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [packId, setPackId] = useState('starter');
  const [method, setMethod] = useState('stripe');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('paid')) return { ok: true, text: 'Payment received. Your credits will appear shortly.' };
    if (p.get('canceled')) return { ok: false, text: 'Checkout was canceled.' };
    return null;
  });

  useEffect(() => { apiFetch('/billing/config').then(setCfg).catch(() => setCfg({ packs: [], methods: {} })); }, []);
  useEffect(() => {
    // If we came back from a successful checkout, refresh the credit balance.
    if (new URLSearchParams(window.location.search).get('paid')) refreshUser();
  }, [refreshUser]);

  if (!cfg) return <p className="muted"><Loader2 className="loader" size={16} /> Loading…</p>;
  const pack = cfg.packs.find(p => p.id === packId) || cfg.packs[0];

  const pay = async () => {
    if (!pack) return;
    setLoading(true); setNotice(null);
    try {
      if (method === 'stripe') {
        const r = await apiFetch('/billing/checkout', { method: 'POST', body: JSON.stringify({ packId: pack.id }) });
        if (r.error) throw new Error(r.error);
        if (r.url) window.location.href = r.url;
      } else {
        const r = await apiFetch('/billing/manual', { method: 'POST', body: JSON.stringify({ packId: pack.id, method }) });
        if (r.error) throw new Error(r.error);
        setNotice({ ok: true, text: r.message, reference: r.reference });
      }
    } catch (err) { setNotice({ ok: false, text: friendlyError(err) }); }
    setLoading(false);
  };

  const METHODS = [
    { id: 'stripe', label: 'Card (Stripe)', icon: Zap, hint: 'Instant: Visa, Mastercard, Amex' },
    { id: 'wise', label: 'Wise', icon: RefreshCw, hint: 'Low-fee international transfer' },
    { id: 'bank', label: 'Bank transfer', icon: Scale, hint: 'International / SWIFT' },
  ];

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, marginBottom: '1.5rem' }}>
        Buy verification credits. Current balance: <strong>{(user?.credits ?? 0).toLocaleString()}</strong> credits.
        Pay by card for instant top-up, or by Wise / international bank transfer.
      </p>

      {notice && (
        <div className={`bill-notice ${notice.ok ? 'ok' : 'err'}`}>
          {notice.ok ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <div>{notice.text}{notice.reference && <> Reference: <strong>{notice.reference}</strong></>}</div>
        </div>
      )}

      <h3 className="bill-h">1. Choose a credit pack</h3>
      <div className="bill-packs">
        {cfg.packs.map(p => (
          <button key={p.id} className={`bill-pack ${packId === p.id ? 'active' : ''}`} onClick={() => setPackId(p.id)}>
            {p.tag && <div className="bill-pack-tag">{p.tag}</div>}
            <div className="bill-pack-name">{p.name}</div>
            <div className="bill-pack-credits">{p.credits.toLocaleString()} <span>credits</span></div>
            <div className="bill-pack-price">${p.price}</div>
            <div className="bill-pack-unit">${(p.price / p.credits * 1000).toFixed(2)} / 1k · same as the pricing page</div>
          </button>
        ))}
      </div>

      <h3 className="bill-h">2. Choose a payment method</h3>
      <div className="bill-methods">
        {METHODS.map(m => (
          <button key={m.id} className={`bill-method ${method === m.id ? 'active' : ''}`} onClick={() => setMethod(m.id)}>
            <m.icon size={18} />
            <div><strong>{m.label}</strong><span>{m.hint}</span></div>
          </button>
        ))}
      </div>

      {method === 'wise' && (
        <div className="bill-detail card">
          {cfg.wise ? (
            <>
              <p>Send your payment via Wise to:</p>
              {cfg.wise.email && <p><strong>Wise email:</strong> {cfg.wise.email}</p>}
              {cfg.wise.url && <p><a href={cfg.wise.url} target="_blank" rel="noreferrer">Open Wise payment link →</a></p>}
              <p className="muted-inline">Click “I've sent the payment” to get a reference. Credits are added once the transfer clears.</p>
            </>
          ) : <p className="muted">Wise details will be shared with your reference after you click below.</p>}
        </div>
      )}
      {method === 'bank' && (
        <div className="bill-detail card">
          {cfg.bank ? (
            <table className="bill-bank">
              <tbody>
                {cfg.bank.holder && <tr><td>Account holder</td><td>{cfg.bank.holder}</td></tr>}
                {cfg.bank.bankName && <tr><td>Bank</td><td>{cfg.bank.bankName}</td></tr>}
                {cfg.bank.account && <tr><td>Account no.</td><td>{cfg.bank.account}</td></tr>}
                {cfg.bank.iban && <tr><td>IBAN</td><td>{cfg.bank.iban}</td></tr>}
                {cfg.bank.swift && <tr><td>SWIFT/BIC</td><td>{cfg.bank.swift}</td></tr>}
                {cfg.bank.notes && <tr><td>Notes</td><td>{cfg.bank.notes}</td></tr>}
              </tbody>
            </table>
          ) : <p className="muted">International bank details will be shared with your reference after you click below.</p>}
        </div>
      )}

      <div className="bill-cta">
        <div>
          <div className="bill-cta-sum">{pack ? `${pack.credits.toLocaleString()} credits` : '-'}</div>
          <div className="muted-inline">{pack ? `${pack.name} pack` : ''}</div>
        </div>
        <button className="btn-primary" onClick={pay} disabled={loading || !pack}>
          {loading ? <Loader2 className="loader" size={18} /> : <Lock size={16} />}
          {method === 'stripe' ? `Pay $${pack ? pack.price : ''} by card` : "I've sent the payment"}
        </button>
      </div>

      <p className="muted-inline" style={{ display: 'block', marginTop: '1rem' }}>
        Payments are processed securely. For manual methods (Wise / bank), your credits are added after we confirm the transfer.
      </p>
    </div>
  );
};

const StatCard = ({ label, value, accent }) => (
  <div className="card" style={{padding:'2rem'}}>
    <div style={{color:'var(--text-secondary)', fontWeight:500}}>{label}</div>
    <div style={{fontSize:'2.5rem', fontWeight:700, color: accent || 'var(--text-primary)', marginTop:'0.5rem'}}>{value}</div>
  </div>
);

// Reoon-style "Lifetime Usage Statistics" donut. Pure SVG, no chart library.
// `segments` = [{ label, value, color }]. Renders a doughnut with the grand
// total in the middle and a legend on the side.
const DonutBreakdown = ({ segments, total }) => {
  const size = 200, stroke = 30, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const sum = segments.reduce((a, s) => a + s.value, 0) || 1;
  // Precompute each arc's length and starting offset (no mutation during render).
  const arcs = [];
  let running = 0;
  for (const s of segments) {
    if (s.value > 0) { arcs.push({ ...s, len: (s.value / sum) * c, offset: running }); running += (s.value / sum) * c; }
  }
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-svg">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border-color)" strokeWidth={stroke} />
          {arcs.map((a, i) => (
            <circle key={i} cx={size/2} cy={size/2} r={r} fill="none"
              stroke={a.color} strokeWidth={stroke}
              strokeDasharray={`${a.len} ${c - a.len}`} strokeDashoffset={-a.offset} />
          ))}
        </g>
        <text x="50%" y="46%" textAnchor="middle" className="donut-center-label">total</text>
        <text x="50%" y="58%" textAnchor="middle" className="donut-center-total">{total.toLocaleString()}</text>
      </svg>
      <div className="donut-legend">
        {segments.map((s, i) => (
          <div key={i} className="donut-legend-row">
            <span className="donut-dot" style={{ background: s.color }} />
            <span className="donut-legend-label">{s.label}:</span>
            <strong>{s.value.toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </div>
  );
};

const DashboardHome = () => {
  const { user, refreshUser } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    refreshUser(); // always show live credits when landing on Overview
    apiFetch('/history/stats/overview').then(d => { if (d && !d.error) setStats(d); }).catch(() => {});
  }, [refreshUser]);

  const totalEmails = stats?.totalEmails ?? 0;
  const counts = stats?.counts || { valid: 0, invalid: 0, catchAll: 0, unknown: 0, disposable: 0 };
  const validRate = totalEmails > 0 ? Math.round((counts.valid / totalEmails) * 100) : 0;
  // "Invalid" slice excludes disposable so the two don't double-count.
  const invalidOnly = Math.max((counts.invalid || 0) - (counts.disposable || 0), 0);
  const segments = [
    { label: 'Valid', value: counts.valid || 0, color: '#059669' },
    { label: 'Catch-all', value: counts.catchAll || 0, color: '#d97706' },
    { label: 'Disposable', value: counts.disposable || 0, color: '#7c3aed' },
    { label: 'Invalid', value: invalidOnly, color: '#dc2626' },
    { label: 'Unknown', value: counts.unknown || 0, color: '#64748b' },
  ];

  return (
    <div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:'1.5rem'}}>
        <StatCard label="Available Credits" value={(user?.credits ?? 0).toLocaleString()} accent="var(--accent-color)" />
        <StatCard label="Emails Verified (30d)" value={totalEmails.toLocaleString()} />
        <StatCard label="Lists Cleaned (30d)" value={stats?.listsCleaned ?? 0} />
        <StatCard label="Valid Rate (30d)" value={`${validRate}%`} accent="#059669" />
      </div>

      <div className="card" style={{padding:'2rem', marginTop:'1.5rem'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.5rem', flexWrap:'wrap', gap:'0.5rem'}}>
          <h3 style={{fontSize:'1.15rem'}}>Usage Statistics</h3>
          <span style={{color:'var(--text-secondary)', fontSize:'0.9rem'}}>last {stats?.retentionDays ?? 30} days · {stats?.executions ?? 0} executions</span>
        </div>
        {totalEmails > 0 ? (
          <DonutBreakdown segments={segments} total={totalEmails} />
        ) : (
          <div className="history-empty">No verifications yet. Run a check from <strong>Email Verification</strong> and your stats will appear here.</div>
        )}
      </div>
    </div>
  );
};

// --- Profile Settings (self-only, available to every signed-in user) ---

const ACCOUNT_ROLE_LABELS = { user: 'User', admin: 'Admin', superadmin: 'Super Admin' };
const EMPTY_PROFILE = { firstName: '', lastName: '', phone: '', address: '', city: '', zip: '', country: '', state: '' };
const COUNTRIES = ['Bangladesh','India','Pakistan','Nepal','Sri Lanka','United States','United Kingdom','Canada','Australia','Germany','France','Italy','Spain','Netherlands','Sweden','Norway','Denmark','Ireland','Switzerland','Austria','Belgium','Portugal','Poland','Russia','Ukraine','Turkey','United Arab Emirates','Saudi Arabia','Qatar','Kuwait','Malaysia','Singapore','Indonesia','Thailand','Vietnam','Philippines','China','Japan','South Korea','Hong Kong','Brazil','Mexico','Argentina','South Africa','Nigeria','Kenya','Egypt','New Zealand'];

// A labelled input with a leading lock icon and a show/hide (eye) toggle.
const PasswordInput = ({ label, value, onChange, placeholder }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="pw-field">
        <Lock size={15} className="pw-lock" />
        <input type={show ? 'text' : 'password'} className="input-field" value={value} onChange={onChange} placeholder={placeholder} />
        <button type="button" className="pw-eye" onClick={() => setShow(s => !s)} tabIndex={-1} aria-label={show ? 'Hide' : 'Show'}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
};

const MyAccount = () => {
  const { user, setUser, refreshUser } = useAuth();
  const [form, setForm] = useState(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErr, setPwErr] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [stats, setStats] = useState(null);
  // 2FA (authenticator app) enrolment state
  const [tfEnabled, setTfEnabled] = useState(false);
  const [tfSetup, setTfSetup] = useState(null);   // {secret, qrDataUrl} while enrolling
  const [tfCode, setTfCode] = useState('');
  const [tfBusy, setTfBusy] = useState(false);
  const [tfErr, setTfErr] = useState('');
  const [tfDisabling, setTfDisabling] = useState(false);

  // Populate the form from the loaded profile.
  useEffect(() => {
    if (!user) return;
    setForm({
      firstName: user.firstName || '', lastName: user.lastName || '', phone: user.phone || '',
      address: user.address || '', city: user.city || '', zip: user.zip || '',
      country: user.country || '', state: user.state || '',
    });
  }, [user]);

  useEffect(() => {
    refreshUser(); // live credits/role on this page
    apiFetch('/history/stats/overview').then(d => { if (d && !d.error) setStats(d); }).catch(() => {});
  }, [refreshUser]);

  // Reflect the account's 2FA status whenever the user loads/refreshes.
  useEffect(() => { setTfEnabled(!!user?.totpEnabled); }, [user?.totpEnabled]);

  // 2FA: start enrolment - fetch a secret + QR to display.
  const startTwoFactor = async () => {
    setTfErr(''); setTfBusy(true);
    try {
      const data = await apiFetch('/auth/2fa/totp/setup', { method: 'POST' });
      if (data.error) throw new Error(data.error);
      setTfSetup({ secret: data.secret, qrDataUrl: data.qrDataUrl });
      setTfCode('');
    } catch (err) { setTfErr(friendlyError(err)); }
    setTfBusy(false);
  };

  // 2FA: verify the first code and turn it on.
  const enableTwoFactor = async (e) => {
    e.preventDefault();
    setTfErr(''); setTfBusy(true);
    try {
      const data = await apiFetch('/auth/2fa/totp/enable', { method: 'POST', body: JSON.stringify({ code: tfCode }) });
      if (data.error) throw new Error(data.error);
      setTfEnabled(true); setTfSetup(null); setTfCode('');
      refreshUser();
    } catch (err) { setTfErr(friendlyError(err)); }
    setTfBusy(false);
  };

  // 2FA: turn it off - requires a current code.
  const disableTwoFactor = async (e) => {
    e.preventDefault();
    setTfErr(''); setTfBusy(true);
    try {
      const data = await apiFetch('/auth/2fa/totp/disable', { method: 'POST', body: JSON.stringify({ code: tfCode }) });
      if (data.error) throw new Error(data.error);
      setTfEnabled(false); setTfDisabling(false); setTfCode('');
      refreshUser();
    } catch (err) { setTfErr(friendlyError(err)); }
    setTfBusy(false);
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true); setSavedMsg('');
    try {
      const data = await apiFetch('/auth/profile', { method: 'PATCH', body: JSON.stringify(form) });
      if (data.error) throw new Error(data.error);
      setUser(data);            // refresh nav name/avatar immediately
      setSavedMsg('Saved!');
      setTimeout(() => setSavedMsg(''), 2500);
    } catch (err) { alert(friendlyError(err)); }
    setSaving(false);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwErr(''); setPwMsg('');
    if (pw.next.length < 8) { setPwErr('New password must be at least 8 characters.'); return; }
    if (pw.next !== pw.confirm) { setPwErr('New passwords do not match.'); return; }
    setPwSaving(true);
    try {
      const data = await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }) });
      if (data.error) throw new Error(data.error);
      setPwMsg('Password updated.'); setPw({ current: '', next: '', confirm: '' });
      setTimeout(() => setPwMsg(''), 3000);
    } catch (err) { setPwErr(friendlyError(err)); }
    setPwSaving(false);
  };

  const initial = ((user?.firstName || user?.email || '?').charAt(0)).toUpperCase();
  const totalEmails = stats?.totalEmails ?? 0;
  const valid = stats?.counts?.valid ?? 0;
  const validRate = totalEmails > 0 ? Math.round((valid / totalEmails) * 100) : 0;

  return (
    <div>
      <p style={{color:'var(--text-secondary)', marginTop:'0', marginBottom:'1.25rem'}}>
        Add or change information of your account. Only you can see this.
      </p>

      <div className="profile-grid">
        {/* My Information + My Address */}
        <div className="card" style={{padding:'2rem'}}>
          <h3 style={{fontSize:'1.15rem'}}>My Information</h3>
          <p className="muted">Basic details for your account</p>
          <form onSubmit={saveProfile}>
            <div className="profile-id-row">
              <div className="account-avatar lg">{initial}</div>
              <div className="two-col" style={{flex:1}}>
                <div className="field"><label>First Name</label><input className="input-field" value={form.firstName} onChange={set('firstName')} placeholder="First name" /></div>
                <div className="field"><label>Last Name</label><input className="input-field" value={form.lastName} onChange={set('lastName')} placeholder="Last name" /></div>
                <div className="field"><label>Email</label><input className="input-field" value={user?.email || ''} disabled title="Email can't be changed" /></div>
                <div className="field"><label>Phone</label><input className="input-field" value={form.phone} onChange={set('phone')} placeholder="Phone number" /></div>
              </div>
            </div>

            <h3 style={{fontSize:'1.15rem', marginTop:'1.5rem'}}>My Address</h3>
            <p className="muted">Where we can reach you if needed</p>
            <div className="addr-row1">
              <div className="field"><label>Address</label><input className="input-field" value={form.address} onChange={set('address')} placeholder="Street address" /></div>
              <div className="field"><label>City</label><input className="input-field" value={form.city} onChange={set('city')} /></div>
            </div>
            <div className="three-col">
              <div className="field"><label>ZIP</label><input className="input-field" value={form.zip} onChange={set('zip')} /></div>
              <div className="field"><label>Country</label>
                <select className="input-field" value={form.country} onChange={set('country')}>
                  <option value="">Select country</option>
                  {(COUNTRIES.includes(form.country) || !form.country ? COUNTRIES : [form.country, ...COUNTRIES]).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>State</label><input className="input-field" value={form.state} onChange={set('state')} placeholder="State / region" /></div>
            </div>

            <div className="save-row">
              {savedMsg && <span className="save-ok"><CheckCircle2 size={16}/> {savedMsg}</span>}
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <Loader2 className="loader" size={16}/> : null} Save All Information
              </button>
            </div>
          </form>
        </div>

        {/* Password + 2FA */}
        <div className="profile-side">
          <div className="card" style={{padding:'2rem'}}>
            <h3 style={{fontSize:'1.15rem'}}>Update Account Password</h3>
            {pwErr && <div className="auth-error" style={{marginTop:'0.75rem'}}><AlertCircle size={16}/> {pwErr}</div>}
            {pwMsg && <div className="auth-success" style={{marginTop:'0.75rem'}}><CheckCircle2 size={18} color="#059669"/> <div>{pwMsg}</div></div>}
            <form onSubmit={changePassword} style={{marginTop:'1rem'}}>
              <PasswordInput label="Current Password" value={pw.current} onChange={e=>setPw(p=>({...p, current:e.target.value}))} placeholder="Current password" />
              <PasswordInput label="New Password" value={pw.next} onChange={e=>setPw(p=>({...p, next:e.target.value}))} placeholder="At least 8 characters" />
              <PasswordInput label="Confirm New Password" value={pw.confirm} onChange={e=>setPw(p=>({...p, confirm:e.target.value}))} placeholder="Confirm new password" />
              <button type="submit" className="btn-primary" style={{marginTop:'0.5rem'}} disabled={pwSaving}>
                {pwSaving ? <Loader2 className="loader" size={16}/> : null} Update Password
              </button>
            </form>
            <p className="muted" style={{marginTop:'0.75rem', fontSize:'0.8rem'}}>Signed up with Google? You can set a password here without a current one.</p>
          </div>

          <div className="card" style={{padding:'2rem', marginTop:'1.5rem'}}>
            <h3 style={{fontSize:'1.15rem'}}>Two-Factor Authentication (2FA)</h3>
            {tfErr && <div className="auth-error" style={{marginTop:'0.75rem'}}><AlertCircle size={16}/> {tfErr}</div>}

            <div className="twofa-row">
              <div className="twofa-info"><Smartphone size={16}/> <div><strong>Authenticator App (TOTP)</strong>
                <div className="twofa-status">Status: <span className={`badge ${tfEnabled ? 'valid' : 'unknown'}`}>{tfEnabled ? 'Enabled' : 'Disabled'}</span></div></div></div>
              {!tfEnabled && !tfSetup && (
                <button className="btn-secondary" onClick={startTwoFactor} disabled={tfBusy}>
                  {tfBusy ? <Loader2 className="loader" size={16}/> : null} Enable Now
                </button>
              )}
              {tfEnabled && !tfDisabling && (
                <button className="btn-secondary" onClick={() => { setTfDisabling(true); setTfCode(''); setTfErr(''); }}>Disable</button>
              )}
            </div>

            {/* Enrolment flow: scan QR / enter secret, then confirm a code */}
            {tfSetup && !tfEnabled && (
              <form onSubmit={enableTwoFactor} className="twofa-setup">
                <p className="muted" style={{fontSize:'0.85rem'}}>
                  1. Scan this QR code with Google Authenticator, Authy, or any TOTP app
                  (or enter the key manually). 2. Type the 6-digit code it shows to finish.
                </p>
                {tfSetup.qrDataUrl && <img src={tfSetup.qrDataUrl} alt="2FA QR code" className="twofa-qr" />}
                <div className="twofa-secret">Manual key: <code>{tfSetup.secret}</code></div>
                <input className="input-field" inputMode="numeric" maxLength={6} placeholder="123456"
                  value={tfCode} onChange={e => setTfCode(e.target.value.replace(/\D/g, ''))} />
                <div style={{display:'flex', gap:'0.5rem', marginTop:'0.5rem'}}>
                  <button type="submit" className="btn-primary" disabled={tfBusy || tfCode.length !== 6}>
                    {tfBusy ? <Loader2 className="loader" size={16}/> : null} Verify &amp; Enable
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => { setTfSetup(null); setTfErr(''); }}>Cancel</button>
                </div>
              </form>
            )}

            {/* Disable flow: require a current code */}
            {tfEnabled && tfDisabling && (
              <form onSubmit={disableTwoFactor} className="twofa-setup">
                <p className="muted" style={{fontSize:'0.85rem'}}>Enter a current code from your authenticator app to turn 2FA off.</p>
                <input className="input-field" inputMode="numeric" maxLength={6} placeholder="123456"
                  value={tfCode} onChange={e => setTfCode(e.target.value.replace(/\D/g, ''))} />
                <div style={{display:'flex', gap:'0.5rem', marginTop:'0.5rem'}}>
                  <button type="submit" className="btn-primary" disabled={tfBusy || tfCode.length !== 6}>
                    {tfBusy ? <Loader2 className="loader" size={16}/> : null} Confirm Disable
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => { setTfDisabling(false); setTfErr(''); }}>Cancel</button>
                </div>
              </form>
            )}

            <p className="muted" style={{marginTop:'0.75rem', fontSize:'0.8rem'}}>
              Protect your account with a time-based code from an authenticator app.
            </p>
          </div>

          <div className="card" style={{padding:'2rem', marginTop:'1.5rem'}}>
            <h3 style={{fontSize:'1.15rem'}}>Account &amp; usage</h3>
            <div className="account-rows" style={{marginTop:'0.75rem'}}>
              <div className="account-row"><span>Role</span><strong>{ACCOUNT_ROLE_LABELS[user?.role] || 'User'}</strong></div>
              <div className="account-row"><span>Available credits</span><strong>{(user?.credits ?? 0).toLocaleString()}</strong></div>
              <div className="account-row"><span>Emails verified (30d)</span><strong>{totalEmails.toLocaleString()}</strong></div>
              <div className="account-row"><span>Valid rate (30d)</span><strong>{validRate}%</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Legal Pages ---

const LegalPage = ({ icon: Icon, title, children }) => (
  <div className="public-page animate-fade-in">
    <PublicNav />
    <div className="legal-page">
      <div className="legal-container">
        <Link to="/" className="legal-back"><ChevronRight size={16} style={{transform:'rotate(180deg)'}}/> Back to home</Link>
        <div className="legal-heading">
          <Icon size={30} color="var(--accent-color)" />
          <h1>{title}</h1>
        </div>
        <div className="legal-meta">Effective date: {BRAND.effectiveDate} · {BRAND.name}</div>
        <div className="legal-body">{children}</div>
        <div className="legal-footer-nav"><LegalLinks /></div>
      </div>
    </div>
    <PublicFooter />
    <BackToTop />
  </div>
);

const PrivacyPolicy = () => (
  <LegalPage icon={Shield} title="Privacy Policy">
    <p>This Privacy Policy explains how {BRAND.company} ("we", "us") collects, uses, and protects your information when you use {BRAND.name} (the "Service"). We are committed to handling your data responsibly and in accordance with applicable data-protection laws, including the GDPR and CCPA.</p>

    <h2>1. Information We Collect</h2>
    <ul>
      <li><strong>Account information:</strong> your email address and a securely hashed password.</li>
      <li><strong>Verification data:</strong> the email addresses and lists you submit for verification, and the results we generate (status, confidence, provider, etc.).</li>
      <li><strong>Usage &amp; log data:</strong> IP address, browser type, timestamps, and actions taken, collected to operate and secure the Service.</li>
      <li><strong>Cookies / local storage:</strong> a session token stored in your browser to keep you signed in (see our Cookie Policy).</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>To provide email verification and display your results and history.</li>
      <li>To authenticate you, manage your credits, and prevent abuse.</li>
      <li>To maintain security, debug issues, and improve the Service.</li>
      <li>To comply with legal obligations.</li>
    </ul>

    <h2>3. Legal Bases for Processing (GDPR)</h2>
    <p>We process personal data under the following legal bases: <strong>performance of a contract</strong> (to deliver the Service), <strong>legitimate interests</strong> (security and improvement), <strong>consent</strong> (where required), and <strong>legal obligation</strong>.</p>

    <h2>4. Data Retention</h2>
    <p>Verification history is retained for <strong>30 days</strong> and then automatically deleted. Account information is retained while your account is active. You may request deletion at any time (see Your Rights).</p>

    <h2>5. Sharing &amp; Subprocessors</h2>
    <p>We do not sell your personal data. To verify an address, the Service connects to the recipient domain's mail servers and may query third-party provider endpoints (for example, Microsoft) to confirm mailbox existence. We use infrastructure and hosting providers who process data on our behalf under appropriate agreements.</p>

    <h2>6. Security</h2>
    <p>Passwords are hashed with bcrypt, transport is encrypted with TLS, and access controls protect stored data. No method of transmission or storage is 100% secure, but we work to protect your information using industry-standard measures.</p>

    <h2>7. Your Rights</h2>
    <p>Depending on your location, you may have the right to access, correct, delete, restrict, or port your data, and to object to processing. To exercise these rights, contact us at <strong>{BRAND.contact}</strong>. See our GDPR page for details.</p>

    <h2>8. International Transfers</h2>
    <p>Your data may be processed in countries other than your own. Where required, we rely on appropriate safeguards such as Standard Contractual Clauses.</p>

    <h2>9. Children's Privacy</h2>
    <p>The Service is not directed to individuals under 16, and we do not knowingly collect their data.</p>

    <h2>10. Changes to This Policy</h2>
    <p>We may update this Policy from time to time. Material changes will be posted here with an updated effective date.</p>

    <h2>11. Contact</h2>
    <p>Questions? Email <strong>{BRAND.contact}</strong> or write to {BRAND.company}.</p>
  </LegalPage>
);

const TermsOfService = () => (
  <LegalPage icon={FileText} title="Terms of Service">
    <p>These Terms of Service ("Terms") govern your access to and use of {BRAND.name} (the "Service") provided by {BRAND.company}. By creating an account or using the Service, you agree to these Terms.</p>

    <h2>1. The Service</h2>
    <p>The Service verifies the deliverability of email addresses through syntax, MX, disposable-domain, SMTP, and provider-level checks, and returns status and confidence indicators. Results are provided on a best-effort basis and are not guaranteed to be error-free.</p>

    <h2>2. Accounts</h2>
    <p>You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. You must provide accurate information and be at least 16 years old.</p>

    <h2>3. Credits &amp; Fair Use</h2>
    <p>Verifications consume credits. Credits are non-transferable and, unless stated otherwise, non-refundable. We may apply rate limits to protect the Service.</p>

    <h2>4. Acceptable Use</h2>
    <p>You agree that you will <strong>only</strong> verify email addresses that you have a lawful basis to process, and you will not use the Service to:</p>
    <ul>
      <li>send spam or unsolicited messages, or facilitate the same;</li>
      <li>harvest, scrape, or build lists without consent;</li>
      <li>violate any law or third-party right, or attempt to breach security;</li>
      <li>overload, disrupt, or reverse-engineer the Service.</li>
    </ul>

    <h2>5. Intellectual Property</h2>
    <p>The Service, including its software and content, is owned by {BRAND.company} and protected by applicable laws. You retain ownership of the lists you submit.</p>

    <h2>6. Disclaimers</h2>
    <p>The Service is provided "as is" and "as available" without warranties of any kind. Email verification cannot be guaranteed to be 100% accurate; "catch-all" and "unknown" results reflect inherent limitations of the SMTP protocol.</p>

    <h2>7. Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, {BRAND.company} shall not be liable for any indirect, incidental, or consequential damages, or for lost profits or data, arising from your use of the Service.</p>

    <h2>8. Termination</h2>
    <p>We may suspend or terminate your access for violation of these Terms. You may stop using the Service and request deletion of your account at any time.</p>

    <h2>9. Governing Law</h2>
    <p>These Terms are governed by the laws of the jurisdiction in which {BRAND.company} is established, without regard to conflict-of-law principles.</p>

    <h2>10. Changes</h2>
    <p>We may modify these Terms; continued use after changes constitutes acceptance. Contact: <strong>{BRAND.contact}</strong>.</p>
  </LegalPage>
);

const CookiePolicy = () => (
  <LegalPage icon={Cookie} title="Cookie Policy">
    <p>This Cookie Policy explains how {BRAND.name} uses cookies and similar technologies such as browser local storage.</p>

    <h2>1. What Are Cookies?</h2>
    <p>Cookies and local storage are small pieces of data stored in your browser that allow a website to remember information about your visit, such as keeping you signed in.</p>

    <h2>2. How We Use Them</h2>
    <ul>
      <li><strong>Strictly necessary (authentication):</strong> we store a session token in your browser's local storage to keep you logged in. Without it, the Service cannot function.</li>
      <li><strong>Preferences:</strong> we may store minor UI preferences locally.</li>
    </ul>
    <p>By default, the Service does <strong>not</strong> use advertising or third-party tracking cookies.</p>

    <h2>3. Managing Cookies</h2>
    <p>You can clear local storage and cookies through your browser settings. Removing the authentication token will simply sign you out.</p>

    <h2>4. Changes</h2>
    <p>We may update this policy as our practices evolve. Questions? Email <strong>{BRAND.contact}</strong>.</p>
  </LegalPage>
);

const GDPR = () => (
  <LegalPage icon={Scale} title="GDPR Compliance">
    <p>{BRAND.company} is committed to the principles of the EU General Data Protection Regulation (GDPR). This page summarizes how we uphold your rights.</p>

    <h2>1. Data Controller</h2>
    <p>{BRAND.company} acts as the data controller for account data, and as a processor for the email lists you submit for verification. Contact: <strong>{BRAND.contact}</strong>.</p>

    <h2>2. Lawful Bases</h2>
    <p>We process personal data based on contract performance, legitimate interests, consent, and legal obligations, as described in our Privacy Policy.</p>

    <h2>3. Your Rights</h2>
    <ul>
      <li><strong>Access</strong>: obtain a copy of the personal data we hold about you.</li>
      <li><strong>Rectification</strong>: correct inaccurate or incomplete data.</li>
      <li><strong>Erasure</strong>: request deletion of your data ("right to be forgotten").</li>
      <li><strong>Restriction</strong>: limit how we process your data.</li>
      <li><strong>Portability</strong>: receive your data in a structured, machine-readable format.</li>
      <li><strong>Objection</strong>: object to processing based on legitimate interests.</li>
      <li><strong>Withdraw consent</strong>: where processing is based on consent.</li>
    </ul>

    <h2>4. Exercising Your Rights</h2>
    <p>Email <strong>{BRAND.contact}</strong> and we will respond within one month, as required by law. You also have the right to lodge a complaint with your local supervisory authority.</p>

    <h2>5. Data Retention &amp; Minimisation</h2>
    <p>We retain verification history for 30 days and collect only the data necessary to provide the Service.</p>

    <h2>6. International Transfers</h2>
    <p>Where personal data is transferred outside the EEA, we use appropriate safeguards such as Standard Contractual Clauses.</p>

    <h2>7. Subprocessors</h2>
    <p>We use vetted hosting and infrastructure providers, and provider verification endpoints, under data-processing agreements. A current list is available on request.</p>

    <h2>8. Data Breaches</h2>
    <p>In the event of a personal-data breach that poses a risk to your rights, we will notify the relevant authority and affected users as required by the GDPR.</p>
  </LegalPage>
);

// --- Tasks & Results (all execution batches, Reoon-style) ---

const PAGE_SIZE = 10;

const TasksResults = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'superadmin';
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const getResults = useBatchResults();

  const load = () => {
    setLoading(true); setLoadError('');
    apiFetch('/history?limit=500')
      .then(data => {
        if (data && Array.isArray(data.history)) {
          setBatches(data.history);
          if (data.retentionDays) setRetentionDays(data.retentionDays);
        } else {
          setLoadError('Unexpected response from the server.');
        }
      })
      .catch(err => setLoadError(friendlyError(err)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [filter]);

  const filtered = filter === 'all' ? batches : batches.filter(b => b.type === filter);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const toggle = async (b) => {
    if (expanded === b.id) { setExpanded(null); setDetail(null); return; }
    setExpanded(b.id); setDetail(null);
    try { setDetail(await getResults(b.id)); } catch { setDetail([]); }
  };
  const download = async (b) => {
    setBusy(b.id);
    try { downloadCSV(await getResults(b.id), `batch_${b.batchNumber ?? b.id}_${b.type}.csv`); }
    catch (err) { alert(friendlyError(err)); }
    finally { setBusy(null); }
  };
  const remove = async (b) => {
    if (!window.confirm(`Delete batch #${b.batchNumber ?? b.id}? This cannot be undone.`)) return;
    setBusy(b.id);
    try {
      const data = await apiFetch(`/history/${b.id}`, { method: 'DELETE' });
      if (data.error) throw new Error(data.error);
      setBatches(bs => bs.filter(x => x.id !== b.id));
      if (expanded === b.id) { setExpanded(null); setDetail(null); }
    } catch (err) { alert(friendlyError(err)); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <p style={{color:'var(--text-secondary)', marginTop:'0', marginBottom:'1.25rem'}}>
        Every single, bulk and CSV verification is stored as a numbered batch and kept for {retentionDays} days.
      </p>

      <div className="card" style={{padding:0, overflow:'hidden'}}>
        <div className="history-header">
          <div style={{display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap'}}>
            <div className="tabs">
              {['all', 'single', 'bulk', 'csv'].map(t => (
                <button key={t} className={`tab ${filter === t ? 'active' : ''}`} onClick={() => setFilter(t)}>
                  {t === 'all' ? 'All' : (TYPE_LABELS[t] || t)}
                </button>
              ))}
            </div>
          </div>
          <button className="btn-secondary" onClick={load}><RefreshCw size={15} className={loading ? 'loader' : ''}/> Refresh</button>
        </div>

        {loading && batches.length === 0 ? (
          <div className="history-empty"><Loader2 className="loader" size={18}/> Loading…</div>
        ) : loadError ? (
          <div className="history-empty" style={{color:'#dc2626'}}>
            <AlertCircle size={18}/> Couldn’t load history: {loadError}
            <div style={{marginTop:'0.5rem', fontSize:'0.85rem', color:'var(--text-secondary)'}}>
              If this says an unexpected response, your server’s nginx must proxy <code>/history</code> to the backend.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="history-empty">No verification tasks yet. Run a check from <strong>Email Verification</strong>.</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table className="results-table tasks-table">
              <thead>
                <tr>
                  <th></th><th>Batch #</th><th>Date Started</th><th>Task Name</th>
                  <th>Type</th><th>Status</th><th>Total</th><th>Breakdown</th><th style={{textAlign:'right'}}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(b => (
                  <React.Fragment key={b.id}>
                    <tr className="history-row" onClick={() => toggle(b)}>
                      <td style={{width:'24px'}}>{expanded === b.id ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</td>
                      <td><strong>#{b.batchNumber ?? b.id}</strong></td>
                      <td style={{whiteSpace:'nowrap'}}>{formatDate(b.createdAt)}</td>
                      <td>{b.name || <span style={{color:'var(--text-secondary)'}}>Untitled</span>}</td>
                      <td><span className={`badge type-${b.type}`}>{TYPE_LABELS[b.type] || b.type}</span></td>
                      <td><span className="badge valid">Completed</span></td>
                      <td><strong>{b.total}</strong></td>
                      <td>
                        <div className="pill-row">
                          <CountPill label="Valid" value={b.counts.valid} cls="valid" />
                          <CountPill label="Invalid" value={b.counts.invalid} cls="invalid" />
                          <CountPill label="Catch-all" value={b.counts.catchAll} cls="catch-all" />
                          <CountPill label="Unknown" value={b.counts.unknown} cls="unknown" />
                        </div>
                      </td>
                      <td style={{textAlign:'right', whiteSpace:'nowrap'}}>
                        <div style={{display:'inline-flex', gap:'0.4rem', alignItems:'center'}}>
                          {b.total > 0 && (
                            <button className="btn-secondary" title="Download CSV"
                              onClick={(e) => { e.stopPropagation(); download(b); }}>
                              {busy === b.id ? <Loader2 className="loader" size={14}/> : <Download size={14}/>} Download
                            </button>
                          )}
                          {isSuperAdmin && (
                            <button className="icon-btn danger" title="Delete this batch (super admin)"
                              onClick={(e) => { e.stopPropagation(); remove(b); }}>
                              <Trash2 size={15}/>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === b.id && (
                      <tr className="history-detail">
                        <td colSpan={9}>
                          {detail === null
                            ? <div className="history-empty"><Loader2 className="loader" size={16}/> Loading results…</div>
                            : <ResultsTable results={detail} title={`${batchTitle(b)} results`} />}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <div className="tasks-pager">
            <span>Showing {(current - 1) * PAGE_SIZE + 1}-{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <div className="pager-btns">
              <button className="btn-secondary" disabled={current <= 1} onClick={() => setPage(current - 1)}>←</button>
              <span className="pager-current">{current} / {pages}</span>
              <button className="btn-secondary" disabled={current >= pages} onClick={() => setPage(current + 1)}>→</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Admin Panel ---

const ROLE_LABELS = { user: 'User', admin: 'Admin', superadmin: 'Super Admin' };

const AdminPanel = () => {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewerRole, setViewerRole] = useState(user.role);
  // Per-row "amount to add" (a delta), keyed by user id. The Credits column is
  // an add-box - it never shows the existing balance; whatever you type/step
  // here is ADDED to the user's current credits when you press Enter / ✓.
  const [credAdd, setCredAdd] = useState({});
  const [credFlash, setCredFlash] = useState({}); // transient "+N added" per row

  // Superadmins may assign any role; a plain admin may only set user/admin.
  const roleOptions = viewerRole === 'superadmin' ? ['user', 'admin', 'superadmin'] : ['user', 'admin'];

  const load = () => {
    setLoading(true);
    Promise.all([
      apiFetch('/admin/users').catch(() => ({ users: [] })),
      apiFetch('/admin/stats').catch(() => null),
    ]).then(([u, s]) => {
      setUsers((u && u.users) || []);
      if (u && u.viewerRole) setViewerRole(u.viewerRole);
      if (s && !s.error) setStats(s);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const stepAdd = (id, by) => setCredAdd(m => ({ ...m, [id]: (parseInt(m[id], 10) || 0) + by }));
  const typeAdd = (id, v) => {
    // allow empty, a lone "-", and integers (incl. negative) while typing
    if (v === '' || v === '-' || /^-?\d+$/.test(v)) setCredAdd(m => ({ ...m, [id]: v }));
  };

  // Apply the row's add-amount: ADD it to the user's existing credits (the
  // backend does existing + delta) and reset the box.
  const applyAdd = async (id) => {
    const delta = parseInt(credAdd[id], 10);
    if (Number.isNaN(delta) || delta === 0) { setCredAdd(m => ({ ...m, [id]: '' })); return; }
    const data = await apiFetch(`/admin/users/${id}/credits`, { method: 'POST', body: JSON.stringify({ delta }) });
    if (data.error) return alert(data.error);
    setUsers(us => us.map(u => u.id === id ? { ...u, credits: data.credits } : u));
    setCredAdd(m => ({ ...m, [id]: '' }));
    // brief confirmation of what was added (not the running balance)
    const label = `${delta > 0 ? '+' : ''}${delta} added`;
    setCredFlash(m => ({ ...m, [id]: label }));
    setTimeout(() => setCredFlash(m => { const n = { ...m }; delete n[id]; return n; }), 2500);
    // If the admin changed their OWN credits, refresh the auth user so the
    // sidebar and Overview reflect it immediately (no page reload needed).
    if (String(id) === String(user.id)) refreshUser();
  };
  const setRole = async (u, role) => {
    if (role === u.role) return;
    const data = await apiFetch(`/admin/users/${u.id}/role`, { method: 'POST', body: JSON.stringify({ role }) });
    if (data.error) return alert(data.error);
    setUsers(us => us.map(x => x.id === u.id ? { ...x, role } : x));
  };
  const removeUser = async (u) => {
    if (!window.confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    const data = await apiFetch(`/admin/users/${u.id}`, { method: 'DELETE' });
    if (data.error) return alert(data.error);
    setUsers(us => us.filter(x => x.id !== u.id));
  };

  return (
    <div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1.25rem', marginBottom:'1.5rem'}}>
        <StatCard label="Total Users" value={stats?.total_users ?? '-'} accent="var(--accent-color)" />
        <StatCard label="Admins" value={stats?.admins ?? '-'} />
        {viewerRole === 'superadmin' && <StatCard label="Super Admins" value={stats?.superadmins ?? '-'} accent="#7c3aed" />}
        <StatCard label="Total Verifications" value={stats?.total_emails ?? '-'} />
        <StatCard label="Credits in System" value={stats?.total_credits ?? '-'} accent="#059669" />
      </div>

      <div className="card" style={{padding:0, overflow:'hidden'}}>
        <div className="history-header"><div style={{display:'flex', alignItems:'center', gap:'0.6rem'}}><Users size={18} color="var(--accent-color)"/><h3 style={{fontSize:'1.05rem'}}>Users ({users.length})</h3></div>
          <button className="btn-secondary" onClick={load}><RefreshCw size={15} className={loading?'loader':''}/> Refresh</button>
        </div>
        {loading && users.length === 0 ? (
          <div className="history-empty"><Loader2 className="loader" size={18}/> Loading…</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table className="results-table">
              <thead><tr><th>ID</th><th>Joined</th><th>Email</th><th>Role</th><th>Add Credits</th><th>Total Credits</th><th>Used Credits</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="admin-user-row" title="Open this user's lifetime history"
                      onClick={() => navigate(`/admin/user/${encodeURIComponent(u.id)}`)}>
                    <td><span className="admin-uid">{u.displayId || u.id}</span></td>
                    <td style={{color:'var(--text-secondary)', fontSize:'0.85rem'}}>{u.created_at ? formatDate(u.created_at) : '-'}</td>
                    <td><strong>{u.email}</strong>{u.id === user.id && <span style={{color:'var(--text-secondary)', fontWeight:400}}> (you)</span>}</td>
                    <td><span className={`badge role-${u.role || 'user'}`}>{ROLE_LABELS[u.role] || 'User'}</span></td>
                    {/* The Add Credits cell is a control - clicking it must NOT open the history page. */}
                    <td onClick={(e) => e.stopPropagation()} style={{cursor:'default'}}>
                      <div style={{display:'flex', alignItems:'center', gap:'0.35rem'}}>
                        <button className="icon-btn" title="Decrease amount by 100" onClick={() => stepAdd(u.id, -100)}><Minus size={14}/></button>
                        <input
                          className="cred-add-input"
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={credAdd[u.id] ?? ''}
                          onChange={(e) => typeAdd(u.id, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') applyAdd(u.id); }}
                          title="Amount to add to this user's credits, then press Enter or ✓"
                        />
                        <button className="icon-btn" title="Increase amount by 100" onClick={() => stepAdd(u.id, 100)}><Plus size={14}/></button>
                        <button className="icon-btn primary" title="Add to existing credits" onClick={() => applyAdd(u.id)}><CheckCircle2 size={15}/></button>
                        {credFlash[u.id] && <span className="cred-flash">{credFlash[u.id]}</span>}
                      </div>
                    </td>
                    <td title="Lifetime credits (current balance + used)"><strong>{(u.total_credits ?? u.credits ?? 0).toLocaleString()}</strong></td>
                    <td title="Credits spent on verifications">{(u.used_credits ?? 0).toLocaleString()}</td>
                    <td onClick={(e) => e.stopPropagation()} style={{cursor:'default'}}>
                      <div style={{display:'flex', gap:'0.4rem', alignItems:'center'}}>
                        <select
                          className="role-select"
                          value={u.role || 'user'}
                          disabled={u.id === user.id}
                          title={u.id === user.id ? "You can't change your own role" : 'Change role'}
                          onChange={(e) => setRole(u, e.target.value)}
                        >
                          {(roleOptions.includes(u.role) ? roleOptions : [...roleOptions, u.role]).map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                          ))}
                        </select>
                        {u.id !== user.id && (
                          <button className="icon-btn danger" title="Delete user" onClick={() => removeUser(u)}><Trash2 size={15}/></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// Per-user lifetime history - opened by clicking a row in the Admin Panel.
const AdminUserHistory = () => {
  const { uid } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    apiFetch(`/admin/users/${encodeURIComponent(uid)}/history`)
      .then(d => { if (!alive) return; d.error ? setError(d.error) : setData(d); })
      .catch(e => { if (alive) setError(friendlyError(e)); });
    return () => { alive = false; };
  }, [uid]);

  const u = data && data.user;
  return (
    <div>
      <button className="btn-secondary" onClick={() => navigate('/admin')} style={{ marginBottom: '1.25rem' }}>
        <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back to Admin Panel
      </button>

      {error && <div className="bill-notice err"><AlertCircle size={18} /><div>{error}</div></div>}
      {!data && !error && <p className="muted"><Loader2 className="loader" size={16} /> Loading user history…</p>}

      {u && (
        <>
          <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: '1.15rem' }}>{u.email}</h3>
              <span className={`badge role-${u.role || 'user'}`}>{ROLE_LABELS[u.role] || 'User'}</span>
              <span className="admin-uid">{u.displayId || u.id}</span>
            </div>
            <div className="muted-inline" style={{ marginTop: '0.35rem', display: 'block' }}>
              Joined {u.created_at ? formatDate(u.created_at) : '-'}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <StatCard label="Current Balance" value={(u.credits ?? 0).toLocaleString()} accent="#059669" />
            <StatCard label="Used Credits" value={(u.used_credits ?? 0).toLocaleString()} accent="#d97706" />
            <StatCard label="Total Credits" value={(u.total_credits ?? 0).toLocaleString()} accent="var(--accent-color)" />
            <StatCard label="Lifetime Verifications" value={(u.emails_verified ?? 0).toLocaleString()} />
            <StatCard label="Lifetime Executions" value={(u.executions ?? 0).toLocaleString()} />
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="history-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <History size={18} color="var(--accent-color)" />
                <h3 style={{ fontSize: '1.05rem' }}>Executions ({(data.batches || []).length})</h3>
              </div>
              <span className="muted-inline">Stored results are kept for {data.retentionDays} days; the totals above are lifetime.</span>
            </div>
            {(data.batches || []).length === 0 ? (
              <div className="history-empty">No stored executions in the last {data.retentionDays} days.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="results-table">
                  <thead><tr><th>Task</th><th>Type</th><th>Date</th><th>Total</th><th>Breakdown</th></tr></thead>
                  <tbody>
                    {data.batches.map(b => (
                      <tr key={b.id}>
                        <td><strong>{b.name || `#${b.batchNumber ?? b.id}`}</strong></td>
                        <td><span className={`badge type-${b.type}`}>{TYPE_LABELS[b.type] || b.type}</span></td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{formatDate(b.createdAt)}</td>
                        <td>{(b.total || 0).toLocaleString()}</td>
                        <td>
                          <div className="pill-row">
                            <CountPill label="Valid" value={b.counts.valid} cls="valid" />
                            <CountPill label="Invalid" value={b.counts.invalid} cls="invalid" />
                            <CountPill label="Catch-all" value={b.counts.catchAll} cls="catch-all" />
                            <CountPill label="Unknown" value={b.counts.unknown} cls="unknown" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  if (adminOnly && user.role !== 'admin' && user.role !== 'superadmin') return <DashboardLayout><div className="card" style={{padding:'2rem'}}>Admin access required.</div></DashboardLayout>;
  return <DashboardLayout>{children}</DashboardLayout>;
};

// Keep private app pages (dashboard, admin, auth) out of search engines by
// flipping the shared <meta name="robots"> tag per route. Public marketing and
// legal pages stay index,follow (the default set in index.html). This complements
// robots.txt (which blocks crawling of the same paths).
const PRIVATE_ROUTE_RE = /^\/(dashboard|admin|login|register|forgot-password|reset-password)(\/|$)/;
const RobotsMeta = () => {
  const location = useLocation();
  useEffect(() => {
    let tag = document.querySelector('meta[name="robots"]');
    if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', 'robots'); document.head.appendChild(tag); }
    tag.setAttribute('content', PRIVATE_ROUTE_RE.test(location.pathname) ? 'noindex, nofollow' : 'index, follow');
  }, [location.pathname]);
  return null;
};

function AppRoutes() {
  return (
    <>
    <RobotsMeta />
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/pricing" element={<Navigate to="/#pricing" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/cookies" element={<CookiePolicy />} />
      <Route path="/gdpr" element={<GDPR />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
      <Route path="/dashboard/verify" element={<ProtectedRoute><EmailVerification /></ProtectedRoute>} />
      <Route path="/dashboard/catchall" element={<ProtectedRoute><CatchAllVerifier /></ProtectedRoute>} />
      <Route path="/dashboard/bounce" element={<ProtectedRoute><BounceChecker /></ProtectedRoute>} />
      <Route path="/dashboard/billing" element={<ProtectedRoute><BillingPage /></ProtectedRoute>} />
      {/* Old separate routes now redirect to the unified page */}
      <Route path="/dashboard/single" element={<Navigate to="/dashboard/verify" replace />} />
      <Route path="/dashboard/bulk" element={<Navigate to="/dashboard/verify" replace />} />
      <Route path="/dashboard/csv" element={<Navigate to="/dashboard/verify" replace />} />
      <Route path="/dashboard/tasks" element={<ProtectedRoute><TasksResults /></ProtectedRoute>} />
      <Route path="/dashboard/account" element={<ProtectedRoute><MyAccount /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPanel /></ProtectedRoute>} />
      <Route path="/admin/user/:uid" element={<ProtectedRoute adminOnly><AdminUserHistory /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
