const fs = require('fs');
const path = require('path');

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const date = new Date(year, parseInt(month, 10) - 1, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function getStats(token, username) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        createdAt
        contributionsCollection {
          contributionYears
        }
        pullRequests(states: MERGED) {
          totalCount
        }
        repositories(first: 100, ownerAffiliations: OWNER) {
          nodes {
            stargazerCount
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'github-stats-updater'
    },
    body: JSON.stringify({ query, variables: { login: username } })
  });

  const json = await res.json();
  if (!json.data || !json.data.user) {
    throw new Error(`Failed to fetch user data: ${JSON.stringify(json)}`);
  }

  const user = json.data.user;
  const years = user.contributionsCollection.contributionYears;
  const mergedPRs = user.pullRequests.totalCount;
  const totalStars = user.repositories.nodes.reduce((acc, r) => acc + (r.stargazerCount || 0), 0);

  let totalContributions = 0;
  let yearlyStats = [];
  let maxDay = { date: '', count: 0 };
  let allDays = [];

  for (const year of years) {
    const from = `${year}-01-01T00:00:00Z`;
    const to = `${year}-12-31T23:59:59Z`;
    const yearQuery = `
      query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }
    `;

    const yearRes = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'github-stats-updater'
      },
      body: JSON.stringify({ query: yearQuery, variables: { login: username, from, to } })
    });

    const yearJson = await yearRes.json();
    const cal = yearJson.data.user.contributionsCollection.contributionCalendar;
    totalContributions += cal.totalContributions;
    yearlyStats.push({ year, count: cal.totalContributions });

    for (const week of cal.weeks) {
      for (const day of week.contributionDays) {
        allDays.push(day);
        if (day.contributionCount > maxDay.count) {
          maxDay = { date: day.date, count: day.contributionCount };
        }
      }
    }
  }

  // Calculate Streak
  allDays.sort((a, b) => a.date.localeCompare(b.date));
  const todayStr = new Date().toISOString().slice(0, 10);
  const pastDays = allDays.filter(d => d.date <= todayStr);

  let currentStreak = 0;
  for (let i = pastDays.length - 1; i >= 0; i--) {
    if (pastDays[i].contributionCount > 0) {
      currentStreak++;
    } else {
      break;
    }
  }

  let longestStreak = 0;
  let tempStreak = 0;
  for (const d of pastDays) {
    if (d.contributionCount > 0) {
      tempStreak++;
      if (tempStreak > longestStreak) longestStreak = tempStreak;
    } else {
      tempStreak = 0;
    }
  }

  return { totalContributions, yearlyStats, maxDay, mergedPRs, totalStars, currentStreak, longestStreak };
}

