const $ = selector => document.querySelector(selector);
const owner = location.pathname !== '/shop';
const mode = owner ? 'owner' : 'shop';
const storage = 'christmas-' + mode;
const sharedKey = new URLSearchParams(location.hash.slice(1)).get('key');
let key = sharedKey || sessionStorage.getItem(storage) || '';
if (sharedKey) {
  sessionStorage.setItem(storage, sharedKey);
  history.replaceState(null, '', location.pathname);
}
const dialog = $('#editor');
const form = $('#gift');
let current;
let shopperKey = '';
let registering = false;
let legacy = false;
let pendingPhotos = [];
let photoRequired = false;
const picker = form.elements.photo;
let loadVersion = 0;
$('#intro').textContent = owner ? '' : 'Mark a gift purchased after you buy it.';
const status = message => { $('#status').textContent = message; };

async function api(body) {
  const response = await fetch('/api/gifts?mode=' + mode, {
    method: body ? 'POST' : 'GET',
    headers: {Authorization: 'Bearer ' + key, ...(body && {'Content-Type': 'application/json'})},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'The list could not be reached.'), {status: response.status});
  return data;
}

function action(label, callback, secondary = false) {
  const button = document.createElement('button');
  button.textContent = label;
  if (secondary) button.className = 'secondary';
  button.onclick = async () => {
    button.disabled = true;
    try { await callback(); } catch (error) { status(error.message); }
    finally { button.disabled = false; }
  };
  return button;
}

const previewCache = new Map();

function productImage(url) {
  const page = new URL(url);
  page.hash = '';
  if (!previewCache.has(url)) {
    const endpoint = new URL('https://api.microlink.io/');
    endpoint.searchParams.set('url', page.href);
    endpoint.searchParams.set('video', 'false');
    endpoint.searchParams.set('audio', 'false');
    const preview = fetch(endpoint, { signal: AbortSignal.timeout(8000), referrerPolicy: 'no-referrer' })
      .then(response => response.ok ? response.json() : null)
      .then(result => {
        const image = result?.data?.image?.url;
        return typeof image === 'string' && image.startsWith('https://') ? image : '';
      }).catch(() => '');
    previewCache.set(url, preview);
  }
  return previewCache.get(url);
}

function photoList(value) {
  if (!value) return [];
  return value.startsWith('[') ? JSON.parse(value) : [value];
}

$('#close-viewer').onclick = () => $('#viewer').close();
$('#expanded').referrerPolicy = 'no-referrer';

function card(gift) {
  const item = document.createElement('article');
  const gallery = document.createElement('div');
  gallery.className = 'gallery';
  item.append(gallery);
  function thumbnail(src) {
    const image = document.createElement('img');
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    const button = action('Expand photo of ' + gift.title, () => {
      $('#expanded').alt = gift.title;
      $('#expanded').src = image.src;
      $('#viewer').showModal();
    });
    button.className = 'thumbnail';
    button.setAttribute('aria-label', button.textContent);
    button.replaceChildren(image);
    button.hidden = true;
    image.onload = () => { button.hidden = false; gallery.classList.add('has-photos'); };
    gallery.append(button);
    image.src = src;
  }
  const photos = photoList(gift.photo);
  photos.forEach(thumbnail);
  if (!photos.length && gift.url) productImage(gift.url).then(url => { if (url) thumbnail(url); });
  const details = document.createElement('div');
  details.className = 'details';
  const heading = document.createElement('h2');
  heading.textContent = gift.title;
  details.append(heading);
  if (gift.url) {
    const source = document.createElement('p');
    source.className = 'product-source';
    source.textContent = new URL(gift.url).hostname.replace(/^www\./, '');
    details.append(source);
  }
  if (gift.notes) {
    const notes = document.createElement('p');
    notes.textContent = gift.notes;
    details.append(notes);
  }
  const controls = document.createElement('div');
  controls.className = 'actions';
  const link = document.createElement('a');
  link.href = gift.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'View product';
  link.className = 'secondary';
  if (gift.url) controls.append(link);
  if (owner) {
    controls.append(action('Edit', () => edit(gift), true), action('Remove', async () => {
      if (!confirm('Remove ' + gift.title + ' from your list?')) return;
      await api({action: 'remove', id: gift.id});
      await load('Gift removed.');
    }, true));
  } else {
    controls.append(action('Mark as purchased', async () => {
      if (!confirm('Mark ' + gift.title + ' as purchased?')) return;
      try {
        await api({action: 'buy', id: gift.id});
        await load('Marked as purchased. Thank you!');
      } catch (error) {
        if (error.status !== 409) throw error;
        await load(error.message);
      }
    }));
  }
  details.append(controls);
  item.append(details);
  return item;
}

async function load(message = '') {
  const version = ++loadVersion;
  if (!key) {
    $('#unlock').hidden = !owner;
    status(owner ? '' : 'Open the full shopper link you were sent.');
    return;
  }
  try {
    const {gifts, name, shopperKey: shareKey} = await api();
    if (version !== loadVersion) return;
    $('#unlock').hidden = true;
    shopperKey = shareKey || '';
    $('#my-list').textContent = name;
    $('#intro').textContent = owner ? '' : name + ' — Mark a gift purchased after you buy it.';
    $('#tools').hidden = !owner;
    $('#my-list').hidden = !owner;
    $('#list').replaceChildren(...gifts.map(card));
    status(message || (gifts.length ? '' : owner ? 'Add your first gift to start your list.' : 'There are no available gifts right now.'));
  } catch (error) {
    if (version !== loadVersion) return;
    if (error.status === 401) {
      sessionStorage.removeItem(storage);
      $('#unlock').hidden = !owner;
      $('#tools').hidden = true;
      $('#my-list').hidden = true;
      $('#list').replaceChildren();
    }
    status(error.message);
  }
}

