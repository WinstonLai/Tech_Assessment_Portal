// Example of the confidential content file. Copy this folder to `private/` and fill in the real
// questions / model answers / rubric, then run `npm run seed:generate`.
// The real file is gitignored — never commit it.
export const assessmentInfo = {
  title: 'Example Tech Assessment',
  intro_md: '## Introduction\n\nWelcome…',
};

export const sections = { A: 'Section A: Example' };

export const questions = [
  {
    id: 'A1',
    section: 'A',
    title: 'Example question',
    answer_type: 'rich_text', // 'rich_text' | 'code' | 'diagram_plus_text'
    max_score: 100,           // all max_scores must add up to 100
    prompt_md: 'Explain **X**.',
    model_answer_md: 'X is …',
    rubric: [
      // patterns are case-insensitive JS regexes; match 'any' (default) or 'all';
      // source: 'any' | 'text' (rich text + diagram labels) | 'code' | 'diagram'
      { label: 'Mentions X', points: 60, match: 'any', source: 'text', patterns: ['\\bx\\b'] },
      { label: 'Gives an example', points: 40, match: 'all', source: 'text', patterns: ['example', 'because'] },
    ],
  },
];
