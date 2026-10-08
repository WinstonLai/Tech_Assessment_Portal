import { describe, expect, it } from 'vitest';
import { buildInvitationEmail } from './invitationEmail';

const base = {
  fullName: 'John Luke Lim Kang',
  email: 'johnlim.kang@gmail.com',
  password: '5PEw-ZbcL-uG9H',
  expiresAtIso: '2026-10-08T09:32:00Z',
  portalUrl: 'https://winstonlai.github.io/Tech_Assessment_Portal/',
  now: new Date('2026-10-05T09:32:00Z').getTime(),
};

describe('buildInvitationEmail', () => {
  it('builds the subject from the full name', () => {
    expect(buildInvitationEmail(base).subject).toBe("[Assessment] John Luke Lim Kang's Internship Tech Assessment");
  });

  it('greets by first name and includes the candidate-specific details', () => {
    const { body } = buildInvitationEmail(base);
    expect(body.startsWith('Hi John,\n')).toBe(true);
    expect(body).toContain('Portal: https://winstonlai.github.io/Tech_Assessment_Portal/');
    expect(body).toContain('Email: johnlim.kang@gmail.com');
    expect(body).toContain('Password: 5PEw-ZbcL-uG9H');
    expect(body).toContain('Access expires: Oct 08, 2026, 05:32 PM SGT');
    expect(body).toContain('submitted by Thursday, 8th October 2026, 05:32 PM (Singapore Time).');
    expect(body.endsWith('Thanks.')).toBe(true);
  });

  it('derives the time allowed from the expiry', () => {
    expect(buildInvitationEmail(base).body).toContain('online within three days.');
    const fiveDays = buildInvitationEmail({ ...base, expiresAtIso: '2026-10-10T09:32:00Z' });
    expect(fiveDays.body).toContain('online within five days.');
  });

  it('falls back when there is no name', () => {
    for (const fullName of [null, '', '   ']) {
      const { subject, body } = buildInvitationEmail({ ...base, fullName });
      expect(subject).toBe('[Assessment] Internship Tech Assessment');
      expect(body.startsWith('Hi candidate,\n')).toBe(true);
    }
  });

  it('does not throw on an invalid expiry', () => {
    const { body } = buildInvitationEmail({ ...base, expiresAtIso: 'garbage' });
    expect(body).toContain('online within the access period.');
    expect(body).toContain('Access expires: —');
  });

  it('spaces out and indents the numbered items so they are easy to read', () => {
    const { body } = buildInvitationEmail(base);
    expect(body).toContain('we would require you to:\n\n1. Complete a technical assessment online within three days.\n\n   Portal: ');
    expect(body).toContain('\n   Email: johnlim.kang@gmail.com\n   Password: 5PEw-ZbcL-uG9H\n   Access expires: Oct 08, 2026, 05:32 PM SGT\n\n   You can save and exit');
    expect(body).toContain('access expires.\n\n2. Please share');
    expect(body).toContain('submission.\n\nPlease ensure your responses');
  });

  it('keeps the password-reset login details unindented', () => {
    const { body } = buildInvitationEmail({ ...base, isNew: false });
    expect(body).toContain('sign in:\nPortal: ');
    expect(body).toContain('\nEmail: johnlim.kang@gmail.com\nPassword: ');
  });

  it('sends a short password-reset message instead of the full invitation', () => {
    const { subject, body } = buildInvitationEmail({ ...base, isNew: false });
    expect(subject).toBe("[Assessment] New login details for John Luke Lim Kang's Internship Tech Assessment");
    expect(body).toContain('has been reset');
    expect(body).toContain('Password: 5PEw-ZbcL-uG9H');
    expect(body).toContain('Access expires: Oct 08, 2026, 05:32 PM SGT');
    expect(body).toContain('submit by Thursday, 8th October 2026, 05:32 PM (Singapore Time)');
    expect(body).not.toContain('shortlisted');
    expect(body).not.toContain('past data engineering');
  });
});
