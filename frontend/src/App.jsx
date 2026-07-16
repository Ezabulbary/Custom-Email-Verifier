import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Mail, List, Upload, Search, Download, CheckCircle, XCircle,
  AlertCircle, HelpCircle, Loader2, LogOut, LayoutDashboard,
  FileText, ShieldAlert, CreditCard, ChevronDown, ChevronUp, Menu, X
} from 'lucide-react';
import './App.css';

const API_URL = 'http://localhost:3001';

/* ══════════════════════════════════════════
   AUTH CONTEXT
══════════════════════════════════════════ */
const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
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

  const login = (token, userData) => { localStorage.setItem('token', token); setUser(userData); };
  const logout = () => { localStorage.removeItem('token'); setUser(null); };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, setUser }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

/* ══════════════════════════════════════════
   API UTIL
══════════════════════════════════════════ */
const apiFetch = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!options.body || typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  else if (options.body instanceof FormData) delete headers['Content-Type'];

  const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return response.json();
};

/* ══════════════════════════════════════════
   ANIMATED COUNTER
══════════════════════════════════════════ */
const AnimatedCounter = ({ target, suffix, label }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = parseFloat(target);
    if (isNaN(end)) return;
    
    const duration = 1500; // ms
    const increment = end / (duration / 16); // ~60fps
    
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(start);
      }
    }, 16);
    
    return () => clearInterval(timer);
  }, [target]);

  const formatCount = (val) => {
    if (val % 1 === 0) return val.toFixed(0);
    return val.toFixed(1);
  };

  return (
    <div style={{ textAlign: 'center', minWidth: '135px' }}>
      <div style={{ fontSize: '2.3rem', fontWeight: 900, color: '#0f172a', fontFamily: 'Inter, sans-serif', letterSpacing: '-1.5px' }}>
        {formatCount(count)}{suffix}
      </div>
      <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.3rem', fontWeight: 600, letterSpacing: '0.3px' }}>{label}</div>
    </div>
  );
};

