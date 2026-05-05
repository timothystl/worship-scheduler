// ── Member Portal SPA ─────────────────────────────────────────────────────────
export const PORTAL_MANIFEST_JSON = '{"name":"TLC Member Portal","short_name":"TLC Members","description":"Church directory, schedule, and prayer requests for Timothy Lutheran Church members","start_url":"/portal","display":"standalone","theme_color":"#0A3C5C","background_color":"#EDF5F8","scope":"/portal","icons":[{"src":"/tlc-logo.png","sizes":"500x500","type":"image/png","purpose":"any maskable"}]}';

export const PORTAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>TLC Member Portal</title>
<link rel="manifest" href="/portal.webmanifest">
<meta name="theme-color" content="#0A3C5C">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="TLC Members">
<link rel="apple-touch-icon" href="/tlc-logo.png">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --steel:#0A3C5C;--deep-steel:#2A5470;--sky:#5C8FA8;--ice:#C4DDE8;--mist:#EDF5F8;
  --amber:#D4922A;--sage:#6B8F71;--pale-sage:#CDE0CF;
  --linen:#F2EDE2;--white:#fff;--border:#E8E0D0;--charcoal:#3D3530;--warm-gray:#7A6E60;
  --danger:#B85C3A;--faint:#9CA3AF;
  --font:'Helvetica Neue',Arial,sans-serif;
  --nav-h:64px;
}
html,body{height:100%;overflow:hidden;font-family:var(--font);background:var(--mist);color:var(--charcoal);}
/* ── Auth screens ── */
#auth-screen{display:flex;justify-content:center;align-items:center;min-height:100%;padding:24px;}
.auth-card{background:var(--white);border-radius:20px;padding:40px 32px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(10,60,92,.12);}
.auth-logo{font-size:2rem;text-align:center;margin-bottom:4px;}
.auth-church{text-align:center;font-size:.72rem;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;}
.auth-title{text-align:center;font-size:1.25rem;font-weight:700;color:var(--steel);margin-bottom:28px;}
.auth-field{margin-bottom:16px;}
.auth-field label{display:block;font-size:.82rem;font-weight:600;color:var(--warm-gray);margin-bottom:5px;}
.auth-field input{width:100%;padding:11px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:.95rem;outline:none;transition:border-color .15s;}
.auth-field input:focus{border-color:var(--steel);}
.btn-primary{width:100%;padding:13px;background:var(--steel);color:var(--white);border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;transition:background .15s;}
.btn-primary:hover{background:var(--deep-steel);}
.btn-primary:disabled{opacity:.5;cursor:default;}
.auth-switch{text-align:center;margin-top:16px;font-size:.85rem;color:var(--warm-gray);}
.auth-switch a{color:var(--steel);font-weight:600;cursor:pointer;text-decoration:none;}
.auth-err{color:var(--danger);background:#fff0ec;border:1px solid var(--danger);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:.84rem;display:none;}
.auth-ok{color:var(--sage);background:#f0f7f1;border:1px solid var(--sage);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:.84rem;display:none;}
/* ── App shell ── */
#app{display:none;flex-direction:column;height:100%;}
#app-header{background:var(--white);border-bottom:3px solid var(--amber);padding:12px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;}
.hdr-logo{font-size:1.5rem;color:var(--amber);}
.hdr-txt{flex:1;}
.hdr-church{font-size:.65rem;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.09em;}
.hdr-name{font-size:1rem;font-weight:700;color:var(--steel);}
.hdr-logout{font-size:.78rem;color:var(--warm-gray);cursor:pointer;text-decoration:underline;background:none;border:none;font-family:var(--font);}
#app-content{flex:1;overflow:hidden;position:relative;}
.tab-pane{position:absolute;inset:0;overflow-y:auto;padding:16px;display:none;}
.tab-pane.active{display:block;}
/* ── Bottom nav ── */
#app-nav{display:flex;background:var(--white);border-top:1px solid var(--border);flex-shrink:0;height:var(--nav-h);}
.nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:none;background:none;color:var(--warm-gray);font-size:.65rem;font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:.04em;font-family:var(--font);transition:color .15s;padding:0;}
.nav-btn .nav-icon{font-size:1.5rem;line-height:1;}
.nav-btn.active{color:var(--steel);}
/* ── Install banner ── */
#install-banner{background:var(--steel);color:var(--white);padding:12px 16px;display:none;align-items:center;gap:12px;flex-shrink:0;}
#install-banner .ib-text{flex:1;font-size:.84rem;}
#install-banner .ib-text b{display:block;font-size:.88rem;margin-bottom:2px;}
#install-banner button{background:var(--amber);border:none;color:var(--white);padding:8px 14px;border-radius:8px;font-size:.8rem;font-weight:700;cursor:pointer;white-space:nowrap;}
#install-banner .ib-close{background:none;border:none;color:rgba(255,255,255,.6);font-size:1.2rem;cursor:pointer;padding:0 4px;}
/* ── Cards ── */
.card{background:var(--white);border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 2px 8px rgba(10,60,92,.06);}
.card-title{font-size:.72rem;font-weight:700;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;}
/* ── Me tab ── */
.me-photo{width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--ice);}
.me-photo-placeholder{width:80px;height:80px;border-radius:50%;background:var(--ice);display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--sky);flex-shrink:0;}
.me-header{display:flex;align-items:center;gap:16px;margin-bottom:16px;}
.me-name{font-size:1.2rem;font-weight:700;color:var(--steel);}
.me-household{font-size:.85rem;color:var(--warm-gray);}
.me-field{display:flex;flex-direction:column;gap:3px;margin-bottom:12px;}
.me-field label{font-size:.72rem;font-weight:700;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.04em;}
.me-field span,.me-field input{font-size:.92rem;color:var(--charcoal);}
.me-field input{padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;outline:none;}
.me-field input:focus{border-color:var(--steel);}
.btn-edit{padding:8px 18px;border:1.5px solid var(--border);border-radius:8px;background:var(--linen);color:var(--charcoal);font-size:.84rem;font-weight:600;cursor:pointer;}
.btn-save{padding:8px 18px;border:none;border-radius:8px;background:var(--steel);color:var(--white);font-size:.84rem;font-weight:600;cursor:pointer;}
.btn-cancel{padding:8px 18px;border:1.5px solid var(--border);border-radius:8px;background:none;color:var(--warm-gray);font-size:.84rem;cursor:pointer;}
/* ── Directory tab ── */
.dir-search{width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:.95rem;margin-bottom:14px;outline:none;}
.dir-search:focus{border-color:var(--steel);}
.dir-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;}
.dir-card{background:var(--white);border-radius:12px;padding:14px;text-align:center;box-shadow:0 2px 8px rgba(10,60,92,.06);cursor:pointer;transition:box-shadow .15s;}
.dir-card:hover{box-shadow:0 4px 16px rgba(10,60,92,.14);}
.dir-card.expanded{grid-column:span 2;text-align:left;display:flex;gap:14px;align-items:flex-start;}
.dir-photo{width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--ice);flex-shrink:0;}
.dir-photo-placeholder{width:56px;height:56px;border-radius:50%;background:var(--ice);display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:var(--sky);flex-shrink:0;margin:0 auto 8px;}
.dir-expanded-placeholder{width:56px;height:56px;border-radius:50%;background:var(--ice);display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:var(--sky);flex-shrink:0;}
.dir-card:not(.expanded) .dir-photo-placeholder{display:flex;}
.dir-card-name{font-size:.88rem;font-weight:700;color:var(--charcoal);margin-top:8px;line-height:1.2;}
.dir-card-hh{font-size:.75rem;color:var(--warm-gray);}
.dir-expanded-info .dir-card-name{font-size:1rem;margin-top:0;margin-bottom:4px;}
.dir-contact-row{font-size:.82rem;color:var(--charcoal);margin-top:4px;}
.dir-contact-row a{color:var(--steel);}
/* ── Schedule tab ── */
.sched-item{display:flex;gap:14px;align-items:flex-start;}
.sched-date-block{text-align:center;background:var(--steel);color:var(--white);border-radius:10px;padding:8px 10px;min-width:50px;flex-shrink:0;}
.sched-date-mo{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;opacity:.8;}
.sched-date-day{font-size:1.5rem;font-weight:700;line-height:1;}
.sched-body{flex:1;}
.sched-role{font-size:1rem;font-weight:700;color:var(--charcoal);}
.sched-svc{font-size:.84rem;color:var(--warm-gray);}
.sched-label{font-size:.78rem;color:var(--sky);font-style:italic;}
.sched-empty{text-align:center;color:var(--warm-gray);font-size:.9rem;padding:32px 0;}
/* ── Prayer tab ── */
.prayer-add-btn{width:100%;padding:12px;background:var(--steel);color:var(--white);border:none;border-radius:10px;font-size:.92rem;font-weight:700;cursor:pointer;margin-bottom:14px;}
.prayer-item{border-left:3px solid var(--sky);padding-left:12px;margin-bottom:14px;}
.prayer-name{font-size:.8rem;font-weight:700;color:var(--warm-gray);margin-bottom:3px;}
.prayer-text{font-size:.9rem;color:var(--charcoal);line-height:1.45;}
.prayer-status{display:inline-block;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:20px;margin-top:6px;}
.prayer-status.open{background:var(--linen);color:var(--warm-gray);}
.prayer-status.praying{background:var(--pale-sage);color:var(--sage);}
.prayer-form{display:none;}
.prayer-form.open{display:block;}
.prayer-form textarea{width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.9rem;resize:vertical;min-height:100px;outline:none;font-family:var(--font);}
.prayer-form textarea:focus{border-color:var(--steel);}
.prayer-form-actions{display:flex;gap:10px;margin-top:10px;}
/* ── Spinner ── */
.spinner{text-align:center;padding:32px;color:var(--warm-gray);font-size:.9rem;}
/* ── Responsive ── */
@media(min-width:640px){
  .dir-grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr));}
  #auth-screen{background:var(--mist);}
}
</style>
</head>
<body>

