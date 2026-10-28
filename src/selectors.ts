/** Observed on the current Patreon web UI, 2026-10-28. English and Polish. */
export const S = {
  title: 'textarea[aria-label="Title"], textarea[aria-label="Tytuł"]',
  body: '.ProseMirror[contenteditable="true"][role="textbox"]',
  comment: '[data-tag="comment-row"][id^="comment-"]',
  commentBody: '[data-tag="comment-body"]',
  commentAuthor: '[data-tag="commenter-name"]',
  commentMenu: '[data-tag="comment-more-actions"]',
  create: /^(Create post|Utwórz post)$/i,
  publish: /^(Publish|Opublikuj)$/i,
  more: /^(More actions|Więcej działań)$/i,
  close: /^(Close|Zamknij)$/i,
  commentsAccess: /^(Allow comments dropdown|Zezwól na listę rozwijaną komentarzy)$/i,
  commentOptions: {
    everyone: /^(Anyone with access|Każdy, kto ma dostęp)$/i,
    members: /^(All members|Wszyscy członkowie)$/i,
    paid: /^(Paid members|Członkowie z płatną subskrypcją)$/i,
    none: /^(No one|Nikt)$/i,
  },
};