function generateStatsSvg(stats) {
  const total = stats.totalContributions.toLocaleString();
  const prs = stats.mergedPRs.toLocaleString();
  const stars = stats.totalStars.toLocaleString();
  const peakCount = stats.maxDay.count;
  const peakDate = formatDate(stats.maxDay.date);
  const currentStreak = stats.currentStreak;
  const longestStreak = stats.longestStreak;
  const y2026 = stats.yearlyStats.find(y => y.year === 2026)?.count.toLocaleString() || '0';
  const y2025 = stats.yearlyStats.find(y => y.year === 2025)?.count.toLocaleString() || '1';

  return `<svg width="860" height="210" viewBox="0 0 860 210" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cardBg" x1="0" y1="0" x2="860" y2="210" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0b1120" />
      <stop offset="50%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#132238" />
    </linearGradient>
    <linearGradient id="cardBorder" x1="0" y1="0" x2="860" y2="210" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.5" />
      <stop offset="50%" stop-color="#10b981" stop-opacity="0.3" />
      <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.5" />
    </linearGradient>
    <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2.5" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <style>
      .hdr-title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; fill: #f8fafc; letter-spacing: 0.5px; }
      .hdr-badge { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; font-weight: 600; fill: #10b981; }
      .stat-num { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 30px; font-weight: 800; }
      .stat-lbl { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 600; fill: #e2e8f0; }
      .stat-sub { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 11px; fill: #64748b; }
      .bot-text { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; fill: #94a3b8; }
    </style>
  </defs>

  <!-- Container -->
  <rect x="1.5" y="1.5" width="857" height="207" rx="14" fill="url(#cardBg)" stroke="url(#cardBorder)" stroke-width="2" />

  <!-- Header Row -->
  <g transform="translate(24, 28)">
    <text x="0" y="0" class="hdr-title">📊 VERIFIED GITHUB ACTIVITY &amp; STATS</text>
    <rect x="360" y="-13" width="220" height="20" rx="10" fill="#10b981" fill-opacity="0.12" stroke="#10b981" stroke-opacity="0.3" />
    <text x="470" y="1" text-anchor="middle" class="hdr-badge">● LIVE REAL-TIME DATA</text>
  </g>

  <!-- Separator Line -->
  <line x1="24" y1="46" x2="836" y2="46" stroke="#1e293b" stroke-width="1.2" />

  <!-- Stat Columns (4 columns) -->
  <!-- Col 1: Total Contributions -->
  <g transform="translate(24, 66)">
    <rect x="0" y="0" width="190" height="92" rx="10" fill="#0f172a" fill-opacity="0.6" stroke="#38bdf8" stroke-opacity="0.25" />
    <text x="18" y="38" fill="#38bdf8" class="stat-num" filter="url(#softGlow)">${total}</text>
    <text x="18" y="60" class="stat-lbl">Total Contributions</text>
    <text x="18" y="78" class="stat-sub">Commits, PRs &amp; Reviews</text>
  </g>

  <!-- Col 2: Current Streak -->
  <g transform="translate(228, 66)">
    <rect x="0" y="0" width="190" height="92" rx="10" fill="#0f172a" fill-opacity="0.6" stroke="#10b981" stroke-opacity="0.25" />
    <text x="18" y="38" fill="#10b981" class="stat-num" filter="url(#softGlow)">${currentStreak} <tspan font-size="20">Days</tspan></text>
    <text x="18" y="60" class="stat-lbl">Current Streak 🔥</text>
    <text x="18" y="78" class="stat-sub">Longest: ${longestStreak} Days</text>
  </g>

  <!-- Col 3: Merged PRs -->
  <g transform="translate(432, 66)">
    <rect x="0" y="0" width="190" height="92" rx="10" fill="#0f172a" fill-opacity="0.6" stroke="#c084fc" stroke-opacity="0.25" />
    <text x="18" y="38" fill="#c084fc" class="stat-num" filter="url(#softGlow)">${prs}</text>
    <text x="18" y="60" class="stat-lbl">Merged Pull Requests 🔀</text>
    <text x="18" y="78" class="stat-sub">Across All Repositories</text>
  </g>

  <!-- Col 4: Peak Daily Output -->
  <g transform="translate(636, 66)">
    <rect x="0" y="0" width="200" height="92" rx="10" fill="#0f172a" fill-opacity="0.6" stroke="#f59e0b" stroke-opacity="0.25" />
    <text x="18" y="38" fill="#f59e0b" class="stat-num" filter="url(#softGlow)">${peakCount}</text>
    <text x="18" y="60" class="stat-lbl">Highest Output Day 🏆</text>
    <text x="18" y="78" class="stat-sub">${peakDate}</text>
  </g>

  <!-- Bottom Details Bar -->
  <line x1="24" y1="174" x2="836" y2="174" stroke="#1e293b" stroke-width="1.2" />
  <g transform="translate(24, 193)">
    <text x="0" y="0" class="bot-text">⭐ ${stars} Stars Earned</text>
    <text x="430" y="0" text-anchor="middle" class="bot-text">📅 2026: ${y2026} contribs  •  2025: ${y2025} contrib</text>
    <text x="812" y="0" text-anchor="end" class="bot-text">⚡ Auto-Updated Daily</text>
  </g>
</svg>`;
}

async function run() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN environment variable not set.');
    process.exit(1);
  }

  const username = process.env.GITHUB_REPOSITORY_OWNER || 'RR-Alen-06';
  console.log(`Fetching stats for @${username}...`);

  const stats = await getStats(token, username);
  console.log('Stats received:', stats);

  // Write custom SVG card to assets/stats-card.svg
  const assetsDir = path.resolve(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const svgCardPath = path.join(assetsDir, 'stats-card.svg');
  fs.writeFileSync(svgCardPath, generateStatsSvg(stats), 'utf8');
  console.log('assets/stats-card.svg generated successfully!');

  // Update README.md
  const readmePath = path.resolve(__dirname, '..', 'README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');

  const formattedTotal = stats.totalContributions.toLocaleString();
  const badgesMarkdown = `<!-- STATS:START -->
<p align="center">
  <img src="https://img.shields.io/badge/Total%20Contributions-${encodeURIComponent(formattedTotal)}-0ea5e9?style=for-the-badge&logo=github&logoColor=white" alt="Total Contributions" />
  <img src="https://img.shields.io/badge/Current%20Streak-${stats.currentStreak}%20Days-10b981?style=for-the-badge&logo=speedtest&logoColor=white" alt="Current Streak" />
  <img src="https://img.shields.io/badge/Merged%20PRs-${stats.mergedPRs}-c084fc?style=for-the-badge&logo=git&logoColor=white" alt="Merged PRs" />
  <img src="https://img.shields.io/badge/Peak%20Day-${stats.maxDay.count}%20in%201%20Day-f59e0b?style=for-the-badge&logo=fire&logoColor=white" alt="Peak Day" />
  <img src="https://img.shields.io/badge/Total%20Stars-${stats.totalStars}-8b5cf6?style=for-the-badge&logo=apachespark&logoColor=white" alt="Total Stars" />
</p>
<!-- STATS:END -->`;

  const regex = /<!-- STATS:START -->[\s\S]*?<!-- STATS:END -->/;
  let updatedContent = readmeContent.replace(regex, badgesMarkdown);

  fs.writeFileSync(readmePath, updatedContent, 'utf8');
  console.log('README.md updated successfully with fresh badges!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
