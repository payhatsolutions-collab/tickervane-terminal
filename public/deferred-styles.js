// Styles are discovered in the HTML without holding up its first paint.
document.querySelectorAll('link[data-deferred-style]').forEach(link => { link.media = 'all'; });
