// home.js — the home page (index.html).

// 1. Logged in already? Show the "member-only" parts instead of the sign-up parts.
//    The CSS hides .guest-only and shows .member-only once <body> has the class
//    "signed-in". Each kind of account gets its own two shortcuts.
const SHORTCUTS = {
  DONOR: [['Go to your dashboard', 'donor.html'], ['List an item', 'donor.html#new']],
  NGO: [['Go to your dashboard', 'ngo.html'], ['Post a need', 'ngo.html#new']],
  ADMIN: [['Verify NGOs', 'admin.html'], ['See verified NGOs', 'admin.html#VERIFIED']],
};

const user = getUser();
if (user && SHORTCUTS[user.role]) {
  document.body.classList.add('signed-in');
  document.getElementById('who').textContent = `${user.name}, ${ROLE_NAMES[user.role]}`;
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('nav-dashboard').href = homePageFor(user.role);

  // "Welcome back, Asha." (textContent, so a name can never run as code)
  const welcome = document.getElementById('welcome-text');
  welcome.innerHTML = '<strong></strong>';
  welcome.querySelector('strong').textContent = `Welcome back, ${user.name}.`;

  SHORTCUTS[user.role].forEach(([label, page], i) => {
    const link = document.getElementById(`shortcut-${i + 1}`);
    link.textContent = label;
    link.href = page;
  });
}

// 2. Draw the 10 x 10 grid: 100 squares = 100 chairs.
//    The first 40 go to NGO "a", the next 40 to "b", the last 20 to "c".
const grid = document.getElementById('squares');
for (let i = 0; i < 100; i++) {
  const square = document.createElement('div');
  if (i < 40) {
    square.className = 'square a';
  } else if (i < 80) {
    square.className = 'square b';
  } else {
    square.className = 'square c';
  }
  square.style.animationDelay = `${i * 12}ms`;   // fill them in one after another
  grid.appendChild(square);
}

// 3. Show whether the backend is up (GET /api/health).
async function checkServer() {
  const res = await api('GET', '/health');
  document.getElementById('server-status').textContent = res.ok ? 'Server is running.' : res.data.error;
}
checkServer();
