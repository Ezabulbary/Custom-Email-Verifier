import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { Mail, List, Upload, Search, Download, CheckCircle, XCircle, AlertCircle, HelpCircle, Loader2, LogOut, LayoutDashboard, History, Clock, ChevronDown, ChevronRight, Shield, FileText, Cookie, Scale, RefreshCw, Users, Trash2, Plus, Minus, ShieldCheck, Zap, ArrowRight, CheckCircle2, MailCheck, Menu, X, ArrowUp, Star, Quote, Phone } from 'lucide-react';
import './App.css';
import { googleSignIn } from './firebase';

// API base URL. Leave VITE_API_URL empty for local dev — requests then go to
// the same origin and Vite's dev proxy (see vite.config.js) forwards them to
// the backend, which avoids CORS and localhost/IPv6 issues. In production set
// VITE_API_URL to your API origin (or '' if same-origin behind nginx).
const API_URL = import.meta.env.VITE_API_URL || '';

// Brand / legal placeholders — replace with your real company details before
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

const StatusIcon = ({ status }) => {
  switch (status) {
    case 'valid': return <CheckCircle size={18} color="#059669" />;
    case 'invalid': return <XCircle size={18} color="#dc2626" />;
    case 'catch-all': return <AlertCircle size={18} color="#d97706" />;
    default: return <HelpCircle size={18} color="#64748b" />;
  }
};

