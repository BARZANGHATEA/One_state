import { need } from './env.js';

// Starts the GitHub Actions workflow that runs the browser automation.
export async function dispatchRun({ debug = false, account = '' } = {}) {
  const repo = need('GH_REPO');
  const workflow = process.env.GH_WORKFLOW || 'daily.yml';
  const ref = process.env.GH_REF || 'main';
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${need('GH_TOKEN')}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'onestate-bot',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref, inputs: { debug: debug ? 'true' : 'false', account } }),
  });
  if (r.status !== 204 && r.status !== 200) {
    throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}
