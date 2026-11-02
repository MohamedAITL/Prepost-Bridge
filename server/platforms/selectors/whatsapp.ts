// Selectors for WhatsApp Web's Channels screens. Update here when WhatsApp changes.

export const WA = {
  homeUrl: 'https://web.whatsapp.com/',

  session: {
    loggedIn: ['#pane-side', '#side', 'button[aria-label="Chaînes"]', 'button[aria-label="Channels"]', 'button[aria-label="القنوات"]'],
    loggedOut: ['canvas[aria-label*="scan" i]', 'canvas[aria-label*="QR" i]', 'div[data-ref]'],
    loggedOutUrl: /web\.whatsapp\.com\/post_logout/,
    challenge: [],
    challengeUrl: /$^/,
  },

  /** Seen 2026-11: left rail button "Chaînes", then a named navigation with one button per channel. */
  channelsButton: /^(channels|chaînes|القنوات)$/i,
  /** A channel's button is its name after this word ("Chaîne ChoufTV"). */
  channelRowPrefix: '(?:chaîne|channel|قناة)',
  /** Only channels you run have a composer: a text box in the footer. */
  footer: '#main footer',
  header: '#main header',
  attachButton: 'footer button[aria-haspopup="menu"]',
  fileInput: ['input[type="file"][accept*="video"]', 'input[type="file"][accept*="image"]'],
  /** Final submission control; pressed only with auto-publish on (PrepareContext.publishClick). */
  sendButton: /^(envoyer|send|إرسال)/i,
  /** Seen 2026-11: "Envoyer 1 élément sélectionné" while media waits in the tray. */
  mediaTraySend: /^(envoyer|send|إرسال).*\d/i,
};
