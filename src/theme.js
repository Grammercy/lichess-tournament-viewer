const storageKey = 'tournament-viewer.theme';
const defaultImage = 'https://lichess1.org/assets/images/background/landscape.jpg';
const modes = ['system', 'light', 'dark'];

function imageUrl(value) {
  if (!value) return '';
  const url = new URL(value.startsWith('//') ? `https:${value}` : value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid image URL');
  return url.href;
}

function readPreferences() {
  const defaults = { mode: 'dark', picture: false, image: '', opacity: 100 };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved || typeof saved !== 'object') return defaults;
    return {
      mode: modes.includes(saved.mode) ? saved.mode : defaults.mode,
      picture: saved.picture === true,
      image: typeof saved.image === 'string' && saved.image.length <= 2048 ? imageUrl(saved.image) : '',
      opacity: Number.isFinite(saved.opacity) ? Math.max(5, Math.min(100, saved.opacity)) : 100,
    };
  } catch {
    return defaults;
  }
}

export function initThemeMenu() {
  const $ = id => document.getElementById(id);
  const picker = $('theme-picker');
  const button = $('theme-button');
  const menu = $('theme-menu');
  const options = [...menu.querySelectorAll('input[name="theme"]')];
  const picture = $('theme-picture');
  const image = $('theme-image-url');
  const imageError = $('theme-image-error');
  const opacity = $('theme-opacity');
  const deviceTheme = window.matchMedia('(prefers-color-scheme: light)');
  let preferences = readPreferences();

  function apply() {
    const light = preferences.mode === 'light' || (preferences.mode === 'system' && deviceTheme.matches);
    document.body.classList.toggle('light', light);
    document.body.classList.toggle('picture', preferences.picture);
    document.body.dataset.theme = `${preferences.picture ? 'transp ' : ''}${preferences.mode}`;
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
    document.body.style.setProperty('--theme-image', `url(${JSON.stringify(preferences.image || defaultImage)})`);
    document.body.style.setProperty('--theme-image-opacity', preferences.opacity / 100);
    document.querySelector('meta[name="theme-color"]').content = light ? '#edebe9' : '#161512';
    for (const option of options) option.checked = option.value === preferences.mode;
    picture.checked = preferences.picture;
    $('theme-picture-settings').hidden = !preferences.picture;
    opacity.value = preferences.opacity;
    $('theme-opacity-value').value = `${preferences.opacity}%`;
  }

  function save() {
    apply();
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch {}
  }

  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  }

  button.addEventListener('click', () => {
    if (!menu.hidden) return close();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    options.find(option => option.checked).focus();
  });
  $('close-theme-menu').addEventListener('click', () => close(true));
  document.addEventListener('click', event => {
    if (!picker.contains(event.target)) close();
  });
  document.addEventListener('focusin', event => {
    if (!picker.contains(event.target)) close();
  });
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  for (const option of options) option.addEventListener('change', () => {
    preferences.mode = option.value;
    save();
  });
  picture.addEventListener('change', () => {
    preferences.picture = picture.checked;
    save();
  });
  $('theme-image-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      preferences.image = imageUrl(image.value.trim());
      image.value = preferences.image;
      imageError.hidden = true;
      image.removeAttribute('aria-invalid');
      save();
    } catch {
      imageError.textContent = 'Enter an HTTPS image URL, or leave the field empty.';
      imageError.hidden = false;
      image.setAttribute('aria-invalid', 'true');
      image.focus();
    }
  });
  opacity.addEventListener('input', () => {
    preferences.opacity = Number(opacity.value);
    save();
  });
  deviceTheme.addEventListener('change', () => {
    if (preferences.mode === 'system') apply();
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    preferences = readPreferences();
    image.value = preferences.image;
    imageError.hidden = true;
    image.removeAttribute('aria-invalid');
    apply();
  });
  image.value = preferences.image;
  apply();
}
