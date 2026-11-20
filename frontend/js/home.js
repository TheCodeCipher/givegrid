// home.js — the home page (index.html).

// 1. Logged in already? Swap "Log in" for a link to your dashboard.
const user = getUser();
if (user) {
  document.getElementById('nav-login').classList.add('hidden');
  const dashboard = document.getElementById('nav-dashboard');
  dashboard.href = homePageFor(user.role);
  dashboard.classList.remove('hidden');
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