/* ══════════════════════════════════════════
   LANDING PAGE
══════════════════════════════════════════ */
const LandingPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [demoEmail, setDemoEmail] = useState('');
  const [demoLoading, setDemoLoading] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Animate on scroll using IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.style.opacity = '1';
          e.target.style.transform = 'translateY(0)';
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.lp-animate').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'opacity 0.65s cubic-bezier(0.16, 1, 0.3, 1), transform 0.65s cubic-bezier(0.16, 1, 0.3, 1)';
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const handleDemo = (e) => {
    e.preventDefault();
    if (!demoEmail) return;
    setDemoLoading(true);
    setTimeout(() => {
      setDemoLoading(false);
      navigate('/register');
    }, 1200);
  };

  const faqs = [
    { q: 'Does BounceCure send actual emails to verify?', a: 'No. We use real SMTP handshake technology — we knock on the mail server\'s door and ask if the mailbox exists, without ever sending an email. Your sender reputation stays completely clean.' },
    { q: 'What is a Catch-All email and why does it matter?', a: 'A catch-all server accepts every incoming email regardless of whether the specific mailbox exists. Our unique random-probe technique detects these and flags them separately, preventing false positives.' },
    { q: 'How long do my credits last?', a: 'Purchased credits never expire. Use them at your own pace — today or six months from now. No monthly minimums, no subscription fees.' },
    { q: 'Can I integrate BounceCure into my own application?', a: 'Yes! We offer a REST API with Bearer Token auth. Register, get your token from the dashboard, and start making API calls. Documentation is in your dashboard under "API Docs."' },
    { q: 'What payment methods do you accept?', a: 'We use Stripe for secure payments. Pay with any major credit/debit card (Visa, Mastercard, Amex), Google Pay, or Apple Pay.' },
    { q: 'What formats can I upload for bulk verification?', a: 'Upload a CSV file, paste emails one-per-line into bulk verifier, or send a JSON array via API. Our engine auto-detects the email column in your CSV.' },
  ];

  const services = [
    { icon: '🔍', color: '#EEF0FF', title: 'Single Email Verify', desc: 'Verify any single email in real-time with full SMTP check. Get a detailed report in under 2 seconds.' },
    { icon: '📦', color: '#D1FAE5', title: 'Bulk Verification', desc: 'Paste up to 10,000 emails and verify them all at once. Download clean results as CSV instantly.' },
    { icon: '📁', color: '#FEF3C7', title: 'CSV List Cleaning', desc: 'Upload your CSV directly. Our engine auto-detects the email column and cleans your list with one click.' },
    { icon: '🧩', color: '#FCE7F3', title: 'REST API Access', desc: 'Integrate BounceCure into your app, CRM, or marketing platform with our developer-friendly API.' },
    { icon: '🛡️', color: '#EEF0FF', title: 'Catch-All Detection', desc: 'Our randomized probe technique identifies catch-all servers that trick ordinary verifiers.' },
    { icon: '🚫', color: '#D1FAE5', title: 'Disposable Blocker', desc: 'Auto-detect and flag 7,500+ known disposable email providers, updated daily.' },
  ];

  const testimonials = [
    { name: 'James Karim', role: 'Email Marketing Manager, TechCorp', initials: 'JK', color: '#4F46E5', stars: 5, text: '"We cleaned a list of 25,000 emails and our bounce rate dropped from 12% to under 0.5%. BounceCure is now a permanent part of our workflow."' },
    { name: 'Sarah Rahman', role: 'Founder, GrowthStack Agency', initials: 'SR', color: '#10B981', stars: 5, text: '"The API integration took less than 30 minutes. Now every lead that hits our CRM gets verified automatically before we send a single email."' },
    { name: 'Marcus Lee', role: 'Head of Demand Gen, ScaleUp Inc.', initials: 'ML', color: '#F59E0B', stars: 5, text: '"The catch-all detection is a game changer. Other tools mark all catch-all domains as valid, costing me deliverability. Not BounceCure."' },
  ];

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: '#0f172a', overflowX: 'hidden', position: 'relative' }}>
      {/* ── NAV ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: scrolled ? '0.6rem 5%' : '0.9rem 5%',
        background: scrolled ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #e2e8f0',
        boxShadow: scrolled ? '0 4px 24px rgba(79,70,229,0.06)' : 'none',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Clickable Logo - Homepage Link */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', transition: 'transform 0.2s' }}
          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
          onMouseLeave={e => e.currentTarget.style.transform = ''}>
          <img src="/BounceCure logo design/bouncecure-lockup.svg" alt="BounceCure" style={{ height: '54px', width: 'auto', display: 'block' }} />
        </Link>

        {/* Desktop Links */}
        <ul style={{ display: 'flex', gap: '2rem', listStyle: 'none', margin: 0, padding: 0 }} className="lp-desktop-nav">
          {['About', 'Services', 'Pricing', 'Reviews', 'FAQ', 'Contact'].map(s => (
            <li key={s}>
              <a href={`#${s.toLowerCase()}`} className="nav-link">{s}</a>
            </li>
          ))}
        </ul>

        {/* Buttons Desktop */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }} className="lp-desktop-buttons">
          {user ? (
            <button onClick={() => navigate('/dashboard')} className="glow-on-hover" style={{ padding: '0.6rem 1.4rem', background: '#4F46E5', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}>Dashboard</button>
          ) : (
            <>
              <Link to="/login" style={{ padding: '0.6rem 1.2rem', border: '1.5px solid #4F46E5', color: '#4F46E5', borderRadius: '8px', fontWeight: 600, textDecoration: 'none', fontSize: '0.88rem', transition: 'all 0.2s' }}
                onMouseEnter={e => { e.target.style.background = 'rgba(79,70,229,0.05)' }}
                onMouseLeave={e => { e.target.style.background = 'none' }}>Log In</Link>
              <Link to="/register" className="glow-on-hover" style={{ padding: '0.6rem 1.4rem', background: '#4F46E5', color: 'white', borderRadius: '8px', fontWeight: 700, textDecoration: 'none', fontSize: '0.88rem', boxShadow: '0 4px 12px rgba(79,70,229,0.25)' }}>Get Started Free</Link>
            </>
          )}
        </div>

        {/* Mobile Menu Hamburger */}
        <button 
          onClick={() => setMobileOpen(!mobileOpen)} 
          className="lp-mobile-toggle"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.5rem',
            color: '#0f172a',
            zIndex: 1001,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileOpen && (
        <div className="mobile-menu-overlay">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '2rem', alignItems: 'center' }}>
            {['About', 'Services', 'Pricing', 'Reviews', 'FAQ', 'Contact'].map(s => (
              <li key={s}>
                <a href={`#${s.toLowerCase()}`} onClick={() => setMobileOpen(false)} style={{ color: 'white', textDecoration: 'none', fontWeight: 600, fontSize: '1.4rem', letterSpacing: '0.5px' }}>{s}</a>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '80%', maxWidth: '280px', marginTop: '1.5rem' }}>
            {user ? (
              <button onClick={() => { setMobileOpen(false); navigate('/dashboard'); }} style={{ padding: '0.85rem', background: '#4F46E5', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '1.1rem', textAlign: 'center' }}>Dashboard</button>
            ) : (
              <>
                <Link to="/login" onClick={() => setMobileOpen(false)} style={{ padding: '0.85rem', border: '1.5px solid white', color: 'white', borderRadius: '8px', fontWeight: 600, textDecoration: 'none', fontSize: '1.1rem', textAlign: 'center' }}>Log In</Link>
                <Link to="/register" onClick={() => setMobileOpen(false)} style={{ padding: '0.85rem', background: '#4F46E5', color: 'white', borderRadius: '8px', fontWeight: 700, textDecoration: 'none', fontSize: '1.1rem', textAlign: 'center', boxShadow: '0 4px 12px rgba(79,70,229,0.3)' }}>Get Started Free</Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── HERO ── */}
      <section id="hero" style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        textAlign: 'center', 
        padding: '9rem 5% 5rem', 
        background: 'radial-gradient(ellipse 80% 60% at 50% -5%, #EEF0FF 0%, transparent 65%), #fff',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Floating background blobs */}
        <div className="hero-blob hero-blob-1"></div>
        <div className="hero-blob hero-blob-2"></div>

        <div style={{ maxWidth: '780px', position: 'relative', zIndex: 1 }}>
          <div className="animate-hero-up" style={{ 
            animationDelay: '100ms',
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            background: '#EEF0FF', 
            color: '#4F46E5', 
            padding: '0.4rem 1.25rem', 
            borderRadius: '99px', 
            fontSize: '0.84rem', 
            fontWeight: 700, 
            border: '1px solid #C7C9FF', 
            marginBottom: '1.75rem' 
          }}>
            <span style={{ width: 8, height: 8, background: '#10B981', borderRadius: '50%', display: 'inline-block', animation: 'lp-pulse 2s infinite' }}></span>
            Trusted by 10,000+ marketers worldwide
          </div>
          
          <h1 className="animate-hero-up" style={{ animationDelay: '250ms', fontSize: 'clamp(2.5rem, 6vw, 4.4rem)', fontWeight: 950, lineHeight: 1.1, letterSpacing: '-1.8px', marginBottom: '1.5rem' }}>
            Stop Sending Emails<br />to <span style={{ color: '#4F46E5' }}>Dead Addresses</span>
          </h1>
          
          <p className="animate-hero-up" style={{ animationDelay: '400ms', fontSize: '1.15rem', color: '#64748b', lineHeight: 1.75, marginBottom: '2.5rem', maxWidth: '580px', margin: '0 auto 2.5rem', fontWeight: 500 }}>
            BounceCure verifies your email lists in seconds using real SMTP handshakes — protecting your sender reputation and boosting deliverability by up to 98%.
          </p>
          
          <div className="animate-hero-up" style={{ animationDelay: '550ms', display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '3rem' }}>
            <Link to="/register" className="glow-on-hover" style={{ padding: '0.95rem 2.4rem', background: '#4F46E5', color: 'white', borderRadius: '10px', fontWeight: 800, textDecoration: 'none', fontSize: '1rem', boxShadow: '0 4px 20px rgba(79,70,229,0.35)' }}>🚀 Start Free — 100 Credits</Link>
            <a href="#how" style={{ padding: '0.95rem 2.4rem', background: 'white', color: '#0f172a', borderRadius: '10px', fontWeight: 700, textDecoration: 'none', fontSize: '1rem', border: '2px solid #e2e8f0', transition: 'all 0.2s' }}
              onMouseEnter={e => e.target.style.borderColor = '#4F46E5'}
              onMouseLeave={e => e.target.style.borderColor = '#e2e8f0'}>▶ See How It Works</a>
          </div>
          
          {/* Demo Box */}
          <form onSubmit={handleDemo} className="animate-hero-up" style={{ animationDelay: '700ms', background: 'white', borderRadius: '14px', padding: '1.25rem 1.5rem', boxShadow: '0 20px 60px rgba(79,70,229,0.1)', border: '1px solid #e2e8f0', display: 'flex', gap: '0.75rem', maxWidth: '560px', margin: '0 auto 3.5rem' }}>
            <input type="email" value={demoEmail} onChange={e => setDemoEmail(e.target.value)} placeholder="Enter email to verify... e.g. test@company.com" style={{ flex: 1, padding: '0.75rem 1.1rem', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '0.92rem', outline: 'none', fontFamily: 'Inter, sans-serif', transition: 'border-color 0.2s' }} onFocus={e => e.target.style.borderColor = '#4F46E5'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
            <button type="submit" disabled={demoLoading} style={{ padding: '0.75rem 1.6rem', background: '#4F46E5', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'Inter, sans-serif', transition: 'all 0.2s' }} onMouseEnter={e => e.target.style.background = '#3730A3'} onMouseLeave={e => e.target.style.background = '#4F46E5'}>
              {demoLoading ? '...' : 'Verify'}
            </button>
          </form>
          
          {/* Stats - Dynamic Counter */}
          <div className="animate-hero-up" style={{ display: 'flex', gap: '3.5rem', justifyContent: 'center', flexWrap: 'wrap', animationDelay: '850ms' }}>
            <AnimatedCounter target="99.5" suffix="%" label="Accuracy Rate" />
            <AnimatedCounter target="2.1" suffix="B+" label="Emails Verified" />
            <AnimatedCounter target="1.8" suffix="s" label="Avg. Verify Time" />
            <AnimatedCounter target="10" suffix="k+" label="Happy Customers" />
          </div>
        </div>
      </section>

      {/* ── TRUSTED BY ── */}
      <div style={{ background: '#f8fafc', padding: '2.5rem 5%', textAlign: 'center', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
        <p style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Trusted by teams at</p>
        <div style={{ display: 'flex', gap: '3.5rem', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          {['Shopify', 'HubSpot', 'Mailchimp', 'Klaviyo', 'ActiveCampaign', 'ConvertKit'].map(b => (
            <span key={b} style={{ fontSize: '1.1rem', fontWeight: 900, color: '#CBD5E1', letterSpacing: '-0.5px', transition: 'color 0.2s', cursor: 'default' }}
              onMouseEnter={e => e.target.style.color = '#94A3B8'}
              onMouseLeave={e => e.target.style.color = '#CBD5E1'}>{b}</span>
          ))}
        </div>
      </div>

      {/* ── ABOUT ── */}
      <section id="about" style={{ padding: '7rem 5%', background: 'white' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5rem', alignItems: 'center', maxWidth: '1050px', margin: '0 auto' }} className="lp-about-grid">
          <div style={{ background: '#EEF0FF', borderRadius: '20px', padding: '2.5rem', minHeight: '340px' }} className="lp-animate">
            {[['📋', '#4F46E5', 'Syntax Validation', 'RFC 5322 compliance check'], ['🌐', '#4F46E5', 'DNS MX Lookup', 'Mail server existence check'], ['🔗', '#4F46E5', 'SMTP Handshake', 'Real-time mailbox ping'], ['✔', '#10B981', 'Catch-All Detection', 'Random probe technique']].map(([icon, bg, t, d], idx) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', background: 'white', padding: '1.1rem 1.4rem', borderRadius: '14px', marginBottom: '0.9rem', boxShadow: '0 4px 12px rgba(79,70,229,0.06)', transitionDelay: `${idx * 100}ms` }}>
                <div style={{ width: 42, height: 42, background: bg, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '1.1rem', flexShrink: 0 }}>{icon}</div>
                <div><strong style={{ fontSize: '0.92rem', display: 'block', color: '#0f172a' }}>{t}</strong><span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>{d}</span></div>
              </div>
            ))}
          </div>
          <div className="lp-animate" style={{ transitionDelay: '200ms' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#4F46E5', marginBottom: '0.6rem' }}>About BounceCure</div>
            <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)', fontWeight: 900, marginBottom: '0.9rem', letterSpacing: '-0.8px', color: '#0f172a' }}>We Don't Guess. We <span style={{ color: '#4F46E5' }}>Verify.</span></h2>
            <div style={{ width: 44, height: 4, background: 'linear-gradient(90deg, #4F46E5, #10B981)', borderRadius: 2, marginBottom: '1.75rem' }}></div>
            <p style={{ color: '#64748b', lineHeight: 1.8, fontSize: '0.98rem', marginBottom: '1.75rem', fontWeight: 500 }}>BounceCure uses real SMTP handshake technology to check if a mailbox genuinely exists — without ever sending a single email. No guessing, no assumptions, just accurate results.</p>
            {['5-step deep verification pipeline for maximum accuracy', 'Catch-All detection using randomized probe technique', '7,500+ disposable domain blocklist, updated daily', 'REST API for seamless integration into any workflow'].map(pt => (
              <div key={pt} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.9rem', fontSize: '0.92rem', color: '#475569', fontWeight: 500 }}>
                <span style={{ width: 22, height: 22, background: '#D1FAE5', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#10B981', fontSize: '0.75rem', fontWeight: 800, flexShrink: 0 }}>✓</span>
                {pt}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SERVICES ── */}
      <section id="services" style={{ padding: '7rem 5%', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }} className="lp-animate">
          <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#4F46E5', marginBottom: '0.6rem' }}>Our Services</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)', fontWeight: 900, letterSpacing: '-0.8px', color: '#0f172a' }}>Everything to Keep Your List Clean</h2>
          <div style={{ width: 44, height: 4, background: 'linear-gradient(90deg, #4F46E5, #10B981)', borderRadius: 2, margin: '1rem auto 0' }}></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', maxWidth: '1050px', margin: '0 auto' }}>
          {services.map((s, idx) => (
            <div key={s.title} className="lp-animate lp-hover-card" style={{ 
              transitionDelay: `${idx * 100}ms`,
              background: 'white', borderRadius: '14px', padding: '1.85rem', border: '1px solid #e2e8f0', cursor: 'default'
            }}>
              <div style={{ width: 50, height: 50, borderRadius: '12px', background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.35rem', marginBottom: '1.25rem' }}>{s.icon}</div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' }}>{s.title}</h3>
              <p style={{ fontSize: '0.88rem', color: '#64748b', lineHeight: 1.65, fontWeight: 500 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how" style={{ padding: '7rem 5%', background: 'white' }}>
        <div style={{ textAlign: 'center', marginBottom: '4.5rem' }} className="lp-animate">
          <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#4F46E5', marginBottom: '0.6rem' }}>How It Works</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)', fontWeight: 900, letterSpacing: '-0.8px', color: '#0f172a' }}>Verify in 4 Simple Steps</h2>
          <div style={{ width: 44, height: 4, background: 'linear-gradient(90deg, #4F46E5, #10B981)', borderRadius: 2, margin: '1rem auto 0' }}></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '2.5rem', maxWidth: '950px', margin: '0 auto' }}>
          {[
            ['1', 'Upload or Paste', 'Enter a single email, paste a bulk list, or upload your CSV directly.'],
            ['2', 'Deep Analysis', 'Our engine checks syntax, DNS, SMTP, and runs a catch-all probe automatically.'],
            ['3', 'Get Results', 'View instant results — Valid, Invalid, Catch-All, or Disposable for every address.'],
            ['4', 'Export & Send', 'Download your cleaned list as CSV. Send only to verified emails and watch deliverability soar.']
          ].map(([n, t, d], idx) => (
            <div key={n} className="lp-animate" style={{ textAlign: 'center', transitionDelay: `${idx * 120}ms` }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#4F46E5', color: 'white', fontSize: '1.4rem', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', boxShadow: '0 8px 24px rgba(79,70,229,0.25)', transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.12) rotate(8deg)'}
                onMouseLeave={e => e.currentTarget.style.transform = ''}>
                {n}
              </div>
              <h3 style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '1.05rem', color: '#0f172a' }}>{t}</h3>
              <p style={{ fontSize: '0.88rem', color: '#64748b', lineHeight: 1.65, fontWeight: 500 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" style={{ padding: '7rem 5%', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }} className="lp-animate">
          <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#4F46E5', marginBottom: '0.6rem' }}>Pricing</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)', fontWeight: 900, letterSpacing: '-0.8px', color: '#0f172a' }}>Simple, Transparent Pricing</h2>
          <div style={{ width: 44, height: 4, background: 'linear-gradient(90deg, #4F46E5, #10B981)', borderRadius: 2, margin: '1rem auto 1.25rem' }}></div>
          <p style={{ color: '#64748b', maxWidth: '500px', margin: '0 auto', fontSize: '0.98rem', lineHeight: 1.7, fontWeight: 500 }}>No subscriptions. Buy credits and use them whenever — they never expire.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '1.75rem', maxWidth: '900px', margin: '0 auto', alignItems: 'start' }}>
          {[
            { name: 'Free', price: 0, credits: '100 Credits on Sign Up', popular: false, features: ['Single email verification', 'Bulk paste (up to 100)', 'CSV upload', 'API access'], cta: 'Get Started Free', link: '/register' },
            { name: 'Starter', price: 10, credits: '5,000 Email Credits', popular: true, features: ['Everything in Free', 'Priority processing', 'Bulk up to 5,000', 'CSV download', 'Email support'], cta: 'Buy Starter Pack', link: '/dashboard/billing' },
            { name: 'Pro', price: 50, credits: '50,000 Email Credits', popular: false, features: ['Everything in Starter', 'Bulk up to 50,000', 'Advanced API access', 'Priority support', 'Credits never expire'], cta: 'Buy Pro Pack', link: '/dashboard/billing' },
          ].map((p, idx) => (
            <div key={p.name} className="lp-animate lp-hover-card" style={{ 
              transitionDelay: `${idx * 150}ms`,
              background: 'white', borderRadius: '18px', padding: '2.25rem', border: p.popular ? '2px solid #4F46E5' : '1.5px solid #e2e8f0', position: 'relative', 
              boxShadow: p.popular ? '0 12px 40px rgba(79,70,229,0.12)' : 'none'
            }}>
              {p.popular && <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: '#4F46E5', color: 'white', padding: '0.35rem 1.3rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 800, whiteSpace: 'nowrap', letterSpacing: '0.5px' }}>⭐ Most Popular</div>}
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.4rem' }}>{p.name}</div>
              <div style={{ fontSize: '2.8rem', fontWeight: 900, letterSpacing: '-2px', marginBottom: '0.25rem', color: '#0f172a' }}><sup style={{ fontSize: '1.1rem', verticalAlign: 'top', marginTop: '0.6rem', display: 'inline-block' }}>$</sup>{p.price}</div>
              <div style={{ fontSize: '0.88rem', color: '#10B981', fontWeight: 700, marginBottom: '1.5rem' }}>✔ {p.credits}</div>
              <ul style={{ listStyle: 'none', marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', padding: 0 }}>
                {p.features.map(f => <li key={f} style={{ fontSize: '0.88rem', color: '#475569', display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 500 }}><span style={{ color: '#10B981', fontWeight: 800 }}>✓</span>{f}</li>)}
              </ul>
              <Link to={p.link} className="glow-on-hover" style={{ display: 'block', width: '100%', padding: '0.85rem', borderRadius: '10px', fontWeight: 700, textAlign: 'center', textDecoration: 'none', fontSize: '0.95rem', background: p.popular ? '#4F46E5' : 'white', color: p.popular ? 'white' : '#4F46E5', border: p.popular ? 'none' : '2px solid #4F46E5', boxShadow: p.popular ? '0 4px 16px rgba(79,70,229,0.2)' : 'none' }}>{p.cta}</Link>
            </div>
          ))}
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section id="reviews" style={{ padding: '7rem 5%', background: '#0F0F1A', color: 'white' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }} className="lp-animate">
          <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#C7C9FF', marginBottom: '0.6rem' }}>Testimonials</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)', fontWeight: 900, color: 'white', letterSpacing: '-0.8px' }}>What Our Customers Say</h2>
          <div style={{ width: 44, height: 4, background: 'linear-gradient(90deg, #4F46E5, #10B981)', borderRadius: 2, margin: '1rem auto 0' }}></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '1.75rem', maxWidth: '1050px', margin: '0 auto' }}>
          {testimonials.map((t, idx) => (
            <div key={t.name} className="lp-animate" style={{ 
              transitionDelay: `${idx * 150}ms`,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '2rem', transition: 'all 0.3s' 
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.transform = ''; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}>
              <div style={{ color: '#FBBF24', fontSize: '0.95rem', letterSpacing: '2px', marginBottom: '1.1rem' }}>{'★'.repeat(t.stars)}</div>
              <p style={{ fontSize: '0.94rem', color: '#CBD5E1', lineHeight: 1.8, marginBottom: '1.75rem', fontStyle: 'italic', fontWeight: 400 }}>{t.text}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.9rem', color: 'white', flexShrink: 0 }}>{t.initials}</div>
                <div><strong style={{ display: 'block', fontSize: '0.9rem', color: 'white' }}>{t.name}</strong><span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 500 }}>{t.role}</span></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" style={{ padding: '7rem 5%', background: 'white' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }} className="lp-animate">
          <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#4F46E5', marginBottom: '0.6rem' }}>FAQ</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)', fontWeight: 900, letterSpacing: '-0.8px', color: '#0f172a' }}>Frequently Asked Questions</h2>
          <div style={{ width: 44, height: 4, background: 'linear-gradient(90deg, #4F46E5, #10B981)', borderRadius: 2, margin: '1rem auto 0' }}></div>
        </div>
        <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {faqs.map((f, i) => (
            <div key={i} className="lp-animate" style={{ 
              transitionDelay: `${i * 100}ms`,
              border: `1.5px solid ${openFaq === i ? '#C7C9FF' : '#e2e8f0'}`, borderRadius: '12px', overflow: 'hidden', transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' 
            }}>
              <div onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem', gap: '1rem', userSelect: 'none', color: openFaq === i ? '#4F46E5' : '#0f172a' }}>
                {f.q}
                <span style={{ color: '#4F46E5', fontSize: '1.4rem', transition: 'transform 0.3s ease-in-out', transform: openFaq === i ? 'rotate(45deg)' : 'none', flexShrink: 0 }}>+</span>
              </div>
              <div style={{ maxHeight: openFaq === i ? '200px' : '0', overflow: 'hidden', transition: 'max-height 0.35s ease, padding 0.35s', padding: openFaq === i ? '0 1.5rem 1.25rem' : '0 1.5rem', fontSize: '0.9rem', color: '#64748b', lineHeight: 1.75, fontWeight: 500 }}>
                {f.a}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CONTACT ── */}
      <section id="contact" style={{ padding: '7rem 5%', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }} className="lp-animate">
          <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#4F46E5', marginBottom: '0.6rem' }}>Contact Us</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.6rem)', fontWeight: 900, letterSpacing: '-0.8px', color: '#0f172a' }}>Get In Touch</h2>
          <div style={{ width: 44, height: 4, background: 'linear-gradient(90deg, #4F46E5, #10B981)', borderRadius: 2, margin: '1rem auto 0' }}></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '4rem', maxWidth: '950px', margin: '0 auto' }} className="lp-contact-grid">
          <div className="lp-animate" style={{ transitionDelay: '100ms' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '1.1rem', color: '#0f172a' }}>We'd Love to Hear From You</h3>
            <p style={{ color: '#64748b', lineHeight: 1.75, marginBottom: '2rem', fontSize: '0.95rem', fontWeight: 500 }}>Have a question about pricing, need enterprise solutions, or just want to say hello? We typically respond within a few hours.</p>
            {[['📧', 'support@bouncecure.io'], ['💬', 'Live chat 9am–6pm (GMT+6)'], ['📍', 'Dhaka, Bangladesh'], ['🐦', '@BounceCure']].map(([icon, text]) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1rem', fontSize: '0.92rem', color: '#475569', fontWeight: 500 }}>
                <div style={{ width: 36, height: 36, background: '#EEF0FF', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '#4F46E5', flexShrink: 0 }}>{icon}</div>
                {text}
              </div>
            ))}
          </div>
          <div className="lp-animate" style={{ background: 'white', borderRadius: '16px', padding: '2.5rem', border: '1px solid #e2e8f0', transitionDelay: '250ms', boxShadow: '0 8px 30px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
              {['First Name', 'Last Name'].map(l => (
                <div key={l}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.45rem', color: '#334155' }}>{l}</label>
                  <input type="text" placeholder={l === 'First Name' ? 'John' : 'Doe'} style={{ width: '100%', padding: '0.75rem 1rem', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none', fontFamily: 'Inter, sans-serif', transition: 'border-color 0.2s' }} onFocus={e => e.target.style.borderColor = '#4F46E5'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                </div>
              ))}
            </div>
            {[['Email Address', 'email', 'john@company.com'], ['Subject', 'text', 'How can we help?']].map(([l, t, ph]) => (
              <div key={l} style={{ marginTop: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.45rem', color: '#334155' }}>{l}</label>
                <input type={t} placeholder={ph} style={{ width: '100%', padding: '0.75rem 1rem', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none', fontFamily: 'Inter, sans-serif', transition: 'border-color 0.2s' }} onFocus={e => e.target.style.borderColor = '#4F46E5'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
              </div>
            ))}
            <div style={{ marginTop: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.45rem', color: '#334155' }}>Message</label>
              <textarea placeholder="Tell us more about your needs..." style={{ width: '100%', minHeight: '110px', padding: '0.75rem 1rem', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none', fontFamily: 'Inter, sans-serif', resize: 'vertical', transition: 'border-color 0.2s' }} onFocus={e => e.target.style.borderColor = '#4F46E5'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
            </div>
            <button className="btn-primary glow-on-hover" style={{ width: '100%', marginTop: '1.5rem', padding: '0.85rem', background: '#4F46E5', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif', boxShadow: '0 4px 16px rgba(79,70,229,0.3)' }}>Send Message →</button>
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <div style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #3730A3 100%)', padding: '6rem 2rem', textAlign: 'center', color: 'white', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 950, marginBottom: '1rem', letterSpacing: '-0.8px' }}>Ready to Clean Your List?</h2>
          <p style={{ fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)', marginBottom: '2.5rem', maxWidth: '480px', margin: '0 auto 2.5rem', fontWeight: 500 }}>Join 10,000+ marketers who trust BounceCure to protect their sender reputation.</p>
          <Link to="/register" className="glow-on-hover" style={{ padding: '1rem 2.75rem', background: 'white', color: '#4F46E5', borderRadius: '10px', fontWeight: 800, textDecoration: 'none', fontSize: '1.02rem', display: 'inline-block', boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}>Start Free — 100 Credits Included</Link>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer style={{ background: '#16161D', color: '#94A3B8', padding: '5rem 5% 2.5rem', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '4rem', marginBottom: '4rem' }} className="lp-contact-grid">
          <div>
            <Link to="/" style={{ display: 'inline-block', background: 'white', borderRadius: '12px', padding: '0.75rem 1.5rem', marginBottom: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.04)', transition: 'transform 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
              onMouseLeave={e => e.currentTarget.style.transform = ''}>
              <img src="/BounceCure logo design/bouncecure-lockup.svg" alt="BounceCure" style={{ height: '48px', width: 'auto', display: 'block' }} />
            </Link>
            <p style={{ fontSize: '0.88rem', lineHeight: 1.75, maxWidth: '280px', fontWeight: 500 }}>Enterprise-grade email verification powered by real SMTP handshake technology.</p>
          </div>
          {[
            ['Product', ['Single Verify', 'Bulk Verify', 'CSV Cleaning', 'API Access', 'Pricing']],
            ['Company', ['About Us', 'Reviews', 'Contact', 'Blog', 'Careers']],
            ['Legal', ['Privacy Policy', 'Terms of Service', 'Cookie Policy', 'GDPR']]
          ].map(([title, links]) => (
            <div key={title}>
              <h4 style={{ color: 'white', fontSize: '0.9rem', fontWeight: 700, marginBottom: '1.5rem', letterSpacing: '0.5px' }}>{title}</h4>
              {links.map(l => <a key={l} href="#" style={{ display: 'block', color: '#94A3B8', fontSize: '0.85rem', textDecoration: 'none', marginBottom: '0.75rem', fontWeight: 500, transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'white'} onMouseLeave={e => e.target.style.color = '#94A3B8'}>{l}</a>)}
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', flexWrap: 'wrap', gap: '1.5rem', fontWeight: 500 }}>
          <div>© 2026 BounceCure. All rights reserved.</div>
          <div style={{ display: 'flex', gap: '1.75rem' }}>
            {['Twitter', 'LinkedIn', 'GitHub'].map(s => <a key={s} href="#" style={{ color: '#94A3B8', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'white'} onMouseLeave={e => e.target.style.color = '#94A3B8'}>{s}</a>)}
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes lp-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(1.3)} }
        
        .lp-mobile-toggle {
          display: none !important;
        }

        @media(max-width:768px){
          .lp-about-grid{ grid-template-columns:1fr !important; gap:2.5rem !important; }
          .lp-contact-grid{ grid-template-columns:1fr !important; gap:3rem !important; }
          .lp-desktop-nav{ display:none !important; }
          .lp-desktop-buttons{ display:none !important; }
          .lp-mobile-toggle { display: flex !important; }
        }
      `}</style>
    </div>
  );
};

/* ══════════════════════════════════════════
   AUTH PAGES
══════════════════════════════════════════ */
const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (data.error) throw new Error(data.error);
      login(data.token, data.user);
      navigate('/dashboard');
    } catch (err) { setError(err.message || 'Login failed'); }
  };

  return (
    <div className="auth-container animate-fade-in">
      <div className="auth-left">
        <Link to="/" className="auth-logo-wrap">
          <img src="/BounceCure logo design/bouncecure-lockup.svg" alt="BounceCure" />
        </Link>
        <p>Enterprise-grade email verification for serious marketers.</p>
        <div className="auth-features">
          <div className="auth-feature-item">Real SMTP Handshake Verification</div>
          <div className="auth-feature-item">Catch-All Detection</div>
          <div className="auth-feature-item">7,500+ Disposable Domain Blocklist</div>
          <div className="auth-feature-item">REST API Access</div>
        </div>
      </div>
      <div className="auth-right">
        <div className="auth-form-container">
          <div className="auth-title">Welcome Back</div>
          <div className="auth-subtitle">Log in to your account</div>
          {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.9rem', background: '#fee2e2', padding: '0.7rem 1rem', borderRadius: '8px' }}>{error}</div>}
          <form onSubmit={handleSubmit} className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder="you@company.com" required />
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-field" placeholder="••••••••" required />
            <button type="submit" className="btn-primary" style={{ marginTop: '1.25rem' }}>Sign In →</button>
          </form>
          <div style={{ marginTop: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Don't have an account? <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 700 }}>Register Free</Link>
          </div>
          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <Link to="/" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>← Back to Home</Link>
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      }).then(r => r.json());
      if (data.error) throw new Error(data.error);
      alert('Registration successful! Please login.');
      navigate('/login');
    } catch (err) { setError(err.message || 'Registration failed'); }
  };

  return (
    <div className="auth-container animate-fade-in">
      <div className="auth-left">
        <Link to="/" className="auth-logo-wrap">
          <img src="/BounceCure logo design/bouncecure-lockup.svg" alt="BounceCure" />
        </Link>
        <p>Start verifying emails with 100 free credits — no credit card required.</p>
        <div className="auth-features">
          <div className="auth-feature-item">100 Free Credits on Sign Up</div>
          <div className="auth-feature-item">No Credit Card Required</div>
          <div className="auth-feature-item">Instant Access to All Features</div>
          <div className="auth-feature-item">Credits Never Expire</div>
        </div>
      </div>
      <div className="auth-right">
        <div className="auth-form-container">
          <div className="auth-title">Create Account</div>
          <div className="auth-subtitle">Sign up and get 100 free credits</div>
          {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.9rem', background: '#fee2e2', padding: '0.7rem 1rem', borderRadius: '8px' }}>{error}</div>}
          <form onSubmit={handleSubmit} className="form-group">
            <label>Email Address</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder="you@company.com" required />
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-field" placeholder="Min. 6 characters" required />
            <button type="submit" className="btn-primary" style={{ marginTop: '1.25rem' }}>Create Free Account →</button>
          </form>
          <div style={{ marginTop: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Already have an account? <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 700 }}>Login</Link>
          </div>
          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <Link to="/" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'none' }}>← Back to Home</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   DASHBOARD LAYOUT
══════════════════════════════════════════ */
const DashboardLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="dashboard-container animate-fade-in">
      <div className="sidebar">
        <div className="sidebar-header" style={{ padding: '1rem 1.25rem' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
            <img src="/BounceCure logo design/bouncecure-lockup.svg" alt="BounceCure" style={{ height: '46px', width: 'auto', display: 'block' }} />
          </Link>
        </div>
        <div className="sidebar-nav">
          <Link to="/dashboard" className={`nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`}><LayoutDashboard size={17} /> Dashboard</Link>
          <Link to="/dashboard/single" className={`nav-item ${location.pathname === '/dashboard/single' ? 'active' : ''}`}><Search size={17} /> Single Verify</Link>
          <Link to="/dashboard/bulk" className={`nav-item ${location.pathname === '/dashboard/bulk' ? 'active' : ''}`}><List size={17} /> Bulk Verification</Link>
          <Link to="/dashboard/csv" className={`nav-item ${location.pathname === '/dashboard/csv' ? 'active' : ''}`}><Upload size={17} /> Clean a List</Link>
          <Link to="/dashboard/api-docs" className={`nav-item ${location.pathname === '/dashboard/api-docs' ? 'active' : ''}`}><FileText size={17} /> API Docs</Link>
          <Link to="/dashboard/billing" className={`nav-item ${location.pathname === '/dashboard/billing' ? 'active' : ''}`}><CreditCard size={17} /> Billing & Credits</Link>
          {(user?.role === 'admin' || user?.role === 'super_admin') && (
            <Link to="/dashboard/admin" className={`nav-item ${location.pathname === '/dashboard/admin' ? 'active' : ''}`}><ShieldAlert size={17} /> Admin Panel</Link>
          )}
          <div style={{ flex: 1 }}></div>
          <button onClick={logout} className="nav-item" style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}><LogOut size={17} /> Logout</button>
        </div>
      </div>
      <div className="main-content">
        <div className="top-header">
          <div style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{user?.email}</div>
          <div className="credits-badge">💰 Credits: {user?.credits ?? 0}</div>
        </div>
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   SHARED COMPONENTS
══════════════════════════════════════════ */
const StatusIcon = ({ status }) => {
  switch (status) {
    case 'valid':     return <CheckCircle size={17} color="#059669" />;
    case 'invalid':   return <XCircle size={17} color="#dc2626" />;
    case 'catch-all': return <AlertCircle size={17} color="#d97706" />;
    default:          return <HelpCircle size={17} color="#64748b" />;
  }
};

const ResultsTable = ({ results }) => {
  if (!results || results.length === 0) return null;
  const exportCSV = () => {
    const headers = ['Email', 'Status', 'Syntax', 'Disposable', 'MX Found', 'SMTP Code', 'Catch-All', 'Reason'];
    const csv = [headers.join(','), ...results.map(r => [r.email, r.status, r.syntax, r.disposable, r.mxFound, r.smtpCode, r.isCatchAll, `"${r.reason.replace(/"/g, '""')}"`].join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'bouncecure_results.csv';
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  return (
    <div className="results-table-wrapper animate-fade-in">
      <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Results ({results.length})</h3>
        <button onClick={exportCSV} className="btn-secondary"><Download size={15} /> Export CSV</button>
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
                  <span className={`badge ${res.status || 'unknown'}`}>{(res.status || 'unknown').toUpperCase()}</span>
                </div>
              </td>
              <td style={{color:'var(--text-secondary)', fontSize:'0.88rem'}}>{res.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ══════════════════════════════════════════
   DASHBOARD PAGES
══════════════════════════════════════════ */
const DashboardHome = () => {
  const { user } = useAuth();
  return (
    <div>
      <div className="page-title">Dashboard Overview</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Available Credits</div>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--primary)' }}>{user?.credits}</div>
        </div>
        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Account Role</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, textTransform: 'capitalize' }}>{user?.role?.replace('_', ' ')}</div>
        </div>
      </div>
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
    if (!email) return;
    setLoading(true);
    try {
      const data = await apiFetch('/verify', { method: 'POST', body: JSON.stringify({ email }) });
      if (data.error) throw new Error(data.error);
      setResult(data);
      setUser({ ...user, credits: user.credits - 1 });
    } catch (err) { alert(err.message); }
    setLoading(false);
  };
  return (
    <div className="card" style={{ padding: '2rem', maxWidth: '600px' }}>
      <div className="page-title">Single Verification</div>
      <form onSubmit={handleVerify} className="form-group">
        <label>Email Address</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder="test@domain.com" required />
        <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '1rem' }}>
          {loading ? <Loader2 className="loader" size={17} /> : <Search size={17} />} Verify Email
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
    const arr = emails.split('\n').map(e => e.trim()).filter(e => e);
    if (!arr.length) return;
    setLoading(true);
    try {
      const data = await apiFetch('/verify/bulk', { method: 'POST', body: JSON.stringify({ emails: arr }) });
      if (data.error) throw new Error(data.error);
      setResults(data.results);
      setUser({ ...user, credits: user.credits - data.results.length });
    } catch (err) { alert(err.message); }
    setLoading(false);
  };
  return (
    <div className="card" style={{ padding: '2rem' }}>
      <div className="page-title">Bulk Verification</div>
      <form onSubmit={handleVerify} className="form-group">
        <label>Paste Emails (one per line)</label>
        <textarea value={emails} onChange={e => setEmails(e.target.value)} className="input-field" style={{ minHeight: '200px' }} required />
        <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '1rem', width: 'max-content' }}>
          {loading ? <Loader2 className="loader" size={17} /> : <List size={17} />} Verify List
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
  const fileInputRef = useRef(null);
  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setLoading(true);
    try {
      const data = await apiFetch('/verify/csv', { method: 'POST', body: formData });
      if (data.error) throw new Error(data.error);
      setResults(data.results);
      setUser({ ...user, credits: user.credits - data.results.length });
      setFile(null);
    } catch (err) { alert(err.message); }
    setLoading(false);
  };
  return (
    <div className="card" style={{ padding: '2rem' }}>
      <div className="page-title">Clean a List (CSV)</div>
      <div className="upload-area" onClick={() => fileInputRef.current.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
        onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
        onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}>
        <input type="file" accept=".csv" ref={fileInputRef} onChange={e => setFile(e.target.files[0])} style={{ display: 'none' }} />
        <Upload size={44} color="var(--primary)" />
        <p style={{ fontSize: '1.1rem', fontWeight: 500 }}>{file ? file.name : 'Drag & Drop your CSV, or click to browse'}</p>
      </div>
      <button onClick={handleUpload} className="btn-primary" disabled={!file || loading} style={{ marginTop: '1.5rem', width: 'max-content' }}>
        {loading ? <Loader2 className="loader" size={17} /> : <Upload size={17} />} Process CSV List
      </button>
      <ResultsTable results={results} />
    </div>
  );
};

const ApiDocs = () => (
  <div className="card" style={{ padding: '2rem', maxWidth: '800px' }}>
    <div className="page-title">API Documentation</div>
    <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>Integrate BounceCure's verification engine directly into your own applications.</p>
    <div style={{ background: 'var(--bg-color)', padding: '1rem 1.25rem', borderRadius: '8px', marginBottom: '2rem' }}>
      <strong>Authentication</strong>
      <p style={{ fontSize: '0.88rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>All API requests require your Bearer token in the Authorization header.</p>
      <code style={{ display: 'block', padding: '0.9rem 1rem', background: '#1e293b', color: '#f8fafc', borderRadius: '6px', marginTop: '0.75rem', fontSize: '0.88rem' }}>Authorization: Bearer YOUR_TOKEN_HERE</code>
    </div>
    {[['1. Single Email Verification', 'POST', '/verify', `curl -X POST http://localhost:3001/verify \\\n  -H "Authorization: Bearer YOUR_TOKEN_HERE" \\\n  -H "Content-Type: application/json" \\\n  -d '{"email": "test@example.com"}'`],
      ['2. Bulk Email Verification', 'POST', '/verify/bulk', `curl -X POST http://localhost:3001/verify/bulk \\\n  -H "Authorization: Bearer YOUR_TOKEN_HERE" \\\n  -H "Content-Type: application/json" \\\n  -d '{"emails": ["test1@example.com", "test2@example.com"]}'`]
    ].map(([title, method, path, code]) => (
      <div key={title} style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '0.75rem' }}>{title}</h3>
        <div style={{ background: 'var(--bg-color)', padding: '1rem 1.25rem', borderRadius: '8px' }}>
          <span className="badge valid" style={{ marginRight: '0.5rem' }}>{method}</span><strong>{path}</strong>
          <pre style={{ padding: '0.9rem 1rem', background: '#1e293b', color: '#f8fafc', borderRadius: '6px', marginTop: '0.75rem', overflowX: 'auto', fontSize: '0.82rem', lineHeight: 1.65 }}>{code}</pre>
        </div>
      </div>
    ))}
  </div>
);

const Billing = () => {
  const [loading, setLoading] = useState(false);
  const handleCheckout = async (packageId) => {
    setLoading(true);
    try {
      const { url } = await apiFetch('/api/checkout', { method: 'POST', body: JSON.stringify({ packageId }) });
      if (url) window.location.href = url;
    } catch (err) { alert(err.message); setLoading(false); }
  };
  return (
    <div>
      <div className="page-title">Buy Credits</div>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        {[{ id: 'starter', name: 'Starter', price: '$10', credits: '5,000 Credits', popular: false },
          { id: 'pro', name: 'Pro', price: '$50', credits: '50,000 Credits', popular: true }].map(p => (
          <div key={p.id} className="card" style={{ padding: '2rem', flex: 1, minWidth: '260px', textAlign: 'center', border: p.popular ? '2px solid var(--primary)' : '1px solid var(--border-color)', position: 'relative' }}>
            {p.popular && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--primary)', color: 'white', padding: '0.2rem 1rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700 }}>Most Popular</div>}
            <h3 style={{ color: 'var(--primary)', marginBottom: '0.5rem' }}>{p.name}</h3>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0.75rem 0' }}>{p.price}</div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.75rem', fontSize: '0.9rem' }}>{p.credits}</p>
            <button onClick={() => handleCheckout(p.id)} className="btn-primary" disabled={loading}>
              {loading ? <Loader2 className="loader" size={17} /> : <CreditCard size={17} />} Buy Now
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const AdminPanel = () => {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async (q = '') => {
    setLoading(true);
    try {
      const data = await apiFetch(`/admin/users?search=${encodeURIComponent(q)}`);
      if (Array.isArray(data)) setUsers(data);
      else setUsers([]);
    } catch (err) { console.error('fetchUsers error:', err); setUsers([]); }
    setLoading(false);
  };

  const handleAddCredits = async (id, amount) => {
    if (!window.confirm(`Add ${amount} credits to this user?`)) return;
    try {
      await apiFetch(`/admin/users/${id}/credits`, { method: 'POST', body: JSON.stringify({ amount }) });
      fetchUsers(search);
    } catch (err) { alert(err.message); }
  };

  return (
    <div className="card" style={{ padding: '2rem' }}>
      <div className="page-title"><ShieldAlert size={20} /> Admin Panel</div>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <input type="text" className="input-field" placeholder="Search by email..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && fetchUsers(search)} />
        <button className="btn-secondary" onClick={() => fetchUsers(search)}>Search</button>
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: '2rem' }}><Loader2 className="loader" size={30} /></div> : (
        <div className="results-table-wrapper">
          <table className="results-table">
            <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Credits</th><th>Actions</th></tr></thead>
            <tbody>
              {users.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>No users found</td></tr>}
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ color: 'var(--text-secondary)' }}>#{u.id}</td>
                  <td><strong>{u.email}</strong></td>
                  <td><span className="badge" style={{ background: u.role === 'super_admin' ? '#EEF0FF' : u.role === 'admin' ? '#D1FAE5' : '#f1f5f9', color: u.role === 'super_admin' ? '#4F46E5' : u.role === 'admin' ? '#059669' : '#64748b' }}>{u.role}</span></td>
                  <td><strong>{u.credits}</strong></td>
                  <td><button onClick={() => handleAddCredits(u.id, 1000)} className="btn-secondary" style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}>+1,000 Credits</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════
   ROUTING
══════════════════════════════════════════ */
const ProtectedRoute = ({ children }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  return <DashboardLayout>{children}</DashboardLayout>;
};

function AppRoutes() {
  return (
    <Routes>
      {/* Home = Landing Page */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
      <Route path="/dashboard/single" element={<ProtectedRoute><SingleVerify /></ProtectedRoute>} />
      <Route path="/dashboard/bulk" element={<ProtectedRoute><BulkVerify /></ProtectedRoute>} />
      <Route path="/dashboard/csv" element={<ProtectedRoute><CsvVerify /></ProtectedRoute>} />
      <Route path="/dashboard/api-docs" element={<ProtectedRoute><ApiDocs /></ProtectedRoute>} />
      <Route path="/dashboard/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
      <Route path="/dashboard/admin" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>} />
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
