// Selectors for Chouf's WordPress admin (classic editor). Taken from the Chouf News Desk extension
// (wordpress.js, upload-image.js). Update here when the admin changes.

const ADMIN = 'https://0561102b93f7daa97.chouftv.ma/cms/wp-admin/';

export const WP = {
  adminUrl: ADMIN,
  newPostUrl: (postType: 'press' | 'program') => `${ADMIN}post-new.php?post_type=${postType}`,
  /** Public address of a published news article. */
  pressLink: (id: string) => `https://chouftv.ma/press/${id}.html`,

  session: {
    loggedIn: ['#wpadminbar', '#post-body', '#title'],
    loggedOut: ['#loginform', '#user_login'],
    loggedOutUrl: /wp-login\.php/,
    challenge: [],
    challengeUrl: /(?!)/,
  },

  title: '#title',
  content: '#content',
  postId: '#post_ID',
  /** Custom fields found by their visible label, as the extension did. */
  facebookTitleLabel: 'عنوان الفيسبوك',
  videoUrlLabel: 'Video URL',
  tagInput: '#tagsdiv-post_tag .newtag, .tagsdiv .newtag',
  tagAdd: '#tagsdiv-post_tag .tagadd, .tagsdiv .tagadd',
  tagChips: '#tagsdiv-post_tag .tagchecklist li, .tagsdiv .tagchecklist li',
  thumbnailId: '#_thumbnail_id',

  /** Final submission control; pressed only with auto-publish on (PrepareContext.publishClick). */
  publishButton: '#publish',
  publishedStatus: '#original_post_status',
  forbidden: ['#publish', '#save-post', '#post-preview', '#delete-action a', '.submitdelete'],
};