function edit(gift, kind) {
  current = gift;
  form.reset();
  pendingPhotos = [];
  photoRequired = kind === 'photo';
  showPendingPhotos();
  $('#error').textContent = '';
  const labels = { link: 'Add link', photo: 'Add photo', note: 'Add note' };
  $('#heading').textContent = gift ? 'Edit item' : labels[kind];
  for (const [field, type] of [['url', 'link'], ['photo', 'photo'], ['notes', 'note']]) {
    $('#' + field + '-field').hidden = Boolean(kind && kind !== type);
    form.elements[field].required = kind === type && field !== 'photo';
  }
  $('#remove-photo').hidden = !gift?.photo;
  for (const field of ['title', 'url', 'notes']) form.elements[field].value = gift?.[field] ?? '';
  dialog.showModal();
}

function showPendingPhotos() {
  const list = $('#pending-photos');
  list.replaceChildren(...pendingPhotos.map((file, index) => {
    const row = document.createElement('li');
    row.append(file.name, ' ', action('Remove', () => {
      pendingPhotos.splice(index, 1);
      showPendingPhotos();
    }, true));
    return row;
  }));
  list.hidden = !pendingPhotos.length;
}

picker.onchange = () => {
  const files = Array.from(picker.files);
  picker.value = '';
  const savedCount = form.elements.remove.checked ? 0 : photoList(current?.photo).length;
  if (savedCount + pendingPhotos.length + files.length > 4) {
    $('#error').textContent = 'You can save up to 4 photos per item.';
    return;
  }
  pendingPhotos.push(...files);
  $('#error').textContent = '';
  showPendingPhotos();
};

async function compress(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo under 20 MB.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.');
  const image = await createImageBitmap(file).catch(() => { throw new Error('That photo could not be opened.'); });
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const encoded = canvas.toDataURL('image/jpeg', .72);
  if (encoded.length > 700000) throw new Error('Choose a smaller photo.');
  return encoded;
}

function authMode() {
  $('#username').required = !legacy;
  $('#username').parentElement.hidden = legacy;
  $('#name-field').hidden = !registering;
  $('#list-name').required = registering;
  $('#key').minLength = legacy ? 1 : 10;
  $('#key').autocomplete = registering ? 'new-password' : 'current-password';
  $('#auth-title').textContent = registering ? 'Create your wish list' : legacy ? 'Open your existing list' : 'Open your wish list';
  $('#sign-in').textContent = registering ? 'Create list' : 'Sign in';
  $('#toggle-register').textContent = registering || legacy ? 'Back to sign in' : 'Create a list';
  $('#legacy').hidden = registering || legacy;
}
$('#toggle-register').onclick = () => { registering = !registering && !legacy; legacy = false; authMode(); };
$('#legacy').onclick = () => { legacy = true; registering = false; authMode(); };
$('#unlock').onsubmit = async event => {
  event.preventDefault();
  $('#sign-in').disabled = true;
  try {
    if (legacy) key = $('#key').value.trim();
    else {
      const result = await api({action: registering ? 'register' : 'login', username: $('#username').value, password: $('#key').value, name: $('#list-name').value});
      key = result.token;
    }
    sessionStorage.setItem(storage, key);
    $('#key').value = '';
    await load();
  } catch (error) { status(error.message); }
  finally { $('#sign-in').disabled = false; }
};
$('#logout').onclick = async () => {
  try { await api({action: 'logout'}); }
  catch (error) { status(error.message); return; }
  key = shopperKey = '';
  ++loadVersion;
  sessionStorage.removeItem(storage);
  $('#tools').hidden = $('#my-list').hidden = true;
  $('#list').replaceChildren();
  await load();
};
for (const choice of document.querySelectorAll('[data-kind]')) {
  choice.onclick = () => {
    $('#add-menu').open = false;
    edit(undefined, choice.dataset.kind);
  };
}
$('#cancel').onclick = () => dialog.close();
$('#share').onclick = async () => {
  const secret = shopperKey;
  if (!secret?.trim()) return;
  const url = new URL('/shop', location.origin);
  url.hash = new URLSearchParams({key: secret.trim()});
  try { await navigator.clipboard.writeText(url.href); status('Shopper link copied.'); }
  catch { prompt('Copy this shopper link', url.href); }
};
form.onsubmit = async event => {
  event.preventDefault();
  $('#save').disabled = $('#cancel').disabled = true;
  $('#error').textContent = '';
  try {
    const data = new FormData(form);
    const files = [...pendingPhotos];
    if (photoRequired && !files.length) throw new Error('Choose at least one photo.');
    const photos = data.has('remove') ? [] : photoList(current?.photo);
    if (photos.length + files.length > 4) throw new Error('You can save up to 4 photos per item.');
    let photo;
    if (files.length || data.has('remove')) {
      for (const file of files) photos.push(await compress(file));
      photo = photos.length ? JSON.stringify(photos) : '';
    }
    await api({action: 'save', id: current?.id, title: data.get('title'), url: data.get('url'), notes: data.get('notes'), photo});
    dialog.close();
    await load('Item saved to My List.');
  } catch (error) {
    $('#error').textContent = error instanceof TypeError && /fetch|network/i.test(error.message)
      ? 'The editor could not reach the server. Reconnect and try Save item again.' : error.message;
  }
  finally { $('#save').disabled = $('#cancel').disabled = false; }
};
dialog.addEventListener('cancel', event => { if ($('#save').disabled) event.preventDefault(); });
document.addEventListener('visibilitychange', () => { if (!owner && !document.hidden && key) load(); });
load();