<!-- Auth screen -->
<div id="auth-screen">
  <div class="auth-card">
    <div class="auth-logo">&#9997;&#65039;</div>
    <div class="auth-church">Timothy Lutheran Church</div>
    <div class="auth-title" id="auth-title">Member Portal</div>
    <div class="auth-err" id="auth-err"></div>
    <div class="auth-ok"  id="auth-ok"></div>

    <!-- Login form -->
    <div id="login-form">
      <div class="auth-field">
        <label for="login-user">Username or Email</label>
        <input type="text" id="login-user" autocomplete="username" autocapitalize="none">
      </div>
      <div class="auth-field">
        <label for="login-pass">Password</label>
        <input type="password" id="login-pass" autocomplete="current-password">
      </div>
      <button class="btn-primary" id="login-btn" onclick="doLogin()">Sign In</button>
      <div class="auth-switch">First time? <a onclick="showRegister()">Create your account</a></div>
    </div>

    <!-- Register form -->
    <div id="register-form" style="display:none;">
      <div class="auth-field">
        <label for="reg-email">Your email address</label>
        <input type="email" id="reg-email" autocomplete="email" placeholder="you@example.com">
      </div>
      <button class="btn-primary" id="reg-btn" onclick="doRegister()">Send Access Link</button>
      <div class="auth-switch">Already have an account? <a onclick="showLogin()">Sign in</a></div>
    </div>
  </div>
