"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get formContacts () {
        return formContacts;
    },
    get inquiryText () {
        return inquiryText;
    },
    get redactContactText () {
        return redactContactText;
    }
});
const _htmltotext = require("html-to-text");
const redactContactText = (value)=>(0, _htmltotext.convert)(value, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
            {
                selector: 'a',
                options: {
                    ignoreHref: true
                }
            },
            {
                selector: 'img',
                format: 'skip'
            }
        ]
    }).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/^\s*(?:to|from|cc|bcc|reply-to|return-path):.*$/gim, '').replace(/[^\s<>()[\],;:]+@[^\s<>()[\],;:]+/gu, '[email removed]').replace(/(?:\+?\p{N}[\p{N}\s().\-/\u2010-\u2015]*\p{N})/gu, (match)=>(match.match(/\p{N}/gu)?.length ?? 0) >= 5 ? '[phone removed]' : match).replace(/(?:mailto|tel):\S*/gi, '[contact removed]');
const formText = (body)=>{
    if (body?.markdown) return body.markdown;
    if (!body?.blocknote) return '';
    try {
        const text = (node)=>{
            if (Array.isArray(node)) return node.map(text).join('\n');
            if (!node || typeof node !== 'object') return '';
            const item = node;
            return [
                typeof item.text === 'string' ? item.text : '',
                text(item.content),
                text(item.children)
            ].filter(Boolean).join(' ');
        };
        return text(JSON.parse(body.blocknote));
    } catch  {
        return '';
    }
};
const inquiryText = (body)=>redactContactText(formText(body));
const formContacts = (body)=>{
    const text = (0, _htmltotext.convert)(formText(body), {
        wordwrap: false
    });
    const field = (label)=>text.match(new RegExp(`(?:^|[|\\n])\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*([^|\\n]+)`, 'i'))?.[1]?.trim() ?? '';
    return {
        name: redactContactText(field('(?:full )?name')),
        company: redactContactText(field('company(?: name)?')),
        email: field('email').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '',
        phone: field('phone(?: number)?').match(/^\+?[0-9][0-9 ().-]{5,}[0-9]$/)?.[0] ?? ''
    };
};
