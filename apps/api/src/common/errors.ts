import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

export const notFound = (what: string) => new NotFoundException({ error: 'not_found', message: `${what} not found` });
export const forbidden = (msg = 'not allowed') => new ForbiddenException({ error: 'forbidden', message: msg });
export const badRequest = (msg: string, details?: unknown) => new BadRequestException({ error: 'bad_request', message: msg, details });
export const conflict = (msg: string) => new ConflictException({ error: 'conflict', message: msg });
