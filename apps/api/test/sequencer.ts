import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * The e2e files share one database and some build on state set by earlier ones (the ledger tests set
 * the go-live date that the posting tests rely on). Vitest's default order puts failed/slow files
 * first, so run them in a fixed, alphabetical order instead.
 */
export default class AlphabeticalSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}
