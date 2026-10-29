import { convert } from 'html-to-text';

// Return plain text only. Never return HTML, link destinations, attachment URLs,
// participant headers, or rich-text JSON to the desk.
export const redactContactText = (value: string): string =>
  convert(value, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  })
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^\s*(?:to|from|cc|bcc|reply-to|return-path):.*$/gim, '')
    .replace(/[^\s<>()[\],;:]+@[^\s<>()[\],;:]+/gu, '[email removed]')
    .replace(/(?:\+?\p{N}[\p{N}\s().\-/\u2010-\u2015]*\p{N})/gu, (match) =>
      (match.match(/\p{N}/gu)?.length ?? 0) >= 5 ? '[phone removed]' : match,
    )
    .replace(/(?:mailto|tel):\S*/gi, '[contact removed]');

const formText = (
  body: { markdown?: string | null; blocknote?: string | null } | null,
): string => {
  if (body?.markdown) return body.markdown;
  if (!body?.blocknote) return '';
  try {
    const text = (node: unknown): string => {
      if (Array.isArray(node)) return node.map(text).join('\n');
      if (!node || typeof node !== 'object') return '';
      const item = node as {
        text?: string;
        content?: unknown;
        children?: unknown;
      };
      return [
        typeof item.text === 'string' ? item.text : '',
        text(item.content),
        text(item.children),
      ]
        .filter(Boolean)
        .join(' ');
    };
    return text(JSON.parse(body.blocknote));
  } catch {
    return '';
  }
};

export const inquiryText = (body: Parameters<typeof formText>[0]): string =>
  redactContactText(formText(body));

// Only labeled contact fields from the linked form, never arbitrary numbers in prose.
export const formContacts = (body: Parameters<typeof formText>[0]) => {
  const text = convert(formText(body), { wordwrap: false });
  const field = (label: string) =>
    text
      .match(
        new RegExp(
          `(?:^|[|\\n])\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*([^|\\n]+)`,
          'i',
        ),
      )?.[1]
      ?.trim() ?? '';
  return {
    name: redactContactText(field('(?:full )?name')),
    company: redactContactText(field('company(?: name)?')),
    email:
      field('email').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '',
    phone:
      field('phone(?: number)?').match(/^\+?[0-9][0-9 ().-]{5,}[0-9]$/)?.[0] ??
      '',
  };
};
