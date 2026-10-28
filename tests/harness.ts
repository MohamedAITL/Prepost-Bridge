import type { Page } from 'playwright';
import type { JobCheck } from '../shared/jobs';
import { publishClick } from '../server/automation/safeActions';
import type { JobContent, PrepareContext } from '../server/platforms/types';

/** Minimal PrepareContext for running platform modules against local fixture pages. */
export function testContext(page: Page, content: JobContent, allowPublish = false) {
  const checks: JobCheck[] = [];
  const statuses: string[] = [];
  const waits: string[] = [];
  const articles: { title: string; url: string; published: boolean }[] = [];
  const ctx: PrepareContext = {
    page,
    content,
    setStatus: (s, m) => statuses.push(`${s}: ${m}`),
    log: () => undefined,
    check: (label, state, detail) => checks.push({ label, state, detail }),
    step: (_name, fn) => fn(),
    waitForUser: async (message) => {
      waits.push(message);
    },
    throwIfCancelled: () => undefined,
    snapshot: async () => undefined,
    showTab: async () => undefined,
    hideTab: async () => undefined,
    publishClick: (locator, purpose) => publishClick(locator, purpose, allowPublish),
    setArticle: (a) => articles.push(a),
  };
  return { ctx, checks, statuses, waits, articles };
}
