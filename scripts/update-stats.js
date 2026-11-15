const fs = require('fs');
const path = require('path');

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
  let maxDay = { date: '', count: 0 };

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

    for (const week of cal.weeks) {
      for (const day of week.contributionDays) {
        if (day.contributionCount > maxDay.count) {
          maxDay = { date: day.date, count: day.contributionCount };
        }
      }
    }
  }

  return { totalContributions, maxDay, mergedPRs, totalStars };
}

function generateStatsMarkdown(stats) {
  const formattedTotal = stats.totalContributions.toLocaleString();

  return `<!-- STATS:START -->
<p align="center">
  <img src="https://img.shields.io/badge/Total%20Contributions-${encodeURIComponent(formattedTotal)}-0ea5e9?style=for-the-badge&logo=github&logoColor=white" alt="Total Contributions" />
  <img src="https://img.shields.io/badge/Merged%20PRs-${stats.mergedPRs}-10b981?style=for-the-badge&logo=git&logoColor=white" alt="Merged PRs" />
  <img src="https://img.shields.io/badge/Highest%20Day-${stats.maxDay.count}%20in%201%20Day-f59e0b?style=for-the-badge&logo=speedtest&logoColor=white" alt="Highest Contribution Day" />
  <img src="https://img.shields.io/badge/Total%20Stars-${stats.totalStars}-8b5cf6?style=for-the-badge&logo=apachespark&logoColor=white" alt="Total Stars" />
</p>
<!-- STATS:END -->`;
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

  const readmePath = path.resolve(__dirname, '..', 'README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');

  const newSection = generateStatsMarkdown(stats);
  const regex = /<!-- STATS:START -->[\s\S]*?<!-- STATS:END -->/;

  let updatedContent;
  if (regex.test(readmeContent)) {
    updatedContent = readmeContent.replace(regex, newSection);
  } else {
    updatedContent = readmeContent.replace('### 📊 GitHub Analytics\n\n<div align="center">', `### 📊 GitHub Analytics\n\n${newSection}\n\n<div align="center">`);
  }

  fs.writeFileSync(readmePath, updatedContent, 'utf8');
  console.log('README.md updated successfully with fresh stats badges!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