const ConfidenceBar = ({ value }) => {
  if (typeof value !== 'number') return <span>—</span>;
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
  const headers = ['Email', 'Status', 'Confidence', 'Provider', 'Syntax', 'Disposable', 'MX Found', 'SMTP Code', 'Catch-All', 'Reason'];
  return [
    headers.join(','),
    ...results.map(r => [
      r.email, r.status, r.confidence, r.provider, r.syntax, r.disposable, r.mxFound, r.smtpCode, r.isCatchAll, r.reason
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
                  <span className={`badge ${res.status || 'unknown'}`}>{(res.status || 'unknown').toUpperCase()}</span>
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

const TYPE_LABELS = { single: 'Single', bulk: 'Bulk', csv: 'CSV' };

const formatDate = (iso) => {
  if (!iso) return '';
  // SQLite datetime('now') is UTC; append Z so it renders in local time.
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? iso : d.toLocaleString();
};

const CountPill = ({ label, value, cls }) => (
  <span className={`count-pill ${cls}`}>{label}: <strong>{value}</strong></span>
);

const HistoryPanel = ({ type, version }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [retentionDays, setRetentionDays] = useState(30);

  const load = () => {
    setLoading(true);
    apiFetch(`/history?type=${type}&limit=100`)
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
            <tr><th></th><th>Date &amp; Time</th><th>Total</th><th>Breakdown</th><th></th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <React.Fragment key={h.id}>
                <tr className="history-row" onClick={() => setExpanded(expanded === h.id ? null : h.id)}>
                  <td style={{width:'28px'}}>{expanded === h.id ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</td>
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
                    {h.results && h.results.length > 0 && (
                      <button
                        className="btn-secondary"
                        onClick={(e) => { e.stopPropagation(); downloadCSV(h.results, `history_${h.type}_${h.id}.csv`); }}
                      ><Download size={14}/></button>
                    )}
                  </td>
                </tr>
                {expanded === h.id && (
                  <tr className="history-detail">
                    <td colSpan={5}>
                      <ResultsTable results={h.results} title="Execution results" />
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

// Smooth-scroll to a section id — works from any page (navigates home first if
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
  { quote: 'The catch-all confidence score is a game changer — we finally trust our "risky" segment.', name: 'Daniel R.', role: 'Email Marketer', company: 'Loop Media', rating: 5 },
  { quote: 'Bulk + CSV verification saved our sales team hours every week.', name: 'Aisha M.', role: 'Sales Ops', company: 'Brightlane', rating: 5 },
];

const FAQS = [
  { q: 'What does a verification actually check?', a: 'Every address goes through syntax validation, MX lookup, SMTP mailbox probing, disposable-domain detection and catch-all analysis — returning a status (valid, invalid, catch-all or unknown) and a 0–100 confidence score.' },
  { q: 'What do the statuses mean?', a: 'Valid = the mailbox exists and can receive mail. Invalid = it does not exist or the domain rejects mail. Catch-all = the domain accepts every address, so we return a confidence score instead of a guarantee. Unknown = the server did not give a definitive answer (greylisting, timeouts).' },
  { q: 'How accurate is BounceCure?', a: 'For domains that expose a mailbox, accuracy is typically 98–99%. Catch-all and unknown results reflect genuine limits of the SMTP protocol — no verifier can be 100% certain on those, which is exactly why we return a confidence score rather than a false “valid”.' },
  { q: 'How do you handle catch-all domains?', a: 'We send multiple probes and compare the server responses, and for Microsoft 365 tenants we run a deep mailbox check — so even accept-all domains get a meaningful confidence score instead of a blind “valid”.' },
  { q: 'Will verifying send an email to the address?', a: 'No. We talk to the mail server up to the point of checking the mailbox and then disconnect before any message is sent. Recipients never receive anything.' },
  { q: 'How fast is it and can I verify in bulk?', a: 'Single checks usually complete in under two seconds. You can paste a list or upload a CSV for bulk verification, and results stream back as each address is processed.' },
  { q: 'What file formats do you support for lists?', a: 'CSV files with one email per row (with or without a header). After processing you can export a clean CSV with the status, confidence and full details for every address.' },
  { q: 'Does verifying improve my deliverability?', a: 'Yes. Removing invalid and risky addresses lowers your bounce rate, protects your sender reputation, and keeps you out of spam traps — which means more of your email reaches the inbox.' },
  { q: 'How many free credits do I get?', a: 'Every new account starts with 100 free verification credits — no credit card required. One credit = one verified address.' },
  { q: 'Do credits expire?', a: 'Free credits never expire. Paid plans renew monthly with a fresh allocation of credits.' },
  { q: 'Can I sign in with Google?', a: 'Yes. You can create your account or log in with “Continue with Google”, or use a regular email and password — whichever you prefer.' },
  { q: 'I forgot my password — what do I do?', a: 'On the login page click “Forgot password?”, enter your email, and we will send you a secure link to set a new password. If you signed up with Google, just use “Continue with Google” instead.' },
  { q: 'Is there an API?', a: 'A REST API is on the roadmap for the Pro plan so you can verify addresses directly from your app or signup form in real time. Contact us if you would like early access.' },
  { q: 'Is my data safe and private?', a: 'Passwords are hashed with bcrypt, all traffic is encrypted over TLS, we never sell your data, and verification history is automatically deleted after 30 days. See our Privacy Policy and GDPR page for details.' },
  { q: 'Do you store the lists I upload?', a: 'Only your results are kept, and only for 30 days so you can re-export them — after that they are deleted automatically. You can also request deletion at any time.' },
  { q: 'Can I cancel or get a refund?', a: 'You can cancel anytime and keep access until the end of your billing period. Unused credits are non-refundable, but there is no long-term contract.' },
  { q: 'Still have questions?', a: 'Book a quick call with us or email support — we are happy to walk you through how BounceCure fits your workflow.' },
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
        <Link to="/register" className={p.highlight ? 'btn-primary' : 'btn-secondary'} style={{width:'100%', justifyContent:'center'}}>
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

const PublicNav = () => {
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
            <Link to="/login" className="nav-login" onClick={close}>Login</Link>
            <Link to="/register" className="nav-cta" onClick={close}>Get Started</Link>
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
          <p>Create a free account and get 100 verifications — no card required.</p>
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
      <p>{BRAND.name} checks syntax, MX, SMTP mailbox, disposable and catch-all — with a confidence score for every address — so your emails reach real inboxes.</p>
      <div className="hero-cta">
        <Link to="/register" className="btn-primary" style={{width:'auto', padding:'0.9rem 1.7rem'}}>Start free — 100 credits <ArrowRight size={18}/></Link>
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
          <span>Talk to a human — grab a free 15-minute call and we’ll help you get set up.</span>
        </div>
        <a href={BRAND.callUrl} target="_blank" rel="noopener noreferrer" className="btn-primary faq-call-btn">
          <Phone size={17} /> Book a quick call
        </a>
      </Reveal>
    </section>

    <section className="cta-section">
      <Reveal className="cta-inner" variant="up">
        <h2>Ready to clean your list?</h2>
        <p>Get 100 free verifications — no credit card required.</p>
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

// Two-part auth layout — both halves share the same light tone. One side is the
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
      setError(friendlyError(err));
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your account"
      error={error}
      brandTitle="Good to see you again."
      brandText="Log in to verify emails, clean your lists and keep your bounce rate low."
      alt={<>Don't have an account? <Link to="/register">Register</Link></>}
    >
      <form onSubmit={handleSubmit} className="form-group">
        <label>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-field" placeholder="you@company.com" required />
        <div className="label-row">
          <label>Password</label>
          <Link to="/forgot-password" className="forgot-link">Forgot password?</Link>
        </div>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="input-field" placeholder="••••••••" required />
        <button type="submit" className="btn-primary" style={{marginTop:'1rem'}}>Sign In</button>
      </form>
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
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="input-field" placeholder="At least 8 characters" required minLength={8} />
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
      brandText="Create a free account and get 100 verifications — no credit card required."
      alt={<>Already have an account? <Link to="/login">Login</Link></>}
    >
      <form onSubmit={handleSubmit} className="form-group">
        <label>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-field" placeholder="you@company.com" required />
        <label>Password</label>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="input-field" placeholder="At least 8 characters" required minLength={8} />
        <span style={{fontSize:'0.8rem', color:'var(--text-secondary)'}}>At least 8 characters.</span>
        <button type="submit" className="btn-primary" style={{marginTop:'1rem'}}>Sign Up</button>
      </form>
    </AuthShell>
  );
};

const DashboardLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="dashboard-container animate-fade-in">
      <div className="sidebar">
        <div className="sidebar-header">
          <Link to="/"><Logo size={26} /></Link>
        </div>
        <div className="sidebar-nav">
          <Link to="/dashboard" className={`nav-item ${location.pathname==='/dashboard'?'active':''}`}><LayoutDashboard size={18}/> Dashboard</Link>
          <Link to="/dashboard/single" className={`nav-item ${location.pathname==='/dashboard/single'?'active':''}`}><Search size={18}/> Single Verify</Link>
          <Link to="/dashboard/bulk" className={`nav-item ${location.pathname==='/dashboard/bulk'?'active':''}`}><List size={18}/> Bulk Verification</Link>
          <Link to="/dashboard/csv" className={`nav-item ${location.pathname==='/dashboard/csv'?'active':''}`}><Upload size={18}/> Clean a List</Link>
          {(user?.role === 'admin' || user?.role === 'superadmin') && (
            <Link to="/admin" className={`nav-item ${location.pathname==='/admin'?'active':''}`}><ShieldCheck size={18}/> Admin Panel</Link>
          )}
          <div style={{flex:1}}></div>
          <button onClick={logout} className="nav-item" style={{width:'100%', textAlign:'left'}}><LogOut size={18}/> Logout</button>
        </div>
      </div>
      <div className="main-content">
        <div className="top-header">
          <div style={{fontWeight:500}}>{user?.email}</div>
          <div className="credits-badge">Credits: {user?.credits ?? 0}</div>
        </div>
        <div className="page-content">
          {children}
          <AppFooter />
        </div>
      </div>
    </div>
  );
};

const SingleVerify = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const { setUser, user } = useAuth();

  const handleVerify = async (e) => {
    e.preventDefault();
    if(!email) return;
    setLoading(true);
    try {
      const data = await apiFetch('/verify', { method: 'POST', body: JSON.stringify({ email }) });
      if (data.error) throw new Error(data.error);
      setResult(data);
      setUser({...user, credits: user.credits - 1});
      setHistoryVersion(v => v + 1);
    } catch(err) { alert(err.message); }
    setLoading(false);
  };

  return (
    <div>
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
      <HistoryPanel type="single" version={historyVersion} />
    </div>
  );
};

const BulkVerify = () => {
  const [emails, setEmails] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const { setUser, user } = useAuth();

  const handleVerify = async (e) => {
    e.preventDefault();
    const arr = emails.split('\n').map(e=>e.trim()).filter(e=>e);
    if(arr.length === 0) return;
    setLoading(true);
    try {
      const data = await apiFetch('/verify/bulk', { method: 'POST', body: JSON.stringify({ emails: arr }) });
      if (data.error) throw new Error(data.error);
      setResults(data.results);
      setUser({...user, credits: user.credits - data.results.length});
      setHistoryVersion(v => v + 1);
    } catch(err) { alert(err.message); }
    setLoading(false);
  };

  return (
    <div>
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
      <HistoryPanel type="bulk" version={historyVersion} />
    </div>
  );
};

const CsvVerify = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const { setUser, user } = useAuth();
  const fileInputRef = React.useRef(null);

  const handleUpload = async () => {
    if(!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setLoading(true);
    try {
      const data = await apiFetch('/verify/csv', { method: 'POST', body: formData });
      if (data.error) throw new Error(data.error);
      setResults(data.results);
      setUser({...user, credits: user.credits - data.results.length});
      setFile(null);
      setHistoryVersion(v => v + 1);
    } catch(err) { alert(err.message); }
    setLoading(false);
  };

  return (
    <div>
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
      <HistoryPanel type="csv" version={historyVersion} />
    </div>
  );
};

const StatCard = ({ label, value, accent }) => (
  <div className="card" style={{padding:'2rem'}}>
    <div style={{color:'var(--text-secondary)', fontWeight:500}}>{label}</div>
    <div style={{fontSize:'2.5rem', fontWeight:700, color: accent || 'var(--text-primary)', marginTop:'0.5rem'}}>{value}</div>
  </div>
);

const DashboardHome = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    apiFetch('/history/stats').then(d => { if (d && !d.error) setStats(d); }).catch(() => {});
  }, []);

  const totalEmails = stats?.totalEmails ?? 0;
  const valid = stats?.counts?.valid ?? 0;
  const validRate = totalEmails > 0 ? Math.round((valid / totalEmails) * 100) : 0;

  return (
    <div>
      <div className="page-title">Dashboard Overview</div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:'1.5rem'}}>
        <StatCard label="Available Credits" value={user?.credits ?? 0} accent="var(--accent-color)" />
        <StatCard label="Emails Verified (30d)" value={totalEmails} />
        <StatCard label="Lists Cleaned (30d)" value={stats?.listsCleaned ?? 0} />
        <StatCard label="Valid Rate (30d)" value={`${validRate}%`} accent="#059669" />
      </div>

      {stats && totalEmails > 0 && (
        <div className="card" style={{padding:'2rem', marginTop:'1.5rem'}}>
          <div style={{fontWeight:600, marginBottom:'1rem'}}>Last 30 days breakdown</div>
          <div className="pill-row" style={{gap:'0.75rem'}}>
            <CountPill label="Valid" value={stats.counts.valid} cls="valid" />
            <CountPill label="Invalid" value={stats.counts.invalid} cls="invalid" />
            <CountPill label="Catch-all" value={stats.counts.catchAll} cls="catch-all" />
            <CountPill label="Unknown" value={stats.counts.unknown} cls="unknown" />
            <span className="count-pill" style={{marginLeft:'auto'}}>Executions: <strong>{stats.executions}</strong></span>
          </div>
        </div>
      )}
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
      <li><strong>Access</strong> — obtain a copy of the personal data we hold about you.</li>
      <li><strong>Rectification</strong> — correct inaccurate or incomplete data.</li>
      <li><strong>Erasure</strong> — request deletion of your data ("right to be forgotten").</li>
      <li><strong>Restriction</strong> — limit how we process your data.</li>
      <li><strong>Portability</strong> — receive your data in a structured, machine-readable format.</li>
      <li><strong>Objection</strong> — object to processing based on legitimate interests.</li>
      <li><strong>Withdraw consent</strong> — where processing is based on consent.</li>
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

// --- Admin Panel ---

const ROLE_LABELS = { user: 'User', admin: 'Admin', superadmin: 'Super Admin' };

const AdminPanel = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewerRole, setViewerRole] = useState(user.role);

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

  const adjustCredits = async (id, delta) => {
    const data = await apiFetch(`/admin/users/${id}/credits`, { method: 'POST', body: JSON.stringify({ delta }) });
    if (data.error) return alert(data.error);
    setUsers(us => us.map(u => u.id === id ? { ...u, credits: data.credits } : u));
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
      <div className="page-title"><ShieldCheck size={22} style={{verticalAlign:'-4px', marginRight:'0.4rem'}} color="var(--accent-color)"/> Admin Panel</div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'1.25rem', marginBottom:'1.5rem'}}>
        <StatCard label="Total Users" value={stats?.total_users ?? '—'} accent="var(--accent-color)" />
        <StatCard label="Admins" value={stats?.admins ?? '—'} />
        {viewerRole === 'superadmin' && <StatCard label="Super Admins" value={stats?.superadmins ?? '—'} accent="#7c3aed" />}
        <StatCard label="Total Verifications" value={stats?.total_emails ?? '—'} />
        <StatCard label="Credits in System" value={stats?.total_credits ?? '—'} accent="#059669" />
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
              <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Credits</th><th>Verified</th><th>Joined</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td><strong>{u.email}</strong>{u.id === user.id && <span style={{color:'var(--text-secondary)', fontWeight:400}}> (you)</span>}</td>
                    <td><span className={`badge role-${u.role || 'user'}`}>{ROLE_LABELS[u.role] || 'User'}</span></td>
                    <td>
                      <div style={{display:'flex', alignItems:'center', gap:'0.35rem'}}>
                        <button className="icon-btn" title="-100" onClick={() => adjustCredits(u.id, -100)}><Minus size={14}/></button>
                        <strong style={{minWidth:'54px', textAlign:'center'}}>{u.credits}</strong>
                        <button className="icon-btn" title="+100" onClick={() => adjustCredits(u.id, 100)}><Plus size={14}/></button>
                      </div>
                    </td>
                    <td>{u.emails_verified}</td>
                    <td style={{color:'var(--text-secondary)', fontSize:'0.85rem'}}>{u.created_at ? formatDate(u.created_at) : '—'}</td>
                    <td>
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

const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  if (adminOnly && user.role !== 'admin' && user.role !== 'superadmin') return <DashboardLayout><div className="card" style={{padding:'2rem'}}>Admin access required.</div></DashboardLayout>;
  return <DashboardLayout>{children}</DashboardLayout>;
};

function AppRoutes() {
  return (
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
      <Route path="/dashboard/single" element={<ProtectedRoute><SingleVerify /></ProtectedRoute>} />
      <Route path="/dashboard/bulk" element={<ProtectedRoute><BulkVerify /></ProtectedRoute>} />
      <Route path="/dashboard/csv" element={<ProtectedRoute><CsvVerify /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPanel /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" />} />
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