</div>

<!-- App shell -->
<div id="app">
  <!-- Install banner -->
  <div id="install-banner">
    <div class="ib-text">
      <b>Add to Home Screen</b>
      <span id="install-instructions"></span>
    </div>
    <button id="install-btn" style="display:none;" onclick="doInstall()">Install</button>
    <button class="ib-close" onclick="dismissInstall()">&#x2715;</button>
  </div>

  <div id="app-header">
    <div class="hdr-logo">&#9997;&#65039;</div>
    <div class="hdr-txt">
      <div class="hdr-church">Timothy Lutheran</div>
      <div class="hdr-name" id="hdr-name">Member Portal</div>
    </div>
    <button class="hdr-logout" onclick="doLogout()">Sign out</button>
  </div>

  <div id="app-content">
    <!-- Me tab -->
    <div class="tab-pane active" id="tab-me">
      <div class="spinner">Loading&#8230;</div>
    </div>

    <!-- Directory tab -->
    <div class="tab-pane" id="tab-directory">
      <input type="search" class="dir-search" id="dir-search" placeholder="Search members&#8230;" oninput="filterDirectory()" autocomplete="off">
      <div class="dir-grid" id="dir-grid"><div class="spinner">Loading&#8230;</div></div>
    </div>

    <!-- Schedule tab -->
    <div class="tab-pane" id="tab-schedule">
      <div class="spinner">Loading&#8230;</div>
    </div>

    <!-- Prayer tab -->
    <div class="tab-pane" id="tab-prayer">
      <button class="prayer-add-btn" onclick="togglePrayerForm()">&#43; Add Prayer Request</button>
      <div class="card prayer-form" id="prayer-form">
        <div class="card-title">New Prayer Request</div>
        <textarea id="prayer-text" placeholder="Share your prayer request&#8230;"></textarea>
        <div class="prayer-form-actions">
          <button class="btn-save" onclick="submitPrayer()">Submit</button>
          <button class="btn-cancel" onclick="togglePrayerForm()">Cancel</button>
        </div>
      </div>
      <div id="prayer-list"><div class="spinner">Loading&#8230;</div></div>
    </div>
  </div>

  <nav id="app-nav">
    <button class="nav-btn active" id="nav-me" onclick="showTab('me')">
      <span class="nav-icon">&#128100;</span>Me
    </button>
    <button class="nav-btn" id="nav-directory" onclick="showTab('directory')">
      <span class="nav-icon">&#128101;</span>Directory
    </button>
    <button class="nav-btn" id="nav-schedule" onclick="showTab('schedule')">
      <span class="nav-icon">&#128197;</span>Schedule
    </button>
    <button class="nav-btn" id="nav-prayer" onclick="showTab('prayer')">
      <span class="nav-icon">&#128591;</span>Prayer
    </button>
  </nav>
