// Selectors for TikTok Studio's web upload page. Update here when TikTok changes.

export const TT = {
  homeUrl: 'https://www.tiktok.com/tiktokstudio',
  uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload?from=webapp',

  session: {
    loggedIn: ['input[type="file"][accept*="video"]', '[data-e2e="upload-icon"]', '[data-e2e="nav-profile"]', '[data-tt="Sidebar_Sidebar_Container"]', 'div[class*="sidebar" i] a[href*="tiktokstudio"]'],
    loggedOut: ['[data-e2e="top-login-button"]', '#loginContainer', 'a[href*="/login"][data-e2e]'],
    loggedOutUrl: /tiktok\.com\/login/,
    challenge: ['#captcha-verify-image', '.captcha_verify_container', '#captcha_container', '[class*="captcha" i] img'],
    challengeUrl: /verify|captcha/,
    // Studio pages redirect to /login when signed out.
    loggedInUrl: /tiktok\.com\/tiktokstudio(\/|\?|$)/,
  },

  /** Seen 2026-10: "Vidéos" / "Photos" tabs above the upload area. */
  photosTab: /^(photos?|صور)$/i,
  imageInput: ['input[type="file"][accept*="image"]', 'input[type="file"][accept*=".jpg"]', 'input[type="file"][accept*=".png"]'],
  /** "A video you were editing wasn't saved. Continue editing?" — needs the user's decision. */
  unsavedDraftPrompt: [/n['’]a pas été enregistrée/i, /wasn['’]t saved|was not saved|not been saved/i, /لم يتم حفظ/],

  /**
   * Cover editor (seen 2026-10): "Modifier la couverture" in [data-e2e="cover_container"] opens a
   * dialog with an "Upload cover image" file input and Annuler / Enregistrer buttons.
   */
  cover: {
    container: '[data-e2e="cover_container"]',
    /** The clickable "Modifier la couverture" text inside the container (the container itself isn't). */
    edit: /modifier la couverture|edit cover|تعديل الغلاف/i,
    dialog: '[role="dialog"]:has([class*="CoverEditStage"]), [role="dialog"]:has(input[type="file"][accept*="image"])',
    input: 'input[type="file"][accept*="image"]',
    save: /^(enregistrer|save|confirm|confirmer|حفظ|تأكيد)$/i,
  },

  fileInput: ['input[type="file"][accept*="video"]', 'input[type="file"]'],
  caption: [
    '.public-DraftEditor-content[contenteditable="true"]',
    '[data-e2e="caption_container"] [contenteditable="true"]',
    'div[class*="caption" i] [contenteditable="true"]',
    'div[contenteditable="true"][role="combobox"]',
  ],
  /** Shown once the file has been transferred. */
  uploadedText: [/^Uploaded/i, /Téléchargé|Importé/i, /تم التحميل|تم الرفع/],
  uploadFailed: [/upload failed|couldn't upload|failed to upload/i, /échec du (téléchargement|téléversement)/i, /فشل التحميل/],
  preview: ['video', 'div[class*="preview" i] img', 'img[src^="blob:"]'],
  /** Generic blocking dialogs that need a human decision. */
  modal: ['div[role="dialog"]:not([aria-hidden="true"])', '.TUXModal'],

  /** Final submission controls; observed only, never clicked. */
  postButton: '[data-e2e="post_video_button"], button:has-text("Post")',
  forbidden: ['[data-e2e="post_video_button"]', '[data-e2e="schedule_video_button"]', '[data-e2e="save_draft_button"]'],
};
