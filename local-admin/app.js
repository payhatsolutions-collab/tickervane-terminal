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
    ['Signed up', date(user.createdAt, true)], ['Signup method', user.source === 'free-signup' ? 'Free name & email registration' : user.source],
    ['Registration notice', user.noticeVersion || 'Not recorded'], ['Marketing subscription', 'Not included in signup'], ['Record ID', user.id],
  ]) list.append(node('dt', label), node('dd', value));
  panel.append(list, node('p', 'Names and emails are self-reported. Registration does not verify identity or give access to a user’s portfolio.', 'detail-note'));
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
$('search').addEventListener('input', render);
$('sort').addEventListener('change', render);
$('refresh').addEventListener('click', () => load(true));
load();
