"""Exercise the real chip component with local fake Apollo transports only."""
import os
import re
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright


deps = Path(os.environ['MASK_TEST_DEPS'])
subprocess.run(['node', str(Path(__file__).with_name('browser.cjs'))], check=True)
script = (deps / 'browser.js').read_text()
contact = {
    'unavailable': False,
    'hasEmail': True,
    'hasPhone': True,
    'emailAvailable': True,
    'callAvailable': True,
    'entries': [{'kind': 'Reply arrived', 'text': '[email removed] [phone removed]'}],
}
layouts = [(1440, 900, 'light', 16), (390, 844, 'dark', 16), (375, 667, 'light', 24)]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel='chrome')
    for width, height, theme, size in layouts:
        page = browser.new_page(
            viewport={'width': width, 'height': height}, color_scheme=theme,
        )
        # A locally fulfilled secure origin permits crypto.randomUUID, like the CRM.
        page.route('https://mask.test/**', lambda route: route.fulfill(
            status=200, content_type='text/html', body='<html></html>',
        ))
        page.goto('https://mask.test/')
        color = '#eee' if theme == 'dark' else '#222'
        background = '#151515' if theme == 'dark' else 'white'
        page.set_content(
            f'<html><body style="font:{size}px system-ui;color:{color};'
            f'background:{background}"><main id="root"></main></body></html>'
        )
        page.evaluate('(contact)=>{window.__contact=contact;window.__requests=[]}', contact)
        page.add_script_tag(content=script)
        page.get_by_role('button', name='Email', exact=True).click()
        page.get_by_label('Subject', exact=True).fill('Fixture subject')
        page.get_by_label('Message', exact=True).fill('Fixture body')
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        page.get_by_role('button', name='Send email', exact=True).click()
        page.get_by_role('status').filter(has_text='Email sent.').wait_for()
        assert page.evaluate('window.__requests[0].action') == 'email'
        page.get_by_role('button', name='Call', exact=True).click()
        page.get_by_role('status').filter(has_text='Call started.').wait_for()
        assert page.evaluate('window.__requests[1].action') == 'call'
        assert page.locator('a[href^="mailto:"],a[href^="tel:"]').count() == 0
        assert not re.search(r'@|\d{5,}', page.locator('body').inner_text())
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        for request in page.evaluate('window.__requests'):
            assert not any(key in request for key in ['to', 'from', 'cc', 'phone', 'email'])
        page.screenshot(path=str(deps / f'local-{width}-{theme}.png'))
        page.close()
    browser.close()
print(f'PASS: {len(layouts)} local layouts; person-ID actions; no contact links or overflow')
