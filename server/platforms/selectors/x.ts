// Selectors for X (x.com). Update here when X changes its web composer.
// Candidates are tried in order; put the most specific first.

export const X = {
  homeUrl: 'https://x.com/home',
  composeUrl: 'https://x.com/compose/post',

  session: {
    loggedIn: ['[data-testid="SideNav_AccountSwitcher_Button"]', '[data-testid="AppTabBar_Home_Link"]', '[data-testid="tweetTextarea_0"]'],
    loggedOut: ['[data-testid="loginButton"]', '[data-testid="login"]', 'input[autocomplete="username"]'],
    loggedOutUrl: /x\.com\/(i\/flow\/(login|signup)|i\/jf\/onboarding|login|logout)|redirect_after_login=|twitter\.com\/(i\/flow\/)?login/,
    challenge: ['iframe[src*="arkoselabs"]', '#arkose_iframe'],
    challengeUrl: /\/account\/access|\/i\/flow\/(consent|verify)|captcha/,
  },

  textbox: ['[data-testid="tweetTextarea_0"]', 'div[role="dialog"] div[role="textbox"][contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]'],
  fileInput: ['input[data-testid="fileInput"]', 'div[role="dialog"] input[type="file"]', 'input[type="file"][accept*="image"]'],
  attachments: ['[data-testid="attachments"]'],
  /** Rendered previews of attached media inside the attachments area. */
  attachmentMedia: '[data-testid="attachments"] img, [data-testid="attachments"] video',
  // Only inside the attachments area: the composer's character-count ring is also a progressbar.
  uploadProgress: ['[data-testid="attachments"] [role="progressbar"]'],
  mediaErrors: [/could(n't| not) be uploaded/i, /some of your media failed/i, /n'a pas pu être (téléchargé|importé)/i, /تعذر تحميل/],

  /** Toasts after pressing Post that mean it was NOT sent. */
  postErrors: [/already said that|something went wrong/i, /vous l['’]avez déjà dit|un problème est survenu/i, /سبق أن قلت|حدث خطأ/],
  /** Final submission control. Pressed only with auto-publish on (PrepareContext.publishClick). */
  postButton: '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]',
  forbidden: ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]', '[data-testid="scheduleOption"]'],
};
