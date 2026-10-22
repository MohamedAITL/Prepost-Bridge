// Selectors for YouTube Studio's upload dialog. Update here when Studio changes.

export const YT = {
  studioUrl: 'https://studio.youtube.com/',
  /** Redirects to the signed-in channel's Studio with the upload dialog open. */
  uploadUrl: 'https://www.youtube.com/upload',

  session: {
    loggedIn: ['ytcp-app', '#create-icon', 'ytcp-uploads-dialog', '#avatar-btn', 'ytd-topbar-menu-button-renderer #avatar-btn', 'button#avatar-btn'],
    loggedOut: ['input[type="email"][name="identifier"]', 'a[href*="ServiceLogin"]'],
    loggedOutUrl: /accounts\.google\.com\/(v3\/)?signin|ServiceLogin/,
    challenge: ['#captchaimg', 'iframe[title*="recaptcha" i]'],
    challengeUrl: /accounts\.google\.com\/.*(challenge|speedbump|deniedsigninrejected)/,
  },

  // The ytcp-uploads-dialog host element has zero height (seen 2026-10); look for what's drawn inside it.
  uploadsDialog: ['ytcp-uploads-file-picker', 'ytcp-uploads-dialog tp-yt-paper-dialog', 'ytcp-uploads-dialog #dialog', 'ytcp-uploads-dialog'],
  fileInput: ['ytcp-uploads-file-picker input[type="file"]', 'ytcp-uploads-dialog input[type="file"][name="Filedata"]', 'input[type="file"][name="Filedata"]'],
  title: ['ytcp-uploads-dialog #title-textarea #textbox', 'ytcp-video-title #textbox', 'ytcp-uploads-dialog [contenteditable="true"][aria-label*="title" i]'],
  description: ['ytcp-uploads-dialog #description-textarea #textbox', 'ytcp-video-description #textbox', 'ytcp-uploads-dialog [contenteditable="true"][aria-label*="viewers" i]'],
  thumbnailInput: ['ytcp-uploads-dialog ytcp-thumbnails-compact-editor-uploader input[type="file"]', 'ytcp-uploads-dialog input#file-loader', 'ytcp-uploads-dialog input[type="file"][accept*="image"]'],
  thumbnailPreview: ['ytcp-thumbnails-compact-editor-uploader img[src^="blob:"]', 'ytcp-thumbnails-compact-editor img[src^="blob:"]', 'ytcp-uploads-dialog #still-picker img[src^="blob:"]'],

  audience: {
    kids: 'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_MFK"]',
    not_kids: 'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
  },
  visibility: {
    private: 'ytcp-uploads-dialog tp-yt-paper-radio-button[name="PRIVATE"]',
    unlisted: 'ytcp-uploads-dialog tp-yt-paper-radio-button[name="UNLISTED"]',
    public: 'ytcp-uploads-dialog tp-yt-paper-radio-button[name="PUBLIC"]',
  },
  /** "Next" moves between steps. It is the only navigation button this module clicks. */
  nextButton: 'ytcp-uploads-dialog #next-button',
  /** Present on the Visibility step. */
  visibilityStep: ['ytcp-uploads-dialog ytcp-uploads-review', 'ytcp-uploads-dialog #privacy-radios'],

  progressLabel: ['ytcp-uploads-dialog ytcp-video-upload-progress .progress-label', 'ytcp-uploads-dialog .progress-label', 'ytcp-video-upload-progress'],
  /** Text that means the file is still being transferred (vs. processing, which is fine). */
  stillUploading: /(upload|import|mise en ligne|envoi|تحميل|رفع)[^%]*\d+\s*%|\d+\s*%[^%]*(upload|import|mise en ligne|تحميل|رفع)/i,
  uploadFailed: /(upload failed|failed to upload|daily upload limit|processing abandoned|échec|limite quotidienne|فشل)/i,
  dialogErrors: ['ytcp-uploads-dialog .error-area:visible', 'ytcp-uploads-dialog ytcp-uploads-dialog-error'],

  /**
   * Channel posts (Posts tab on youtube.com). Seen 2026-10: a collapsed placeholder that expands
   * into the composer; "Add image" reveals a multi-image picker with a multi-file input.
   */
  post: {
    profileUrl: 'https://www.youtube.com/profile',
    channelUrl: /youtube\.com\/(@[^/?#]+|channel\/[^/?#]+)/,
    dialog: 'ytd-backstage-post-dialog-renderer',
    placeholder: ['ytd-backstage-post-dialog-renderer #commentbox-placeholder', 'ytd-backstage-post-dialog-renderer #placeholder-area'],
    textbox: ['ytd-backstage-post-dialog-renderer #contenteditable-root', 'ytd-backstage-post-dialog-renderer [contenteditable="true"]'],
    addImageButton: /^(ajouter une image|add (an )?image|إضافة صورة|image)$/i,
    imageInput: [
      'ytd-backstage-post-dialog-renderer ytd-backstage-multi-image-select-renderer #dropzone input[type="file"]',
      'ytd-backstage-post-dialog-renderer ytd-backstage-multi-image-select-renderer input[type="file"][multiple]',
    ],
    thumbnails: 'ytd-backstage-post-dialog-renderer ytd-backstage-multi-image-select-renderer #thumbnail-images-container img',
    submitButton: 'ytd-backstage-post-dialog-renderer #submit-button button',
  },

  /**
   * Channel switching (seen 2026-10): /channel_switcher (lands on /account) lists the channels as
   * ytd-account-item-renderer ("Name / @handle / subscribers"). The active channel's name is the
   * level-1 heading of its channel page (youtube.com/profile redirects there).
   */
  channels: {
    switcherUrl: 'https://www.youtube.com/channel_switcher',
    item: 'ytd-channel-switcher-page-renderer ytd-account-item-renderer',
  },

  /** Final submission control; pressed only with auto-publish on (PrepareContext.publishClick). */
  doneButton: 'ytcp-uploads-dialog #done-button',
  /** Shown after Publish/Save: "Video published" share dialog, or "still processing". */
  publishedDialog: ['ytcp-video-share-dialog', 'ytcp-uploads-still-processing-dialog'],
  forbidden: [
    '#done-button',
    'ytcp-uploads-dialog #done-button',
    '#schedule-radio-button',
    '[name="SCHEDULE"]',
    // Channel post composer: Publish, its scheduling menu, and Cancel (discards the draft).
    'ytd-backstage-post-dialog-renderer #submit-button',
    'ytd-backstage-post-dialog-renderer #option-menu',
    'ytd-backstage-post-dialog-renderer #cancel-button',
    'ytd-backstage-multi-image-select-renderer #selection-cancel-button',
  ],
};
