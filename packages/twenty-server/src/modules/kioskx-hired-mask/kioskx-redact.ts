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

export const inquiryText = (
  body: { markdown?: string | null; blocknote?: string | null } | null,
): string => {
  if (body?.markdown) return redactContactText(body.markdown);
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
    return redactContactText(text(JSON.parse(body.blocknote)));
  } catch {
    return '';
  }
};
