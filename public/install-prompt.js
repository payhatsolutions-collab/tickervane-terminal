// The browser may offer installation before React loads, including on /install.
window.alphaNovaInstall = { prompt: null, installed: false };
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  window.alphaNovaInstall.prompt = event;
});
window.addEventListener('appinstalled', () => {
  window.alphaNovaInstall.prompt = null;
  window.alphaNovaInstall.installed = true;
});
