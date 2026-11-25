(() => {
  if (location.hostname !== 'alphanova48.in' || window.top !== window) return;

  const tagId = 'AW-17485438404';
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', tagId);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${tagId}`;
  document.head.append(script);

  let installNavigationTimer;
  function trackInstallClick(event) {
    if (!event.isTrusted || event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.button !== (event.type === 'auxclick' ? 1 : 0)) return;

    // Every install link counts: sidebar, More sheet, mobile header and the Pro trial offers.
    const link = event.target.closest('a[href="/install"]');
    if (!link) return;

    const conversion = {
      send_to: `${tagId}/F_xXCMD75LcdEMS72pFB`,
      value: 1.0,
      currency: 'INR',
    };
    if (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      window.gtag('event', 'conversion', conversion);
      return;
    }

    event.preventDefault();
    if (installNavigationTimer !== undefined) return;

    // Continue to /install even if the tag is blocked or its callback never runs.
    const timeout = 500;
    const openInstallPage = () => {
      if (installNavigationTimer !== timer) return;
      window.clearTimeout(timer);
      installNavigationTimer = undefined;
      location.assign(link.href);
    };
    const timer = window.setTimeout(openInstallPage, timeout);
    installNavigationTimer = timer;
    window.gtag('event', 'conversion', {
      ...conversion,
      event_callback: openInstallPage,
      event_timeout: timeout,
    });
  }

  document.addEventListener('click', trackInstallClick);
  document.addEventListener('auxclick', trackInstallClick);
})();
