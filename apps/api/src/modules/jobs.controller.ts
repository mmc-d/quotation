import { Controller, Param, Post } from '@nestjs/common';
import { Perm } from '../auth/actor.js';
import { badRequest } from '../common/errors.js';
import { runExpire, runFollowUps, runReminders } from '../worker.js';

/** Run a scheduled job now (admins) — useful for support and for the test suite. */
@Controller('jobs')
export class JobsController {
  @Post(':name/run')
  @Perm('admin.settings')
  async run(@Param('name') name: string) {
    if (name === 'followups') return runFollowUps();
    if (name === 'reminders') return runReminders();
    if (name === 'expire') return runExpire();
    throw badRequest('unknown job');
  }
}
