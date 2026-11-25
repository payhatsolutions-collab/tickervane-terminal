const $ = id => document.getElementById(id);
let users = [];
let visible = [];
let selected = null;
let loaded = false;
const dates = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const times = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const date = (value, full = false) => Number.isFinite(Date.parse(value)) ? (full ? times : dates).format(new Date(value)) + (full ? ' IST' : '') : 'Not recorded';
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0] || '').join('').toUpperCase();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function message(text, error = false) {
  $('message').textContent = text;
  $('message').className = `message${error ? ' error' : ''}`;
  $('message').hidden = !text;
}
function detail(user) {
  selected = user.id;
  const panel = $('details');
  const avatar = node('div', initials(user.name), 'avatar detail-avatar');
  const status = node('span', user.emailVerified ? 'Verified email' : 'Unverified email', `status${user.emailVerified ? ' verified' : ''}`);
  panel.replaceChildren(avatar, node('h2', user.name), node('p', user.email, 'detail-email'), status);
  const list = node('dl', undefined, 'detail-list');
  for (const [label, value] of [
    ['Signed up', date(user.createdAt, true)], ['Signup method', user.source === 'google' ? 'Google account' : 'Free name & email registration'],
    ['Registration notice', user.noticeVersion || 'Not recorded'], ['Marketing subscription', 'Not included in signup'], ['Record ID', user.id],
  ]) list.append(node('dt', label), node('dd', value));
  panel.append(list, node('p', user.source === 'google' ? 'Google verifies this account’s email. Holdings and journals remain on the user’s device.' : 'Names and emails are self-reported. This registration does not verify identity or give access to a user’s portfolio.', 'detail-note'));
  for (const row of $('users').children) row.classList.toggle('selected', row.dataset.id === selected);
}
function render() {
  const query = $('search').value.trim().toLocaleLowerCase();
  visible = users.filter(user => `${user.name} ${user.email}`.toLocaleLowerCase().includes(query));
  visible.sort($('sort').value === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) =>
    ((Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)) * ($('sort').value === 'oldest' ? -1 : 1));
  const body = document.createDocumentFragment();
  for (const user of visible) {
    const row = node('tr'); row.dataset.id = user.id;
    row.classList.toggle('selected', user.id === selected);
    const name = node('td'); const identity = node('div', undefined, 'user-cell');
    identity.append(node('span', initials(user.name), 'avatar'), node('span', user.name, 'name-text'));
    name.append(identity); name.title = user.name;
    const email = node('td', user.email, 'email-cell'); email.title = user.email;
    const status = node('td'); status.append(node('span', user.emailVerified ? 'Verified' : 'Unverified', `status${user.emailVerified ? ' verified' : ''}`));
    const action = node('td'); const button = node('button', 'View ↗', 'view-button');
    button.setAttribute('aria-label', `View details for ${user.name}`);
    button.addEventListener('click', () => detail(user)); action.append(button);
    row.append(name, email, node('td', date(user.createdAt)), status, action); body.append(row);
  }
  $('users').replaceChildren(body);
  $('result-count').textContent = String(visible.length);
  $('shown').textContent = `${visible.length} of ${users.length} registration${users.length === 1 ? '' : 's'}`;
  $('export').disabled = !visible.length;
  $('empty').hidden = !!visible.length;
  if (!visible.length) {
    $('empty').replaceChildren(node('span', query ? '⌕' : '◎'), node('h3', query ? 'No matching users' : loaded ? 'Your first signup starts here' : 'Loading your users'), node('p', query ? 'Try another name or email address.' : loaded ? 'New registrations will appear here. Use Refresh data to load the latest signups.' : 'Connecting to your registration data.'));
  }
  if (selected && !visible.some(user => user.id === selected)) {
    selected = null;
    const placeholder = node('div', undefined, 'details-placeholder');
    placeholder.append(node('span', '↗'), node('h2', 'A closer look'), node('p', 'Select a user to see their registration details.'));
    $('details').replaceChildren(placeholder);
  }
}
async function load(force = false) {
  $('refresh').disabled = true;
  $('refresh').querySelector('span').textContent = 'Loading…';
  message('');
  try {
    const response = await fetch(`/api/users${force ? '?refresh=1' : ''}`, { signal: AbortSignal.timeout(60_000) });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.users)) throw new Error(data.error || 'Couldn’t load registrations.');
    users = data.users; loaded = true;
    $('total').textContent = users.length.toLocaleString('en-IN');
    $('nav-count').textContent = String(users.length);
    const now = Date.now();
    $('recent').textContent = String(users.filter(user => Date.parse(user.createdAt) >= now - 7 * 86_400_000 && Date.parse(user.createdAt) <= now).length);
    const latest = users.reduce((best, user) => (Date.parse(user.createdAt) || 0) > (Date.parse(best?.createdAt) || 0) ? user : best, null);
    $('latest').textContent = latest ? date(latest.createdAt) : '—';
    $('latest-caption').textContent = latest ? latest.name : 'No signups yet';
    $('updated').textContent = `Updated ${date(data.updatedAt, true)}`;
    if (data.unavailable) message(`${data.unavailable} registration record${data.unavailable === 1 ? '' : 's'} could not be loaded. Showing the available records; try Refresh to retry.`);
    render();
    if (selected) detail(users.find(user => user.id === selected));
  } catch (error) {
    message(error.name === 'TimeoutError' ? 'Loading took too long. Please try Refresh again.' : error.message, true);
    if (!loaded) {
      $('empty').replaceChildren(node('span', '↻'), node('h3', 'Unable to load users'), node('p', 'Use Refresh data to try again.'));
      $('shown').textContent = 'No data loaded';
      $('updated').textContent = 'Connection unavailable';
    }
  } finally {
    $('refresh').disabled = false;
    $('refresh').querySelector('span').textContent = 'Refresh data';
  }
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
$('export').addEventListener('click', () => {
  const rows = [['Name', 'Email', 'Signed up (UTC)', 'Email verified', 'Source', 'Notice version', 'Record ID'], ...visible.map(user => [user.name, user.email, user.createdAt, user.emailVerified ? 'Yes' : 'No', user.source, user.noticeVersion, user.id])];
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = node('a'); link.href = url; link.download = `alphanova-users-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
// Pro payments: one row per submitted UPI reference, newest first.
const proLabels = { unverified: 'To check', held: 'Held · no access', verified: 'Paid', rejected: 'Rejected' };
function proMessage(text, error = false) {
  $('pro-message').textContent = text;
  $('pro-message').className = `message${error ? ' error' : ''}`;
  $('pro-message').hidden = !text;
}
async function review(account, action, question) {
  if (question && !confirm(question)) return;
  proMessage('');
  try {
    const response = await fetch('/api/pro/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: account.id, action }), signal: AbortSignal.timeout(30_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Couldn’t save the review.');
  } catch (error) { proMessage(error.name === 'TimeoutError' ? 'Saving took too long. Please try again.' : error.message, true); }
  await loadPro();
}
async function loadPro() {
  try {
    const response = await fetch('/api/pro', { signal: AbortSignal.timeout(60_000) });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.accounts)) throw new Error(data.error || 'Couldn’t load Pro payments.');
    const rows = data.accounts.flatMap(account => account.payments.map((payment, index) => ({ account, payment, latest: index === account.payments.length - 1 })))
      .sort((a, b) => (Date.parse(b.payment.claimedAt) || 0) - (Date.parse(a.payment.claimedAt) || 0));
    const body = document.createDocumentFragment();
    for (const { account, payment, latest } of rows) {
      const row = node('tr');
      const name = node('td'); const identity = node('div', undefined, 'user-cell');
      identity.append(node('span', initials(account.name || '?'), 'avatar'), node('span', account.name, 'name-text')); name.append(identity);
      const email = node('td', account.email, 'email-cell'); email.title = account.email;
      const utr = node('td', payment.utr, 'utr-cell');
      if (!payment.dateMatch) { utr.append(node('span', 'Unusual', 'status flag')); utr.title = 'This reference does not carry a recent UPI timestamp, so it was held instead of unlocking. Check it carefully.'; }
      const state = account.status === 'revoked' && payment.status !== 'verified' ? 'rejected' : payment.status;
      const status = node('td'); status.append(node('span', proLabels[state] || state, `status${state === 'verified' ? ' verified' : state === 'rejected' || state === 'held' ? ' flag' : ''}`));
      const actions = node('td', undefined, 'review-cell');
      const button = (label, action, question) => { const b = node('button', label, 'view-button'); b.addEventListener('click', () => review(account, action, question)); actions.append(b); };
      if (payment.status === 'held' && account.status !== 'revoked') {
        button('Approve', 'verify');
        button('Reject', 'reject', `Reject reference ${payment.utr} for ${account.name}? They can enter a different one.`);
      } else if (latest) {
        if (account.status === 'revoked') { button('Restore', 'verify'); button('Allow retry', 'unpause'); }
        else {
          if (account.status === 'unverified') button('Mark paid', 'verify');
          button('Revoke', 'revoke', `Remove Pro access for ${account.name} (${account.email})?`);
        }
      }
      row.append(name, email, utr, node('td', payment.note || account.note || '—', 'utr-cell'), node('td', date(payment.claimedAt, true)), node('td', account.status === 'revoked' ? 'Removed' : account.expiresAt > Date.now() ? date(new Date(account.expiresAt).toISOString()) : payment.status === 'held' ? 'After approval' : 'No access'), status, actions);
      body.append(row);
    }
    $('pro-rows').replaceChildren(body);
    const pending = rows.filter(row => ['unverified', 'held'].includes(row.payment.status) && row.account.status !== 'revoked').length;
    $('pro-count').textContent = pending ? `${pending} to check` : String(rows.length);
    $('pro-shown').textContent = `${rows.length} payment${rows.length === 1 ? '' : 's'} from ${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'}`;
    $('pro-updated').textContent = `Updated ${date(data.updatedAt, true)}. Match the reference or the payment note against your Kotak statement.`;
    $('pro-empty').hidden = !!rows.length;
    if (!rows.length) $('pro-empty').replaceChildren(node('span', '◎'), node('h3', 'No Pro payments yet'), node('p', 'When a reader pays and enters a UPI reference, it appears here for you to check.'));
    if (data.unavailable) proMessage(`${data.unavailable} payment record${data.unavailable === 1 ? '' : 's'} could not be loaded. Use Refresh data to retry.`);
  } catch (error) {
    proMessage(error.name === 'TimeoutError' ? 'Loading took too long. Please try Refresh again.' : error.message, true);
    $('pro-empty').replaceChildren(node('span', '↻'), node('h3', 'Unable to load Pro payments'), node('p', 'Use Refresh data to try again.'));
  }
}
$('search').addEventListener('input', render);
$('sort').addEventListener('change', render);
$('refresh').addEventListener('click', () => { load(true); loadPro(); });
load();
loadPro();