</div>

<script>
// ── State ────────────────────────────────────────────────────────────────────
var _currentTab = 'me';
var _meData = null;
var _dirData = null;
var _schedData = null;
var _prayerData = null;
var _deferredInstallPrompt = null;

// ── Utilities ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function api(path, opts) {
  return fetch(path, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts))
    .then(function(r) {
      if (r.status === 401) { showAuthScreen(); return null; }
      return r.json();
    });
}

// ── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  // Check session
  fetch('/member/api/session', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d && d.authenticated) {
        if (d.name) document.getElementById('hdr-name').textContent = d.name;
        showApp();
      }
    })
    .catch(function() {});

  // Install prompt
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    _deferredInstallPrompt = e;
    showInstallBanner(false);
  });

  // Handle verify token routes
  if (location.pathname.startsWith('/portal/verify/')) {
    // The server renders a standalone set-password page — no JS needed here
  }
})();

// ── Auth screen ──────────────────────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}
function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('app').style.flexDirection = 'column';
  loadTab(_currentTab);
  // Show install banner after a short delay (less intrusive)
  setTimeout(checkInstallBanner, 2000);
}
function showLogin() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('auth-title').textContent = 'Member Portal';
  clearAuthMsgs();
  document.getElementById('login-user').focus();
}
function showRegister() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'block';
  document.getElementById('auth-title').textContent = 'Create Account';
  clearAuthMsgs();
  document.getElementById('reg-email').focus();
}
function clearAuthMsgs() {
  var e = document.getElementById('auth-err'), o = document.getElementById('auth-ok');
  e.style.display = 'none'; o.style.display = 'none';
}
function showAuthErr(msg) {
  var e = document.getElementById('auth-err');
  e.textContent = msg; e.style.display = 'block';
  document.getElementById('auth-ok').style.display = 'none';
}
function showAuthOk(msg) {
  var o = document.getElementById('auth-ok');
  o.textContent = msg; o.style.display = 'block';
  document.getElementById('auth-err').style.display = 'none';
}
function doLogin() {
  var user = document.getElementById('login-user').value.trim();
  var pass = document.getElementById('login-pass').value;
  if (!user || !pass) { showAuthErr('Please enter your username and password.'); return; }
  var btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  clearAuthMsgs();
  fetch('/member/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false; btn.textContent = 'Sign In';
      if (d && d.ok) {
        if (d.displayName) document.getElementById('hdr-name').textContent = d.displayName;
        showApp();
      } else {
        showAuthErr((d && d.error) || 'Invalid username or password.');
      }
    }).catch(function() {
      btn.disabled = false; btn.textContent = 'Sign In';
      showAuthErr('Connection error. Please try again.');
    });
}
function doRegister() {
  var email = document.getElementById('reg-email').value.trim();
  if (!email) { showAuthErr('Please enter your email address.'); return; }
  var btn = document.getElementById('reg-btn');
  btn.disabled = true; btn.textContent = 'Sending…';
  clearAuthMsgs();
  fetch('/member/register', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email }),
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false; btn.textContent = 'Send Access Link';
      showAuthOk('If we found your email in our directory, we sent an access link. Check your inbox (and spam folder).');
      document.getElementById('reg-email').value = '';
    }).catch(function() {
      btn.disabled = false; btn.textContent = 'Send Access Link';
      showAuthErr('Connection error. Please try again.');
    });
}
function doLogout() {
  fetch('/member/logout', { method: 'POST', credentials: 'include' })
    .then(function() { showAuthScreen(); showLogin(); })
    .catch(function() { showAuthScreen(); showLogin(); });
}

