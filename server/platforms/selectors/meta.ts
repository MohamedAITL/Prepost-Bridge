// Selectors for Meta Business Suite's post composer. Update here when Meta changes.

export const META = {
  homeUrl: 'https://business.facebook.com/latest/home',
  composerUrl: 'https://business.facebook.com/latest/composer',
  /** Seen 2026-10: "Create reel" with steps Create → Edit → Share, moved with "Next". */
  reelComposerUrl: 'https://business.facebook.com/latest/reels_composer',
  nextButton: /^(next|suivant|التالي)$/i,
  /** Reel "Thumbnail" section: Choose suggested / Choose frame / Upload image (seen 2026-10). */
  reelThumbnailUpload: /^(upload image|importer une image|télécharger une image|تحميل صورة)$/i,
  /** After a thumbnail is uploaded, the "Upload image" link becomes "Change image". */
  reelThumbnailChange: /^(change image|changer l['’]image|modifier l['’]image|تغيير الصورة)$/i,
  /** Save/apply inside a thumbnail editor dialog, if one appears after choosing the image. */
  editorSave: /^(save|apply|done|enregistrer|appliquer|terminé|حفظ|تطبيق|تم)$/i,

  session: {
    loggedIn: ['div[role="navigation"] a[href*="/latest/"]', '[contenteditable="true"][role="combobox"]', 'div[role="textbox"][contenteditable="true"]', 'a[href*="/latest/home"]'],
    loggedOut: ['input[name="email"]', 'input#email', 'button[name="login"]', 'form[action*="login"]'],
    loggedOutUrl: /\/login(\.php|\/)|business\.facebook\.com\/business\/loginpage|facebook\.com\/login/,
    challenge: ['iframe[src*="captcha"]', 'iframe[title*="captcha" i]'],
    challengeUrl: /\/checkpoint\/|two_step_verification|\/captcha/,
  },

  // Seen 2026-10: the composer's text field is a contenteditable combobox labelled
  // "Write into the dialogue box to include text with your post."
  textbox: [
    '[contenteditable="true"][role="combobox"][aria-label*="include text" i]',
    '[contenteditable="true"][role="combobox"]',
    'div[role="textbox"][contenteditable="true"][aria-label*="text" i]',
    'div[role="textbox"][contenteditable="true"][aria-describedby]',
    'div[role="textbox"][contenteditable="true"]',
  ],
  /** "Post to" destination picker; its text names the Page (+ Instagram account) and shows FB/IG icons. */
  postTo: /^(post to|publier sur|النشر على|نشر على)/i,
  /**
   * Business asset switcher (top left; its menu lists "N business assets"). Seen 2026-10 on Home as
   * a combobox named after the current asset ("Instagram Facebook Chouf Sport Officiel, handle"),
   * and on the composer as a button named "Pressable".
   */
  assetSwitcherCombobox: /^(instagram\s+)?facebook\s+\S/i,
  assetSwitcherName: /^pressable$/i,
  assetMenu: /business assets|actifs (de l['’]entreprise|professionnels)|أصول (النشاط|الأعمال)/i,

  fileInput: ['input[type="file"][accept*="image"][accept*="video"]', 'input[type="file"][accept*="image"]', 'input[type="file"][accept*="video"]', 'input[type="file"]'],
  /** Opens the media picker when no file input is present in the DOM. */
  addMediaButton: /^(add photo\/video|add photo|add video|ajouter une photo\/vidéo|ajouter une photo|إضافة صورة\/فيديو|إضافة صورة)$/i,
  uploadFromComputer: /upload from (desktop|computer)|importer depuis (l['’]ordinateur|le bureau)|التحميل من (الكمبيوتر|سطح المكتب)/i,
  uploadProgress: ['[role="progressbar"]'],
  /** Local previews of the files you added. */
  mediaPreview: 'img[src^="blob:"], video[src^="blob:"]',
  mediaErrors: [/couldn't upload|upload failed|isn't supported|not supported/i, /impossible d['’]importer|n['’]est pas pris en charge/i, /تعذر التحميل|غير مدعوم/],

  /** Final submission controls; observed only, never clicked. */
  publishButton: /^(publish|schedule|share|share now|publier|partager|programmer|نشر|مشاركة|جدولة)$/i,
  forbidden: ['[aria-label="Publish"]', '[aria-label="Schedule"]', '[aria-label="Publier"]', '[aria-label="Programmer"]', '[aria-label="نشر"]'],
};
