import { accessDays, daysPhrase, formatDateTimeSgt, formatDeadlineSgt } from './format';

export interface InvitationInput {
  fullName: string | null;
  email: string;
  password: string;
  expiresAtIso: string;
  portalUrl: string;
  /** True for a first invitation; false when only the password was reset (candidate may be mid-assessment). */
  isNew?: boolean;
  now?: number;
}

/** Subject and body of the invitation email, mirroring the one sent to candidates. */
export function buildInvitationEmail(i: InvitationInput): { subject: string; body: string } {
  const name = i.fullName?.trim() ?? '';
  const firstName = name.split(/\s+/)[0] || 'candidate';
  const expires = formatDateTimeSgt(i.expiresAtIso);
  const deadline = formatDeadlineSgt(i.expiresAtIso);

  const login = `Portal: ${i.portalUrl}
Email: ${i.email}
Password: ${i.password}
Access expires: ${expires}`;

  if (i.isNew === false) {
    const subject = name
      ? `[Assessment] New login details for ${name}'s Internship Tech Assessment`
      : '[Assessment] New login details for the Internship Tech Assessment';
    const body = `Hi ${firstName},

Your password for the technical assessment portal has been reset. Please use the details below to sign in:
${login}

Your saved answers are kept, so you can pick up where you left off. Please submit by ${deadline} (Singapore Time).

Thanks.`;
    return { subject, body };
  }

  const subject = name
    ? `[Assessment] ${name}'s Internship Tech Assessment`
    : '[Assessment] Internship Tech Assessment';
  const within = Number.isNaN(Date.parse(i.expiresAtIso))
    ? 'the access period'
    : daysPhrase(accessDays(i.expiresAtIso, i.now));

  const body = `Hi ${firstName},

Thank you for your interest in interning with the Chief Data Officer’s Office, Health Promotion Board.

You are currently shortlisted for an internship with us.

As part of the next step of the selection process, we would require you to:
1. Complete a technical assessment online within ${within}.
${login}
You can save and exit at any time and resume later. Your active time is shown on screen; the total time from your first answer to your submission is also recorded. Please submit before your access expires.
2. Please share any example of your past data engineering or analytics project you have worked on. Kindly ensure that all code and/or reports are submitted in PDF format, as other file formats may be blocked by the email server and could affect our assessment of your submission.

Please ensure your responses to #1 and #2 are submitted by ${deadline} (Singapore Time). Kindly use "Reply All" to ensure all recipients receive your submission.

Thanks.`;

  return { subject, body };
}