// Support Enter key on auth inputs
document.getElementById('login-pass').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
document.getElementById('login-user').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
document.getElementById('reg-email').addEventListener('keydown',  function(e) { if (e.key === 'Enter') doRegister(); });

// ── Tab navigation ───────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-pane').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-'+name).classList.add('active');
  document.getElementById('nav-'+name).classList.add('active');
  _currentTab = name;
  loadTab(name);
}
function loadTab(name) {
  if (name === 'me'        && !_meData)     loadMe();
  if (name === 'directory' && !_dirData)    loadDirectory();
  if (name === 'schedule'  && !_schedData)  loadSchedule();
  if (name === 'prayer'    && !_prayerData) loadPrayer();
}

// ── Me tab ───────────────────────────────────────────────────────────────────
function loadMe() {
  api('/member/api/me').then(function(d) {
    if (!d) return;
    _meData = d;
    renderMe(false);
  });
}
function renderMe(editing) {
  var p = _meData;
  if (!p) return;
  var photo = p.photo_url
    ? '<img class="me-photo" src="'+esc(p.photo_url)+'" alt="">'
    : '<div class="me-photo-placeholder">'+esc((p.first_name||'?')[0])+'</div>';
  var html = '<div class="card"><div class="me-header">'
    + photo
    + '<div><div class="me-name">'+esc(p.first_name+' '+p.last_name)+'</div>'
    + '<div class="me-household">'+esc(p.household_name||'')+'</div></div>'
    + '</div>';
  if (editing) {
    html += '<div class="me-field"><label>Email</label><input type="email" id="me-email" value="'+esc(p.email||'')+'"></div>'
      + '<div class="me-field"><label>Phone</label><input type="tel" id="me-phone" value="'+esc(p.phone||'')+'"></div>'
      + '<div style="display:flex;gap:10px;margin-top:4px;"><button class="btn-save" onclick="saveMe()">Save</button><button class="btn-cancel" onclick="renderMe(false)">Cancel</button></div>';
  } else {
    html += '<div class="me-field"><label>Email</label><span>'+esc(p.email||'—')+'</span></div>'
      + '<div class="me-field"><label>Phone</label><span>'+esc(p.phone||'—')+'</span></div>'
      + '<div class="me-field"><label>Address</label><span>'+esc([p.address1,p.city,p.state,p.zip].filter(Boolean).join(', ')||'—')+'</span></div>'
      + '<div style="margin-top:12px;"><button class="btn-edit" onclick="renderMe(true)">Edit Contact Info</button></div>';
  }
  html += '</div>';
  document.getElementById('tab-me').innerHTML = html;
}
function saveMe() {
  var email = document.getElementById('me-email').value.trim();
  var phone = document.getElementById('me-phone').value.trim();
  api('/member/api/me', { method: 'PUT', body: JSON.stringify({ email: email, phone: phone }) })
    .then(function(d) {
      if (d && d.ok) {
        _meData.email = email;
        _meData.phone = phone;
        renderMe(false);
      }
    });
}

// ── Directory tab ─────────────────────────────────────────────────────────────
var _expandedDir = null;
function loadDirectory() {
  api('/member/api/directory').then(function(d) {
    if (!Array.isArray(d)) return;
    _dirData = d;
    renderDirectory(d);
  });
}
function filterDirectory() {
  if (!_dirData) return;
  var q = document.getElementById('dir-search').value.toLowerCase();
  renderDirectory(_dirData.filter(function(p) {
    return (p.first_name+' '+p.last_name+' '+(p.household_name||'')).toLowerCase().includes(q);
  }));
}
function renderDirectory(people) {
  var grid = document.getElementById('dir-grid');
  if (!people.length) { grid.innerHTML = '<div class="spinner">No results</div>'; return; }
  grid.innerHTML = people.map(function(p) {
    var initials = ((p.first_name||'?')[0]+(p.last_name||'?')[0]).toUpperCase();
    var photo = p.photo_url
      ? '<img class="dir-photo" src="'+esc(p.photo_url)+'" alt="">'
      : '<div class="dir-photo-placeholder">'+esc(initials)+'</div>';
    return '<div class="dir-card" id="dir-'+p.id+'" onclick="toggleDirCard('+p.id+')">'
      + photo
      + '<div class="dir-card-name">'+esc(p.first_name+' '+p.last_name)+'</div>'
      + '<div class="dir-card-hh">'+esc(p.household_name||'')+'</div>'
      + '</div>';
  }).join('');
}
function toggleDirCard(id) {
  var card = document.getElementById('dir-'+id);
  if (!card) return;
  var isExp = card.classList.contains('expanded');
  // Collapse any open card
  if (_expandedDir && _expandedDir !== id) {
    var prev = document.getElementById('dir-'+_expandedDir);
    if (prev) { prev.classList.remove('expanded'); prev.innerHTML = getDirCardCollapsedHtml(_expandedDir); }
  }
  if (isExp) { card.classList.remove('expanded'); card.innerHTML = getDirCardCollapsedHtml(id); _expandedDir = null; return; }
  var p = _dirData && _dirData.find(function(x){ return x.id === id; });
  if (!p) return;
  card.classList.add('expanded');
  _expandedDir = id;
  var initials = ((p.first_name||'?')[0]+(p.last_name||'?')[0]).toUpperCase();
  var photo = p.photo_url
    ? '<img class="dir-photo" src="'+esc(p.photo_url)+'" alt="">'
    : '<div class="dir-expanded-placeholder">'+esc(initials)+'</div>';
  card.innerHTML = photo
    + '<div class="dir-expanded-info"><div class="dir-card-name">'+esc(p.first_name+' '+p.last_name)+'</div>'
    + '<div class="dir-card-hh">'+esc(p.household_name||'')+'</div>'
    + (p.email ? '<div class="dir-contact-row">&#9993;&nbsp;<a href="mailto:'+esc(p.email)+'">'+esc(p.email)+'</a></div>' : '')
    + (p.phone ? '<div class="dir-contact-row">&#128222;&nbsp;<a href="tel:'+esc(p.phone)+'">'+esc(p.phone)+'</a></div>' : '')
    + '</div>';
}
function getDirCardCollapsedHtml(id) {
  var p = _dirData && _dirData.find(function(x){ return x.id === id; });
  if (!p) return '';
  var initials = ((p.first_name||'?')[0]+(p.last_name||'?')[0]).toUpperCase();
  var photo = p.photo_url
    ? '<img class="dir-photo" src="'+esc(p.photo_url)+'" alt="">'
    : '<div class="dir-photo-placeholder">'+esc(initials)+'</div>';
  return photo
    + '<div class="dir-card-name">'+esc(p.first_name+' '+p.last_name)+'</div>'
    + '<div class="dir-card-hh">'+esc(p.household_name||'')+'</div>';
}

// ── Schedule tab ──────────────────────────────────────────────────────────────
var _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function loadSchedule() {
  api('/member/api/schedule').then(function(d) {
    if (!Array.isArray(d)) return;
    _schedData = d;
    var pane = document.getElementById('tab-schedule');
    if (!d.length) {
      pane.innerHTML = '<div class="sched-empty">No upcoming assignments. &#128591;</div>';
      return;
    }
    pane.innerHTML = d.map(function(a) {
      var dt = new Date(a.date + 'T12:00:00');
      var mo = _MONTHS[dt.getMonth()];
      var day = dt.getDate();
      var svcLabel = a.service === '8am' ? '8:00am' : a.service === '10:45am' ? '10:45am' : a.service;
      return '<div class="card sched-item">'
        + '<div class="sched-date-block"><div class="sched-date-mo">'+esc(mo)+'</div><div class="sched-date-day">'+day+'</div></div>'
        + '<div class="sched-body"><div class="sched-role">'+esc(a.role)+'</div>'
        + '<div class="sched-svc">'+esc(svcLabel)+(a.label?' — '+esc(a.label):'')+'</div>'
        + '</div></div>';
    }).join('');
  });
}

// ── Prayer tab ───────────────────────────────────────────────────────────────
function loadPrayer() {
  api('/member/api/prayer-requests').then(function(d) {
    if (!Array.isArray(d)) return;
    _prayerData = d;
    renderPrayer();
  });
}
function renderPrayer() {
  var el = document.getElementById('prayer-list');
  if (!_prayerData || !_prayerData.length) {
    el.innerHTML = '<div class="spinner" style="padding:16px;">No open prayer requests.</div>';
    return;
  }
  el.innerHTML = _prayerData.map(function(r) {
    var statusLabel = r.status === 'praying' ? 'Being prayed for' : 'Open';
    return '<div class="card prayer-item"><div class="prayer-name">'+esc(r.requester_name||'Anonymous')+'</div>'
      + '<div class="prayer-text">'+esc(r.request_text)+'</div>'
      + '<span class="prayer-status '+esc(r.status)+'">'+esc(statusLabel)+'</span></div>';
  }).join('');
}
function togglePrayerForm() {
  var f = document.getElementById('prayer-form');
  f.classList.toggle('open');
  if (f.classList.contains('open')) document.getElementById('prayer-text').focus();
}
function submitPrayer() {
  var text = document.getElementById('prayer-text').value.trim();
  if (!text) return;
  api('/member/api/prayer-requests', { method: 'POST', body: JSON.stringify({ request_text: text }) })
    .then(function(d) {
      if (d && d.ok) {
        document.getElementById('prayer-text').value = '';
        togglePrayerForm();
        _prayerData = null;
        loadPrayer();
      }
    });
}

// ── Install / Add to Home Screen ──────────────────────────────────────────────
function checkInstallBanner() {
  if (localStorage.getItem('tlc-install-dismissed') === '1') return;
  var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone) return;
  if (isIos) { showInstallBanner(true); return; }
  if (_deferredInstallPrompt) { showInstallBanner(false); }
}
function showInstallBanner(isIos) {
  var banner = document.getElementById('install-banner');
  var instructions = document.getElementById('install-instructions');
  var installBtn = document.getElementById('install-btn');
  if (isIos) {
    instructions.textContent = 'Tap the Share button (↑) then "Add to Home Screen" to install.';
    installBtn.style.display = 'none';
  } else {
    instructions.textContent = 'Install for quick access from your home screen.';
    installBtn.style.display = '';
  }
  banner.style.display = 'flex';
}
function doInstall() {
  if (!_deferredInstallPrompt) return;
  _deferredInstallPrompt.prompt();
  _deferredInstallPrompt.userChoice.then(function() { dismissInstall(); });
}
function dismissInstall() {
  document.getElementById('install-banner').style.display = 'none';
  localStorage.setItem('tlc-install-dismissed', '1');
}
</script>
</body>
</html>`;
